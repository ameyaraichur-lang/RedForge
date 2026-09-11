"""Campaign, budget and target specs (A1/A2 artifact contracts)."""
from enum import Enum

from pydantic import BaseModel, Field

from .finding import utcnow
from datetime import datetime


class TargetClass(str, Enum):
    CHATBOT = "chatbot"
    EMPLOYEE_COPILOT = "employee_copilot"
    RAG_APP = "rag_app"
    TOOL_AGENT = "tool_agent"
    MULTI_AGENT = "multi_agent"
    CODING_ASSISTANT = "coding_assistant"
    VOICE_AGENT = "voice_agent"
    AI_GATEWAY = "ai_gateway"
    FINETUNED_MODEL = "finetuned_model"
    AGENTIC_RPA = "agentic_rpa"


class Interface(str, Enum):
    MODEL_API = "model_api"          # OpenAI-compatible chat API
    AGENT_ENDPOINT = "agent_endpoint"
    RAG_API = "rag_api"
    BROWSER = "browser"              # chat UI (Playwright)
    TOOL_SCHEMA = "tool_schema"      # agent tool registry dump


class TargetSpec(BaseModel):
    id: str
    name: str
    target_class: TargetClass
    interface: Interface = Interface.MODEL_API
    base_url: str = ""
    packs: list[str] = Field(default_factory=list)   # technique pack ids to run
    prod_safety_notes: str = ""
    asset_criticality: int = Field(default=1, ge=1, le=5)


class BudgetCaps(BaseModel):
    max_attempts: int = 500
    max_tokens: int = 2_000_000
    max_cost_usd: float = 25.0
    deadline_minutes: int = 60


class BudgetUsage(BaseModel):
    attempts: int = 0
    tokens: int = 0
    cost_usd: float = 0.0

    def over_cap(self, caps: BudgetCaps) -> bool:
        return (self.attempts >= caps.max_attempts
                or self.tokens >= caps.max_tokens
                or self.cost_usd >= caps.max_cost_usd)


class Campaign(BaseModel):
    id: str
    name: str
    targets: list[TargetSpec] = Field(default_factory=list)
    packs: list[str] = Field(default_factory=list)
    rounds_max: int = 3              # bounded mutation (tenet T3)
    caps: BudgetCaps = Field(default_factory=BudgetCaps)
    created_at: datetime = Field(default_factory=utcnow)


class GateRequest(BaseModel):
    """G1 Gatekeeper — sensitive actions need two-person approval (tenet T5)."""
    id: str
    kind: str = Field(description="prod_attack | tool_action | budget_raise")
    technique_ids: list[str] = Field(default_factory=list)
    justification: str = ""
    approvals: list[str] = Field(default_factory=list)  # signer ids; need >=2
    decided: bool = False
