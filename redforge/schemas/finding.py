"""Core evidence-bearing schemas. Tenet: every finding ships with transcript
evidence + judge confidence + human-confirmed flag — audit-grade by construction."""
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Severity(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"
    INFO = "Info"


class FindingStatus(str, Enum):
    CANDIDATE = "Candidate"      # judged success-candidate, not yet verified
    CONFIRMED = "Confirmed"      # reproduced by Verifier (single-writer rule)
    VOIDED = "Voided"            # false positive, killed by Verifier


class EvidenceRef(BaseModel):
    kind: str = Field(description="transcript | verdict | canary_hit | report | tool_log")
    uri: str = Field(description="resolvable pointer, e.g. sqlite://finding/RF-F-0001")
    sha256: str | None = None


class Finding(BaseModel):
    id: str = Field(pattern=r"^RF-F-\d{4}$")
    campaign_id: str
    technique_id: str
    target_id: str
    title: str
    narrative: str = ""
    severity: Severity = Severity.MEDIUM
    status: FindingStatus = FindingStatus.CANDIDATE
    confidence: float = Field(ge=0.0, le=1.0)
    human_confirmed: bool = False   # required True for Critical findings (dual-mode tenet)
    evidence: list[EvidenceRef] = Field(default_factory=list)
    verdict_id: str | None = None
    reproduced: bool | None = None
    created_at: datetime = Field(default_factory=utcnow)
