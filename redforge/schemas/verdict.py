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


class RuleDecision(BaseModel):
    detector: str
    outcome: JudgeOutcome
    reason: str
    matched_signals: list[str] = Field(default_factory=list)


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
    created_at: datetime = Field(default_factory=utcnow)
