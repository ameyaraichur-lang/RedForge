"""Provider registry — target id/provider to adapter builder.

Replaces the two-branch ``if provider == "real" ... else demo`` that used to
live in ``factory.py``. A new target type registers a builder here and becomes
selectable from the API without touching the engine or the factory.

Astra is deliberately absent and is rejected at registration and lookup time:
it is the judge, and a judge that is also the target cannot grade itself. That
rule is enforced here as well as in ``config.effective_target_provider()`` so
neither path alone is load-bearing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

from .adapter import DEMO_BASE_URL, OpenAICompatibleTarget, demo_adapter
from .protocol import TargetAdapter

#: Never a campaign target, whatever the caller asks for.
JUDGE_ONLY_PROVIDERS = frozenset({"astra"})


class TargetResolutionError(ValueError):
    """The requested target/provider cannot be built as asked."""


@dataclass(frozen=True)
class TargetEndpoint:
    """Where and how to reach a target, resolved from a spec plus settings."""

    provider: str
    base_url: str = ""
    api_key: str = ""


class AdapterBuilder(Protocol):
    def __call__(self, endpoint: TargetEndpoint) -> TargetAdapter: ...


_BUILDERS: dict[str, AdapterBuilder] = {}
_KINDS: dict[str, str] = {}


def register(provider: str, *, kind: str) -> Callable[[AdapterBuilder], AdapterBuilder]:
    """Register a builder for ``provider``. ``kind`` is the health-output label."""
    key = provider.strip().lower()
    if not key:
        raise TargetResolutionError("provider id must not be empty")
    if key in JUDGE_ONLY_PROVIDERS:
        raise TargetResolutionError(f"{key} is judge-only and cannot be a target")
    if key in _BUILDERS:
        raise TargetResolutionError(f"duplicate target provider: {key}")

    def _wrap(builder: AdapterBuilder) -> AdapterBuilder:
        _BUILDERS[key] = builder
        _KINDS[key] = kind
        return builder

    return _wrap


def providers() -> list[str]:
    """Registered provider ids, excluding judge-only ones by construction."""
    return sorted(_BUILDERS)


def kind_for(provider: str) -> str:
    return _KINDS.get(provider.strip().lower(), "demo")


def build(endpoint: TargetEndpoint) -> TargetAdapter:
    """Build the adapter for ``endpoint``, or raise ``TargetResolutionError``."""
    key = endpoint.provider.strip().lower()
    if key in JUDGE_ONLY_PROVIDERS:
        raise TargetResolutionError(
            f"{key} is judge-only and cannot be used as a campaign target")
    builder = _BUILDERS.get(key)
    if builder is None:
        raise TargetResolutionError(
            f"unknown target provider {endpoint.provider!r}; "
            f"registered: {', '.join(providers())}")
    return builder(endpoint)


# ------------------------------------------------------------------ builtins


@register("demo", kind="demo")
def _demo(endpoint: TargetEndpoint) -> TargetAdapter:
    """The bundled vulnerable fixture, in-process over an ASGI transport."""
    return demo_adapter()


@register("openai-compatible", kind="openai-compatible")
def _openai_compatible(endpoint: TargetEndpoint) -> TargetAdapter:
    if not endpoint.base_url:
        raise TargetResolutionError(
            "openai-compatible target requires a base_url "
            "(set RF_TARGET_BASE_URL or pass target.base_url)")
    if endpoint.base_url.rstrip("/") == DEMO_BASE_URL:
        raise TargetResolutionError(
            f"{DEMO_BASE_URL} is the in-process fixture address and is not "
            "reachable over HTTP; use provider 'demo' instead")
    return OpenAICompatibleTarget(endpoint.base_url.rstrip("/"),
                                  api_key=endpoint.api_key)


#: Historical alias: ``RF_TARGET_PROVIDER=real`` predates named providers.
PROVIDER_ALIASES: dict[str, str] = {"real": "openai-compatible"}


def canonical_provider(provider: str) -> str:
    """Resolve aliases (``real`` -> ``openai-compatible``) to a registered id."""
    key = provider.strip().lower()
    return PROVIDER_ALIASES.get(key, key)
