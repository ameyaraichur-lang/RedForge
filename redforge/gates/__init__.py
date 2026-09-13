"""Milestone gate helpers — demo/offline isolation for CI and release runners."""

from .demo_env import apply_gate_demo_env, gate_demo_env

__all__ = ["apply_gate_demo_env", "gate_demo_env"]
