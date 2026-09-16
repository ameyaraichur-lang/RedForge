"""Resolve a campaign target request into a built adapter.

Two entry paths, with deliberately different failure behaviour:

* **Env-driven** (no explicit request) keeps the historical contract — an
  incompletely configured ``real`` target degrades to the demo fixture, so an
  unconfigured checkout still runs.
* **Explicit** (the caller named a target, provider, or URL) never degrades. If
  it cannot be built as asked it raises, because silently attacking the local
  fixture while reporting a scorecard for someone else's asset is worse than
  failing the request.

Astra is judge-only; it is rejected here, in the registry, and in
``config.effective_target_provider()``.
"""
from __future__ import annotations

import os

from redforge.config import effective_target_provider, settings
from redforge.schemas.campaign import TargetRequest, TargetSpec

from .authorization import EngagementAuthorization, assert_authorized
from .egress import assert_credential_slot, assert_url_permitted
from .protocol import TargetAdapter
from .registry import (
    JUDGE_ONLY_PROVIDERS,
    TargetEndpoint,
    TargetResolutionError,
    build,
    canonical_provider,
    kind_for,
)


def resolve_endpoint(
    request: TargetRequest | None = None,
    spec: TargetSpec | None = None,
) -> TargetEndpoint:
    """Work out which provider to use and how to reach it."""
    request = request or TargetRequest()
    explicit = request.is_explicit()

    provider = canonical_provider(
        request.provider or effective_target_provider())
    if provider in JUDGE_ONLY_PROVIDERS:
        # Defence in depth: effective_target_provider() already coerces this.
        if explicit and request.provider:
            raise TargetResolutionError(
                f"{request.provider} is judge-only and cannot be a campaign target")
        provider = "demo"

    # Precedence: explicit request, then the catalogue spec's own endpoint,
    # then the environment default. Only the first is caller-controlled, and
    # only that case is subject to the egress allowlist.
    url_from_caller = bool(request.base_url)
    base_url = (request.base_url
                or (spec.base_url if spec else "")
                or settings.target_base_url)

    # Checked before any credential is read, so the error cannot be used to
    # probe which credential slots this server holds. The demo builder ignores
    # base_url, so there is nothing to guard on that path.
    if url_from_caller and provider != "demo":
        assert_url_permitted(
            base_url,
            allowlist=settings.target_url_allowlist,
            allow_private=settings.target_allow_private_egress,
        )

    if request.api_key_env:
        assert_credential_slot(request.api_key_env)
        api_key = os.environ.get(request.api_key_env, "")
        if not api_key:
            raise TargetResolutionError(
                f"api_key_env={request.api_key_env!r} is unset or empty on the server")
    else:
        api_key = settings.target_api_key

    if provider != "demo" and not api_key:
        if explicit:
            raise TargetResolutionError(
                f"provider {provider!r} needs a credential; set RF_TARGET_API_KEY "
                "or pass api_key_env")
        # Legacy env path: an unconfigured real target falls back to the fixture.
        provider, base_url = "demo", ""

    return TargetEndpoint(provider=provider, base_url=base_url, api_key=api_key)


def get_target_adapter(
    request: TargetRequest | None = None,
    spec: TargetSpec | None = None,
) -> TargetAdapter:
    """Return the adapter for this campaign (demo-mode-first when unset).

    This is the last point before a client capable of attacking something
    exists, so the authorisation-to-test check lives here rather than in
    ``resolve_endpoint`` — health and status endpoints resolve an endpoint to
    report the provider and must not be made to fail by a missing approval.
    """
    endpoint = resolve_endpoint(request, spec)
    if endpoint.provider != "demo":
        assert_authorized(
            (spec.id if spec else request.target_id if request else "") or "unknown",
            endpoint.base_url,
            path=settings.target_authorizations_path,
        )
    return build(endpoint)


def authorization_for(
    request: TargetRequest | None = None,
    spec: TargetSpec | None = None,
) -> EngagementAuthorization | None:
    """The approval record covering this target, for the audit trail."""
    endpoint = resolve_endpoint(request, spec)
    if endpoint.provider == "demo":
        return None
    return assert_authorized(
        (spec.id if spec else request.target_id if request else "") or "unknown",
        endpoint.base_url,
        path=settings.target_authorizations_path,
    )


def target_adapter_kind(adapter: TargetAdapter) -> str:
    """Short label for health/status endpoints."""
    from .adapter import DEMO_BASE_URL

    base_url = getattr(adapter, "base_url", "")
    if not base_url or base_url.rstrip("/") == DEMO_BASE_URL:
        return "demo"
    return kind_for("openai-compatible")


def endpoint_kind(endpoint: TargetEndpoint) -> str:
    """The same label from a resolved endpoint, without building a client.

    Health and status endpoints use this: building an adapter now requires an
    authorisation-to-test, and a deployment with no approval on file is not
    unhealthy — it just cannot start a campaign yet.
    """
    from .adapter import DEMO_BASE_URL

    if endpoint.provider == "demo":
        return "demo"
    if not endpoint.base_url or endpoint.base_url.rstrip("/") == DEMO_BASE_URL:
        return "demo"
    return kind_for("openai-compatible")
