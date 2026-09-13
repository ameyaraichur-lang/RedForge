"""Target adapter factory — demo or OpenAI-compatible real mode.

Astra is judge-only (LLM validation); it is never selected as a campaign target.
"""
from __future__ import annotations

from typing import Any

from redforge.config import effective_target_provider, settings

from .adapter import TargetAdapter, demo_adapter


def get_target_adapter() -> Any:
    """Return the configured campaign target adapter (demo-mode-first when unset)."""
    provider = effective_target_provider()
    if provider == "real" and settings.target_api_key:
        return TargetAdapter(settings.target_base_url.rstrip("/"),
                             api_key=settings.target_api_key)
    return demo_adapter()


def target_adapter_kind(adapter: Any) -> str:
    """Short label for health/status endpoints."""
    base_url = getattr(adapter, "base_url", "")
    if base_url in ("http://demo.local/v1", demo_adapter().base_url):
        return "demo"
    if base_url:
        return "openai-compatible"
    return "demo"
