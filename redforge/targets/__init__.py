"""Target plane (M1): the vulnerable demo target + the adapter used to attack it."""
from .adapter import ChatResponse, TargetAdapter, demo_adapter
from .app import app, create_app
from .factory import get_target_adapter, target_adapter_kind
from .vuln_sim import VulnerableSimulator

__all__ = [
    "VulnerableSimulator", "create_app", "app",
    "TargetAdapter", "ChatResponse",
    "demo_adapter", "get_target_adapter", "target_adapter_kind",
]
