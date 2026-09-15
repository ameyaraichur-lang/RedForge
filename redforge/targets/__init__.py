"""Target plane (M1): the vulnerable demo target + the adapters used to attack it."""
from .adapter import DEMO_BASE_URL, ChatResponse, OpenAICompatibleTarget, demo_adapter
from .app import app, create_app
from .factory import get_target_adapter, resolve_endpoint, target_adapter_kind
from .protocol import TargetAdapter, TargetCapabilityError
from .registry import (
    TargetEndpoint,
    TargetResolutionError,
    canonical_provider,
    providers,
    register,
)
from .vuln_sim import VulnerableSimulator

__all__ = [
    "VulnerableSimulator", "create_app", "app",
    # contract + implementations
    "TargetAdapter", "TargetCapabilityError",
    "OpenAICompatibleTarget", "ChatResponse", "DEMO_BASE_URL",
    # selection
    "demo_adapter", "get_target_adapter", "resolve_endpoint", "target_adapter_kind",
    "TargetEndpoint", "TargetResolutionError", "canonical_provider",
    "providers", "register",
]
