"""Egress policy for caller-supplied targets — SSRF and credential guardrails.

Regression suite for a hole introduced when target selection first shipped:
``TargetRequest`` accepted an arbitrary ``base_url`` plus an arbitrary
``api_key_env``, and ``POST /api/campaign/start`` had no authentication. An
unauthenticated caller could therefore make the server send hostile payloads to
an address of their choosing with any server-side secret in the Authorization
header — ``RF_ASTRA_API_KEY``, the operator audit signing key, anything.

Three independent layers now stand between a request and an outbound
connection, and each is asserted on its own here so no single one is
load-bearing:

1. authorisation — choosing a target requires an operator session,
2. credential slots — only ``RF_TARGET_CRED_*`` is readable,
3. the URL allowlist plus an SSRF range check, both failing closed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

from redforge.config import settings
from redforge.schemas.campaign import TargetRequest
from redforge.targets import resolve_endpoint
from redforge.targets.egress import (
    EgressDenied,
    assert_credential_slot,
    assert_url_permitted,
)

#: A name an attacker would want, and the kind the old code happily read.
TEMPTING_SECRETS = [
    "RF_ASTRA_API_KEY",
    "RF_OPERATOR_AUDIT_SIGNING_KEY",
    "RF_OPERATOR_SESSION_SECRET",
    "RF_TARGET_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "PATH",
]


# ------------------------------------------------------- credential slots


@pytest.mark.parametrize("name", TEMPTING_SECRETS)
def test_only_dedicated_credential_slots_are_readable(name):
    with pytest.raises(EgressDenied, match="credential slot"):
        assert_credential_slot(name)


def test_credential_slot_names_are_accepted():
    assert_credential_slot("RF_TARGET_CRED_PROD")
    assert_credential_slot("RF_TARGET_CRED_STAGING_2")


@pytest.mark.parametrize("name", ["", "rf_target_cred_lower", "RF_TARGET_CRED_",
                                  "RF_TARGET_CRED_x", "XRF_TARGET_CRED_A"])
def test_malformed_slot_names_are_refused(name):
    with pytest.raises(EgressDenied):
        assert_credential_slot(name)


# ------------------------------------------------------------- URL policy


def test_no_allowlist_means_callers_cannot_choose_a_url():
    """Fail closed: the default deployment permits no caller-supplied URL."""
    with pytest.raises(EgressDenied, match="disabled"):
        assert_url_permitted("https://evil.example/v1", allowlist="")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "gopher://x/v1",
                                 "ftp://x/v1", "//evil.example/v1"])
def test_only_http_schemes_are_allowed(url):
    with pytest.raises(EgressDenied, match="http or https|no host"):
        assert_url_permitted(url, allowlist="evil.example,x")


def test_host_outside_the_allowlist_is_denied():
    with pytest.raises(EgressDenied, match="not in RF_TARGET_URL_ALLOWLIST"):
        assert_url_permitted("https://evil.example/v1",
                             allowlist="approved.example")


def test_allowlisted_host_is_permitted():
    assert_url_permitted("https://203.0.113.10/v1", allowlist="203.0.113.10")


def test_allowlist_port_must_match_when_specified():
    assert_url_permitted("http://203.0.113.10:8901/v1",
                         allowlist="203.0.113.10:8901")
    with pytest.raises(EgressDenied, match="not in RF_TARGET_URL_ALLOWLIST"):
        assert_url_permitted("http://203.0.113.10:9999/v1",
                             allowlist="203.0.113.10:8901")


def test_wildcard_allowlist_matches_subdomains_only():
    assert_url_permitted("https://staging.corp.example/v1",
                         allowlist="*.corp.example", allow_private=True)
    with pytest.raises(EgressDenied, match="not in RF_TARGET_URL_ALLOWLIST"):
        assert_url_permitted("https://corp.example.evil/v1",
                             allowlist="*.corp.example", allow_private=True)


# ------------------------------------------------------------- SSRF ranges


def test_hostname_resolving_into_a_private_range_is_denied():
    """'localhost' is allowlisted here yet still blocked: a name that resolves
    inside the perimeter is the SSRF case the allowlist alone cannot catch."""
    with pytest.raises(EgressDenied, match="private/loopback/link-local"):
        assert_url_permitted("http://localhost:8901/v1", allowlist="localhost")


def test_private_ranges_are_reachable_when_explicitly_permitted():
    assert_url_permitted("http://localhost:8901/v1", allowlist="localhost",
                         allow_private=True)


def test_exact_ip_literal_allowlisting_is_honoured_without_the_override():
    """Naming one address is unambiguous, so the fixture stays testable."""
    assert_url_permitted("http://127.0.0.1:8901/v1", allowlist="127.0.0.1")


def test_link_local_metadata_address_is_denied_by_name():
    with pytest.raises(EgressDenied):
        assert_url_permitted("http://metadata.google.internal/v1",
                             allowlist="metadata.google.internal")


def test_unresolvable_host_is_denied_rather_than_attempted():
    with pytest.raises(EgressDenied, match="cannot resolve|not in RF_TARGET"):
        assert_url_permitted("https://nx.invalid/v1", allowlist="nx.invalid")


# ------------------------------------------------------ through resolution


def test_resolution_refuses_a_non_slot_credential(monkeypatch):
    monkeypatch.setenv("RF_ASTRA_API_KEY", "astra-secret")
    monkeypatch.setattr(settings, "target_url_allowlist", "203.0.113.7")
    with pytest.raises(EgressDenied, match="credential slot"):
        resolve_endpoint(TargetRequest(provider="openai-compatible",
                                       base_url="https://203.0.113.7/v1",
                                       api_key_env="RF_ASTRA_API_KEY"))


def test_resolution_refuses_a_non_allowlisted_url(monkeypatch):
    monkeypatch.setenv("RF_TARGET_CRED_OK", "k")
    monkeypatch.setattr(settings, "target_url_allowlist", "approved.example")
    with pytest.raises(EgressDenied, match="not in RF_TARGET_URL_ALLOWLIST"):
        resolve_endpoint(TargetRequest(provider="openai-compatible",
                                       base_url="https://evil.example/v1",
                                       api_key_env="RF_TARGET_CRED_OK"))


def test_deployer_configured_url_is_not_allowlist_checked(monkeypatch):
    """The key compatibility property: RF_TARGET_BASE_URL is set by whoever
    runs the server, so the bundled fixture on loopback keeps working with no
    allowlist configured at all."""
    monkeypatch.setattr(settings, "target_provider", "real")
    monkeypatch.setattr(settings, "target_api_key", "k")
    monkeypatch.setattr(settings, "target_base_url", "http://127.0.0.1:8901/v1")
    monkeypatch.setattr(settings, "target_url_allowlist", "")
    endpoint = resolve_endpoint()
    assert endpoint.provider == "openai-compatible"
    assert endpoint.base_url == "http://127.0.0.1:8901/v1"


def test_allowlisted_caller_url_with_a_slot_credential_resolves(monkeypatch):
    monkeypatch.setenv("RF_TARGET_CRED_PROD", "prod-key")
    monkeypatch.setattr(settings, "target_url_allowlist", "203.0.113.7:443")
    endpoint = resolve_endpoint(TargetRequest(provider="openai-compatible",
                                              base_url="https://203.0.113.7/v1",
                                              api_key_env="RF_TARGET_CRED_PROD"))
    assert endpoint.base_url == "https://203.0.113.7/v1"
    assert endpoint.api_key == "prod-key"


def test_demo_provider_ignores_a_caller_url_without_egress_check(monkeypatch):
    """No connection is made, so there is nothing to guard."""
    monkeypatch.setattr(settings, "target_url_allowlist", "")
    endpoint = resolve_endpoint(TargetRequest(base_url="https://evil.example/v1"))
    assert endpoint.provider == "demo"


# --------------------------------------------------------------- API layer


@pytest.fixture(scope="module")
def api():
    """A default deployment: no egress allowlist configured."""
    port = allocate_port()
    with uvicorn_server(port=port) as base:
        yield base


@pytest.fixture(scope="module")
def api_allowlisted():
    """A deployment that HAS authorised a host, to isolate the credential layer."""
    port = allocate_port()
    env = {**os.environ, "RF_LLM_PROVIDER": "demo",
           "RF_TARGET_URL_ALLOWLIST": "127.0.0.1"}
    with uvicorn_server(port=port, env=env) as base:
        yield base


def test_unauthenticated_caller_cannot_choose_a_target(api):
    """The original exploit, verbatim."""
    r = httpx.post(f"{api}/api/campaign/start", timeout=30, json={
        "packs": ["PIN"], "rounds": 1,
        "target": {"provider": "openai-compatible",
                   "base_url": "http://127.0.0.1:1/v1",
                   "api_key_env": "RF_ASTRA_API_KEY"},
    })
    assert r.status_code == 401, r.text


def test_unauthenticated_default_start_still_works(api):
    """Only target selection was gated; the existing demo flow is unchanged."""
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1}, timeout=30)
    assert r.status_code == 200, r.text
    httpx.post(f"{api}/api/campaign/abort", timeout=30)


def test_authenticated_operator_still_cannot_name_a_secret(api_allowlisted):
    """Layer 2 holds on its own: valid session, and a URL this server allows."""
    client = httpx.Client(base_url=api_allowlisted, timeout=30)
    assert client.post("/api/operator/bootstrap").status_code == 200
    r = client.post("/api/campaign/start", json={
        "packs": ["PIN"], "rounds": 1,
        "target": {"provider": "openai-compatible",
                   "base_url": "http://127.0.0.1:1/v1",
                   "api_key_env": "RF_ASTRA_API_KEY"},
    })
    client.close()
    assert r.status_code == 400, r.text
    assert "credential slot" in r.json()["error"]


def test_authenticated_operator_still_cannot_reach_a_new_url(api):
    """Layer 3 holds on its own: no allowlist is configured on this server, and
    the URL is rejected before any credential is consulted."""
    client = httpx.Client(base_url=api, timeout=30)
    assert client.post("/api/operator/bootstrap").status_code == 200
    r = client.post("/api/campaign/start", json={
        "packs": ["PIN"], "rounds": 1,
        "target": {"provider": "openai-compatible",
                   "base_url": "http://169.254.169.254/v1",
                   "api_key_env": "RF_TARGET_CRED_PROD"},
    })
    client.close()
    assert r.status_code == 400, r.text
    assert "disabled" in r.json()["error"], r.json()


def test_viewer_role_cannot_choose_a_target():
    """Authenticated but unprivileged: selection needs operator or above."""
    port = allocate_port()
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_OPERATOR_AUTH_MODE": "secure",
        "RF_OPERATOR_DEMO_BOOTSTRAP": "0",
        "RF_OPERATOR_SESSION_SECRET": "test-secure-secret-min-16-chars",
        "RF_OPERATOR_AUDIT_SIGNING_KEY": "test-secure-audit-signing-key-32b",
        "RF_OPERATOR_ALLOW_PLAIN_PASSWORDS": "1",
        "RF_OPERATOR_SECURE_USERS": json.dumps([
            {"username": "looker", "password": "viewer-pass", "role": "viewer"},
        ]),
    }
    with uvicorn_server(port=port, env=env) as base:
        client = httpx.Client(base_url=base, timeout=30)
        login = client.post("/api/operator/login",
                            json={"username": "looker", "password": "viewer-pass"})
        assert login.status_code == 200, login.text
        r = client.post("/api/campaign/start",
                        json={"packs": ["MEM"], "rounds": 1,
                              "target": {"target_id": "TGT-04"}})
        client.close()
        assert r.status_code == 403, r.text
        assert "operator role" in r.json()["detail"]
