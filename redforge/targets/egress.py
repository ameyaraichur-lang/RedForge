"""Egress policy for CALLER-supplied target endpoints.

A red-team tool takes a URL and sends it hostile payloads with a credential
attached. That is a server-side request forgery primitive the moment the URL
comes from a request body rather than from the deployer's environment, so this
module draws the trust boundary:

* A URL from ``RF_TARGET_BASE_URL`` or a catalogue spec is deployer-controlled
  and is not checked here.
* A URL from ``TargetRequest.base_url`` is caller-controlled and must clear
  ``assert_url_permitted()``.

Both guards fail closed. With no allowlist configured, callers cannot choose a
URL at all; the bundled fixture and env-configured targets keep working because
they never take this path.

Credentials are restricted the same way. ``api_key_env`` originally accepted any
environment variable name, which let a caller have the server send
``RF_ASTRA_API_KEY`` — or any other secret — to an address they chose. Only
dedicated ``RF_TARGET_CRED_*`` slots are readable now.

Known limitation: the DNS check is time-of-validation, not time-of-use, so a
rebinding attacker can still move a resolved name. Allowlisting exact IP
literals avoids that entirely and is the recommended form.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlsplit

from .registry import TargetResolutionError

#: Dedicated credential slots. Nothing else in the environment is reachable.
CREDENTIAL_SLOT_PREFIX = "RF_TARGET_CRED_"
_SLOT_RE = re.compile(rf"^{CREDENTIAL_SLOT_PREFIX}[A-Z0-9_]{{1,64}}$")

_DEFAULT_PORTS = {"http": 80, "https": 443}


class EgressDenied(TargetResolutionError):
    """A caller-supplied endpoint or credential failed the egress policy."""


def assert_credential_slot(env_name: str) -> None:
    """Allow only dedicated credential slots to be named by a caller."""
    if not _SLOT_RE.match(env_name or ""):
        raise EgressDenied(
            f"api_key_env must name a dedicated credential slot "
            f"({CREDENTIAL_SLOT_PREFIX}*), got {env_name!r}; arbitrary server "
            "environment variables are not readable")


def _parse_allowlist(raw: str) -> list[tuple[str, int | None]]:
    entries: list[tuple[str, int | None]] = []
    for chunk in (raw or "").split(","):
        item = chunk.strip().lower()
        if not item:
            continue
        host, _, port = item.rpartition(":")
        if host and port.isdigit():
            entries.append((host, int(port)))
        else:
            entries.append((item, None))
    return entries


def _is_ip_literal(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _host_matches(host: str, pattern: str) -> bool:
    if pattern.startswith("*."):
        return host == pattern[2:] or host.endswith(pattern[1:])
    return host == pattern


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def _resolved_ips(host: str) -> list[str]:
    if _is_ip_literal(host):
        return [host]
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise EgressDenied(f"cannot resolve target host {host!r}: {e}") from e
    return sorted({str(info[4][0]) for info in infos})


def assert_url_permitted(base_url: str, *, allowlist: str,
                         allow_private: bool = False) -> None:
    """Validate a caller-supplied base URL against the egress policy."""
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https"):
        raise EgressDenied(
            f"target base_url must be http or https, got {parts.scheme or 'none'!r}")
    host = (parts.hostname or "").lower()
    if not host:
        raise EgressDenied(f"target base_url has no host: {base_url!r}")
    try:
        port = parts.port or _DEFAULT_PORTS[parts.scheme]
    except ValueError as e:  # malformed port
        raise EgressDenied(f"target base_url has an invalid port: {base_url!r}") from e

    entries = _parse_allowlist(allowlist)
    if not entries:
        raise EgressDenied(
            "caller-supplied target URLs are disabled; set RF_TARGET_URL_ALLOWLIST "
            "to the hosts this deployment is authorised to attack, or select a "
            "catalogue target by target_id instead")

    matched: tuple[str, int | None] | None = None
    for entry_host, entry_port in entries:
        if _host_matches(host, entry_host) and entry_port in (None, port):
            matched = (entry_host, entry_port)
            break
    if matched is None:
        raise EgressDenied(
            f"{host}:{port} is not in RF_TARGET_URL_ALLOWLIST")

    # An exact IP literal in the allowlist is an unambiguous, deliberate
    # statement about one address, so private ranges are honoured. A hostname
    # that quietly resolves inside the perimeter is the dangerous case.
    if _is_ip_literal(matched[0]) or allow_private:
        return
    for ip in _resolved_ips(host):
        if _is_blocked_ip(ipaddress.ip_address(ip)):
            raise EgressDenied(
                f"{host} resolves to {ip}, which is a private/loopback/link-local "
                "address; allowlist the exact IP or set "
                "RF_TARGET_ALLOW_PRIVATE_EGRESS=1 if that is intended")
