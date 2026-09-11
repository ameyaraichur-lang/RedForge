"""Attack attempt + transcript schemas (A4 artifact contract)."""
from datetime import datetime

from pydantic import BaseModel, Field

from .finding import utcnow


class Turn(BaseModel):
    role: str = Field(description="attacker | target | system | judge")
    content: str
    tool_calls: list[dict] | None = None
    ts: datetime = Field(default_factory=utcnow)


class Transcript(BaseModel):
    id: str
    attempt_id: str
    technique_id: str
    target_id: str
    turns: list[Turn] = Field(default_factory=list)

    def render(self) -> str:
        return "\n".join(f"[{t.role}] {t.content}" for t in self.turns)


class AttackAttempt(BaseModel):
    id: str
    campaign_id: str
    technique_id: str
    target_id: str
    payload: str
    round_no: int = 1                # bounded 1..3 (mutation tenet)
    transcript_id: str | None = None
    verdict_id: str | None = None
    tokens_used: int = 0
    cost_usd: float = 0.0
