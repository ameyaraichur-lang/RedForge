"""Operator auth — demo-labeled vs secure self-hosted modes.

- demo: explicit RF_OPERATOR_DEMO_BOOTSTRAP=1 issues operator-only labeled sessions
- secure: username/password from server config → signed short-lived sessions (cookie + bearer)
- oidc: optional JWKS bearer verification extension (RF_OPERATOR_OIDC_JWKS_URL)

No arbitrary role escalation. Long-lived credentials never reach the browser bundle.
"""
from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response

from ..config import settings
from .schemas import OperatorRole
from .secrets import demo_session_secret
from .sessions import issue_session_token, verify_token

SESSION_COOKIE = "rf_operator_session"


@dataclass(frozen=True)
class OperatorPrincipal:
    actor: str
    role: OperatorRole
    auth_mode: str  # demo-labeled | secure | oidc


def session_secret() -> str:
    secret = settings.operator_session_secret.strip()
    if secret:
        return secret
    if settings.operator_auth_mode == "demo":
        return demo_session_secret()
    raise HTTPException(status_code=500, detail="RF_OPERATOR_SESSION_SECRET required in secure mode")


def _ttl_seconds() -> int:
    return max(60, settings.operator_session_ttl_minutes * 60)


def _parse_users() -> list[dict]:
    raw = settings.operator_secure_users.strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail="Invalid RF_OPERATOR_SECURE_USERS JSON") from e
    if not isinstance(data, list):
        raise HTTPException(status_code=500, detail="RF_OPERATOR_SECURE_USERS must be a JSON array")
    return data


def _verify_password(plain: str, stored: str) -> bool:
    """Verify plain password against pbkdf2 hash `pbkdf2:iter:salt:hex` or dev plain (test only)."""
    if stored.startswith("pbkdf2:"):
        try:
            _, iter_s, salt, digest = stored.split(":", 3)
            iters = int(iter_s)
            got = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), iters).hex()
            return hmac_compare(got, digest)
        except (ValueError, TypeError):
            return False
    if settings.operator_allow_plain_passwords and stored == plain:
        return True
    return False


def hmac_compare(a: str, b: str) -> bool:
    return secrets.compare_digest(a, b)


def authenticate_credentials(username: str, password: str) -> OperatorPrincipal:
    if settings.operator_auth_mode != "secure":
        raise HTTPException(status_code=403, detail="Password login only in secure auth mode")
    users = _parse_users()
    for u in users:
        if u.get("username") == username and _verify_password(password, str(u.get("password_hash") or u.get("password") or "")):
            role = OperatorRole(str(u.get("role", "operator")))
            return OperatorPrincipal(actor=username, role=role, auth_mode="secure")
    raise HTTPException(status_code=401, detail="Invalid credentials")


def create_session_response(principal: OperatorPrincipal, response: Response | None = None) -> dict:
    token, _ = issue_session_token(
        secret=session_secret(),
        actor=principal.actor,
        role=principal.role.value,
        auth_mode=principal.auth_mode,
        ttl_seconds=_ttl_seconds(),
    )
    body = {
        "authenticated": True,
        "actor": principal.actor,
        "role": principal.role.value,
        "auth_mode": principal.auth_mode,
        "expires_in": _ttl_seconds(),
        "demo_labeled": principal.auth_mode == "demo-labeled",
    }
    if response is not None:
        response.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            httponly=True,
            samesite="lax",
            max_age=_ttl_seconds(),
            path="/",
        )
    return body


def bootstrap_demo_session(response: Response | None = None) -> dict:
    if settings.operator_auth_mode != "demo":
        raise HTTPException(status_code=403, detail="Demo bootstrap disabled outside demo auth mode")
    if not settings.operator_demo_bootstrap:
        raise HTTPException(status_code=403, detail="Demo bootstrap not enabled (RF_OPERATOR_DEMO_BOOTSTRAP=0)")
    principal = OperatorPrincipal(
        actor="demo-operator",
        role=OperatorRole.OPERATOR,
        auth_mode="demo-labeled",
    )
    out = create_session_response(principal, response)
    out["label"] = "DEMO ONLY — not enterprise authentication"
    return out


def _principal_from_payload(payload: dict) -> OperatorPrincipal | None:
    if payload.get("typ") != "session":
        return None
    sub = payload.get("sub")
    role_raw = payload.get("role")
    mode = payload.get("mode", "secure")
    if not isinstance(sub, str) or not isinstance(role_raw, str):
        return None
    try:
        role = OperatorRole(role_raw)
    except ValueError:
        return None
    # demo-labeled sessions are always operator — never trust embedded role for escalation
    if mode == "demo-labeled":
        role = OperatorRole.OPERATOR
    return OperatorPrincipal(actor=sub, role=role, auth_mode=str(mode))


def _try_oidc_bearer(token: str) -> OperatorPrincipal | None:
    if not settings.operator_oidc_jwks_url.strip():
        return None
    from .oidc import verify_oidc_token  # lazy import

    return verify_oidc_token(token)


def resolve_principal(request: Request) -> OperatorPrincipal:
    token: str | None = None
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.cookies.get(SESSION_COOKIE)

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    secret = session_secret()
    payload = verify_token(token, secret)
    if payload:
        principal = _principal_from_payload(payload)
        if principal:
            return principal

    oidc = _try_oidc_bearer(token)
    if oidc:
        return oidc

    raise HTTPException(status_code=403, detail="Invalid or expired session")


def role_at_least(have: OperatorRole, need: OperatorRole) -> bool:
    order = [OperatorRole.VIEWER, OperatorRole.OPERATOR, OperatorRole.LEAD]
    return order.index(have) >= order.index(need)
