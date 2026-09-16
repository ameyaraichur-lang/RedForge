"""Target plane (M1): the vulnerable demo target + the adapters used to attack it."""
from .adapter import DEMO_BASE_URL, ChatResponse, OpenAICompatibleTarget, demo_adapter
from .app import app, create_app
from .authorization import (AuthorizationError, EngagementAuthorization,
                            assert_authorized, load_authorizations)
from .factory import (authorization_for, endpoint_kind, get_target_adapter,
                      resolve_endpoint, target_adapter_kind)
from .protocol import TargetAdapter, TargetCapabilityError
from .safety import (CEILINGS, caps_for_target, ceiling_for, clamped_fields,
                     safety_briefing)
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
    "endpoint_kind",
    "TargetEndpoint", "TargetResolutionError", "canonical_provider",
    "providers", "register",
    # authorisation to test
    "AuthorizationError", "EngagementAuthorization", "assert_authorized",
    "load_authorizations", "authorization_for",
    # criticality-derived safety limits
    "CEILINGS", "caps_for_target", "ceiling_for", "clamped_fields",
    "safety_briefing",
]
