"""Operator signing-key policy — secure mode rejects unsafe defaults."""
from __future__ import annotations

from ..config import settings

_DEMO_SESSION_SECRET = "rf-dev-session-secret-not-for-production"
_DEMO_AUDIT_SIGNING_KEY = "rf-dev-audit-signing-key-not-for-production"
_MIN_SECRET_LEN = 24

_UNSAFE_SECRETS = frozenset({
    _DEMO_SESSION_SECRET,
    _DEMO_AUDIT_SIGNING_KEY,
    "changeme",
    "secret",
    "test",
})


def demo_session_secret() -> str:
    return _DEMO_SESSION_SECRET


def demo_audit_signing_key() -> str:
    return _DEMO_AUDIT_SIGNING_KEY


def _is_unsafe_secret(value: str) -> bool:
    v = value.strip()
    if not v or len(v) < _MIN_SECRET_LEN:
        return True
    if v.lower() in _UNSAFE_SECRETS:
        return True
    return False


def audit_signing_key() -> str:
    """Return HMAC chain signing key; demo uses labeled dev default only."""
    explicit = settings.operator_audit_signing_key.strip()
    if explicit:
        if settings.operator_auth_mode == "secure" and _is_unsafe_secret(explicit):
            raise RuntimeError(
                "RF_OPERATOR_AUDIT_SIGNING_KEY is missing or uses an unsafe default in secure mode",
            )
        return explicit
    if settings.operator_auth_mode == "demo":
        return _DEMO_AUDIT_SIGNING_KEY
    raise RuntimeError("RF_OPERATOR_AUDIT_SIGNING_KEY required in secure mode")


def assert_secure_operator_config() -> None:
    """Fail loudly when secure mode is configured with development defaults."""
    if settings.operator_auth_mode != "secure":
        return
    secret = settings.operator_session_secret.strip()
    if _is_unsafe_secret(secret):
        raise RuntimeError(
            "RF_OPERATOR_SESSION_SECRET is missing or uses an unsafe default in secure mode "
            f"(minimum {_MIN_SECRET_LEN} characters)",
        )
    audit_signing_key()  # raises if unsafe/missing
