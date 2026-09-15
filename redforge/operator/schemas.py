"""Typed operator intents and action contracts — voice and text resolve here."""
from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from redforge.schemas.campaign import TargetRequest


class OperatorRole(str, Enum):
    VIEWER = "viewer"
    OPERATOR = "operator"
    LEAD = "lead"


class ActionKind(str, Enum):
    NAVIGATE = "navigate"
    REPORT_STATUS = "report_status"
    START_CAMPAIGN = "start_campaign"
    INSPECT_FINDING = "inspect_finding"
    REVIEW_GATE = "review_gate"
    SIGN_GATE = "sign_gate"
    ABORT_CAMPAIGN = "abort_campaign"
    OPEN_DOSSIER = "open_dossier"
    GENERATE_DOSSIER = "generate_dossier"


# Actions that require explicit confirmation before execution.
CONFIRMATION_REQUIRED: frozenset[ActionKind] = frozenset({
    ActionKind.START_CAMPAIGN,
    ActionKind.ABORT_CAMPAIGN,
    ActionKind.SIGN_GATE,
    ActionKind.GENERATE_DOSSIER,
})

ALLOWED_ACTIONS: frozenset[ActionKind] = frozenset(ActionKind)

# Minimum role per action.
ROLE_REQUIREMENTS: dict[ActionKind, OperatorRole] = {
    ActionKind.NAVIGATE: OperatorRole.VIEWER,
    ActionKind.REPORT_STATUS: OperatorRole.VIEWER,
    ActionKind.START_CAMPAIGN: OperatorRole.OPERATOR,
    ActionKind.INSPECT_FINDING: OperatorRole.VIEWER,
    ActionKind.REVIEW_GATE: OperatorRole.VIEWER,
    ActionKind.SIGN_GATE: OperatorRole.LEAD,
    ActionKind.ABORT_CAMPAIGN: OperatorRole.OPERATOR,
    ActionKind.OPEN_DOSSIER: OperatorRole.VIEWER,
    ActionKind.GENERATE_DOSSIER: OperatorRole.OPERATOR,
}


class NavigateParams(BaseModel):
    route: str = Field(..., description="Console route path, e.g. /mission")


class StartCampaignParams(BaseModel):
    packs: list[str] | None = None
    rounds: int = Field(default=3, ge=1, le=3)
    #: Target selection. Part of the action, so it is covered by the action
    #: fingerprint the confirmation token binds to — a confirmation for a
    #: campaign against the fixture cannot be replayed against a live asset.
    target: TargetRequest | None = None


class InspectFindingParams(BaseModel):
    finding_id: str | None = None


class ReviewGateParams(BaseModel):
    gate_id: str | None = None


class SignGateParams(BaseModel):
    gate_id: str
    signer: str | None = None


class OperatorAction(BaseModel):
    kind: ActionKind
    params: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str | None = None
    idempotency_key: str | None = None

    @field_validator("kind", mode="before")
    @classmethod
    def _validate_kind(cls, v: Any) -> ActionKind:
        if isinstance(v, ActionKind):
            return v
        try:
            return ActionKind(str(v))
        except ValueError as e:
            raise ValueError(f"action not allowlisted: {v}") from e

    def fingerprint(self) -> str:
        payload = {"kind": self.kind.value, "params": self.params}
        raw = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


class ParsedIntent(BaseModel):
    action: OperatorAction
    confidence: float = 1.0
    source: Literal["text", "voice", "typed"] = "text"
    raw_input: str = ""


class ConfirmationRequest(BaseModel):
    token: str
    action: OperatorAction
    expires_at: str
    summary: str


class ActionResult(BaseModel):
    ok: bool
    kind: ActionKind
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = False
    confirmation: ConfirmationRequest | None = None
    correlation_id: str | None = None


class AuditDecision(str, Enum):
    ALLOWED = "allowed"
    DENIED = "denied"
    CONFIRMATION_REQUIRED = "confirmation_required"
    CONFIRMED = "confirmed"
    EXECUTED = "executed"
    FAILED = "failed"


class AuditRecord(BaseModel):
    id: str
    correlation_id: str
    actor: str
    role: OperatorRole
    action: ActionKind
    input_fingerprint: str
    decision: AuditDecision
    result_summary: str
    ts: str
    idempotency_key: str | None = None


class OperatorPlan(BaseModel):
    campaign_id: str | None = None
    running: bool = False
    current_step: str | None = None
    plan_steps: list[str] = Field(default_factory=list)
    evidence_count: int = 0
    blockers: list[str] = Field(default_factory=list)
    next_action: str | None = None
    findings_total: int = 0
    gates_pending: int = 0
