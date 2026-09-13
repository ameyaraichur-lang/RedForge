"""HMAC-signed short-lived session and confirmation tokens (stdlib only)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from fastapi import HTTPException


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_payload(payload: dict[str, Any], secret: str) -> str:
    if not secret:
        raise HTTPException(status_code=500, detail="Operator session secret not configured")
    header = _b64url(json.dumps({"alg": "HS256", "typ": "RFST"}, separators=(",", ":")).encode())
    body = _b64url(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
    msg = f"{header}.{body}".encode()
    sig = _b64url(hmac.new(secret.encode(), msg, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


def verify_token(token: str, secret: str) -> dict[str, Any] | None:
    if not token or not secret:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b, body_b, sig_b = parts
    msg = f"{header_b}.{body_b}".encode()
    expected = _b64url(hmac.new(secret.encode(), msg, hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig_b):
        return None
    try:
        payload = json.loads(_b64url_decode(body_b))
    except (json.JSONDecodeError, ValueError):
        return None
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and time.time() > float(exp):
        return None
    return payload


def issue_session_token(
    *,
    secret: str,
    actor: str,
    role: str,
    auth_mode: str,
    ttl_seconds: int,
) -> tuple[str, str]:
    exp = int(time.time()) + ttl_seconds
    payload = {
        "typ": "session",
        "sub": actor,
        "role": role,
        "mode": auth_mode,
        "exp": exp,
        "iat": int(time.time()),
        "jti": secrets.token_hex(8),
    }
    return sign_payload(payload, secret), payload["jti"]


def issue_confirmation_token(
    *,
    secret: str,
    actor: str,
    fingerprint: str,
    action: dict[str, Any],
    summary: str,
    ttl_seconds: int = 300,
) -> str:
    payload = {
        "typ": "confirm",
        "sub": actor,
        "fp": fingerprint,
        "action": action,
        "summary": summary,
        "exp": int(time.time()) + ttl_seconds,
        "iat": int(time.time()),
        "jti": secrets.token_hex(10),
    }
    return sign_payload(payload, secret)
