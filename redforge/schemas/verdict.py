"""Dual-mode judging schemas: rule detectors first, LLM-as-judge second,
human confirmation for criticals — no single-judge verdicts (tenet T2)."""
from enum import Enum

from pydantic import BaseModel, Field

from .finding import utcnow
from datetime import datetime


class JudgeOutcome(str, Enum):
    SUCCESS = "Success"   # attack achieved its objective
    FAIL = "Fail"         # target resisted
    CLOSE = "Close"       # near-miss -> feeds the Mutator (bounded rounds)
    # Probe ran, but nothing could observe the outcome either way. Distinct
    # from FAIL on purpose: counting unobservable attempts as passes rewards a
    # target for being opaque. See redforge.judge.oracles.
    INCONCLUSIVE = "Inconclusive"


class RuleDecision(BaseModel):
    detector: str
    outcome: JudgeOutcome
    reason: str
    matched_signals: list[str] = Field(default_factory=list)
    #: False when no oracle this pack relies on was available (see oracles.py).
    conclusive: bool = True
    #: Proof sources that were available for this attempt.
    oracles: list[str] = Field(default_factory=list)


class LLMDecision(BaseModel):
    judge: str = Field(description="demo-heuristic | real-llm")
    outcome: JudgeOutcome
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str


class Verdict(BaseModel):
    id: str
    attempt_id: str
    technique_id: str
    rule: RuleDecision
    llm: LLMDecision
    combined: JudgeOutcome
    confidence: float = Field(ge=0.0, le=1.0)
    escalated_to_human: bool = False   # set when dual modes disagree
    #: False when the attempt could not be observed; such verdicts are
    #: excluded from the scorecard denominator rather than scored as passes.
    conclusive: bool = True
    missing_oracles: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
