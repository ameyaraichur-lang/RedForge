"""OIDC/JWKS extension point — optional external IdP bearer verification."""
from __future__ import annotations

import httpx

from ..config import settings
from .auth import OperatorPrincipal
from .schemas import OperatorRole


def verify_oidc_token(token: str) -> OperatorPrincipal | None:
    """Verify RS256 OIDC access token against configured JWKS (extension hook).

    Returns None when JWKS URL is unset or verification fails.
    Full Keycloak deployment wiring is out of scope; this hook is real and testable
    with a local JWKS fixture in contract tests.
    """
    jwks_url = settings.operator_oidc_jwks_url.strip()
    if not jwks_url:
        return None
    try:
        import jwt  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        jwks = httpx.get(jwks_url, timeout=5).json()
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not key:
            return None
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.operator_oidc_audience or None,
            issuer=settings.operator_oidc_issuer or None,
            options={"verify_aud": bool(settings.operator_oidc_audience)},
        )
    except Exception:
        return None

    sub = str(claims.get("sub") or claims.get("preferred_username") or "")
    if not sub:
        return None
    roles = claims.get("roles") or claims.get("realm_access", {}).get("roles") or []
    role = OperatorRole.LEAD if "lead" in roles else OperatorRole.OPERATOR
    return OperatorPrincipal(actor=sub, role=role, auth_mode="oidc")
