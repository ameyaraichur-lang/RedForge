"""Authorisation to test: who signed off on attacking this asset, and until when.

An allowlist answers "can this deployment reach that host". It does not answer
"is anyone allowed to attack it", which is the question that separates a red
team from an attack. This module holds the second answer: a deployment-supplied
record naming the asset, the owner who approved it, and the window the approval
covers.

The records are read from a file the operator controls
(``RF_TARGET_AUTHORIZATIONS``), never from the campaign request — an
authorisation a caller can mint is not an authorisation. Non-demo targets are
denied when no record covers them, so forgetting the file fails closed.

The bundled fixture is exempt: it ships with the repo, it is the thing the
release gates attack, and there is no third party to get permission from.

File format (JSON, list or ``{"authorizations": [...]}``)::

    [
      {
        "target_id": "TGT-04",
        "scope": ["api.acme.example", "127.0.0.1"],
        "owner": "platform-team@acme.example",
        "approver": "ciso@acme.example",
        "reference": "CHG-11821",
        "not_before": "2026-09-01T00:00:00Z",
        "not_after":  "2026-09-30T00:00:00Z"
      }
    ]
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from .registry import TargetResolutionError

#: Target ids that need no third-party sign-off (shipped with the repo).
EXEMPT_TARGET_IDS = frozenset({"TGT-DEMO"})


class AuthorizationError(TargetResolutionError):
    """No valid authorisation-to-test covers the requested target."""


class EngagementAuthorization(BaseModel):
    """One signed-off engagement window for one asset."""

    target_id: str
    owner: str = Field(min_length=1, description="asset owner who approved the test")
    approver: str = Field(min_length=1, description="who granted the authorisation")
    scope: list[str] = Field(default_factory=list,
                             description="hostnames or IPs this approval covers")
    reference: str = ""     # change ticket / engagement letter
    not_before: datetime
    not_after: datetime

    @field_validator("not_before", "not_after")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        """Naive timestamps are read as UTC so a missing zone cannot widen
        the window by the server's local offset."""
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def covers_host(self, host: str) -> bool:
        host = (host or "").lower()
        for entry in self.scope:
            entry = entry.strip().lower()
            if not entry:
                continue
            if entry == host:
                return True
            if entry.startswith("*.") and host.endswith(entry[1:]):
                return True
        return False

    def window_contains(self, moment: datetime) -> bool:
        return self.not_before <= moment <= self.not_after


def _records_from(payload: object) -> list[dict]:
    if isinstance(payload, dict):
        payload = payload.get("authorizations", [])
    if not isinstance(payload, list):
        raise AuthorizationError(
            "authorisation file must hold a list of records or "
            '{"authorizations": [...]}')
    return [r for r in payload if isinstance(r, dict)]


def load_authorizations(path: str) -> list[EngagementAuthorization]:
    """Parse the operator-controlled authorisation file."""
    if not path:
        return []
    source = Path(path).expanduser()
    if not source.is_file():
        raise AuthorizationError(
            f"RF_TARGET_AUTHORIZATIONS points at {path!r}, which is not a file")
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AuthorizationError(
            f"cannot read authorisations from {path!r}: {exc}") from exc

    records: list[EngagementAuthorization] = []
    for raw in _records_from(payload):
        try:
            records.append(EngagementAuthorization(**raw))
        except Exception as exc:                      # pydantic validation
            raise AuthorizationError(
                f"invalid authorisation record {raw.get('target_id', '?')!r}: "
                f"{exc}") from exc
    return records


def assert_authorized(target_id: str, base_url: str, *, path: str,
                      now: datetime | None = None) -> EngagementAuthorization | None:
    """Require a live authorisation covering this target and host.

    Returns the matching record (``None`` for exempt targets) so the caller can
    put the owner and reference into the audit trail.
    """
    if (target_id or "").strip().upper() in EXEMPT_TARGET_IDS:
        return None

    moment = now or datetime.now(timezone.utc)
    host = (urlsplit(base_url).hostname or "").lower()
    if not host:
        raise AuthorizationError(
            f"cannot authorise a test of {target_id!r}: no host in base_url "
            f"{base_url!r}")

    records = load_authorizations(path)
    if not records:
        raise AuthorizationError(
            f"no authorisation-to-test on file for {target_id!r} ({host}). "
            "Attacking a third-party asset requires a recorded approval: set "
            "RF_TARGET_AUTHORIZATIONS to a file naming the asset owner, the "
            "approver and the window they approved.")

    for_target = [r for r in records
                  if r.target_id.strip().upper() == (target_id or "").strip().upper()]
    if not for_target:
        known = ", ".join(sorted({r.target_id for r in records})) or "none"
        raise AuthorizationError(
            f"no authorisation-to-test on file for {target_id!r}; "
            f"authorised targets: {known}")

    in_scope = [r for r in for_target if r.covers_host(host)]
    if not in_scope:
        scopes = ", ".join(sorted({s for r in for_target for s in r.scope})) or "none"
        raise AuthorizationError(
            f"{host} is outside the authorised scope for {target_id!r} "
            f"(authorised: {scopes})")

    live = [r for r in in_scope if r.window_contains(moment)]
    if not live:
        windows = "; ".join(f"{r.not_before.isoformat()} .. {r.not_after.isoformat()}"
                            for r in in_scope)
        raise AuthorizationError(
            f"authorisation for {target_id!r} on {host} is not valid at "
            f"{moment.isoformat()} (approved windows: {windows})")

    # Longest remaining window wins when several records overlap.
    return max(live, key=lambda r: r.not_after)
