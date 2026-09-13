"""Policy hook for operator actions — extension point for OPA / enterprise rules."""
from __future__ import annotations

from .auth import OperatorPrincipal
from .schemas import ActionKind, OperatorAction


class PolicyDecision:
    __slots__ = ("allowed", "reason")

    def __init__(self, allowed: bool, reason: str = "") -> None:
        self.allowed = allowed
        self.reason = reason


def evaluate_policy(principal: OperatorPrincipal, action: OperatorAction) -> PolicyDecision:
    """Default policy: allow all allowlisted actions for authenticated principals."""
    if action.kind == ActionKind.START_CAMPAIGN:
        rounds = action.params.get("rounds", 3)
        if isinstance(rounds, int) and rounds > 3:
            return PolicyDecision(False, "rounds capped at 3 for bounded campaigns")
    return PolicyDecision(True)
