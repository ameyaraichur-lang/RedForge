"""Technique packs: the unit of campaign planning and scorecard dimensions."""
from .techniques import TECHNIQUES, Technique

PACKS: dict[str, dict] = {
    "PIN": {"name": "Prompt Injection", "owasp": "LLM01:2025", "scorecard_dim": "Injection Resistance"},
    "EXF": {"name": "Sensitive Disclosure", "owasp": "LLM02/07:2025", "scorecard_dim": "Data Protection"},
    "OUT": {"name": "Improper Output Handling", "owasp": "LLM05:2025", "scorecard_dim": "Output Safety"},
    "AGE": {"name": "Excessive Agency", "owasp": "LLM06 + Agentic Top10", "scorecard_dim": "Agency & Tool Control"},
    "MEM": {"name": "Memory Poisoning", "owasp": "Agentic Top10", "scorecard_dim": "Agency & Tool Control"},
    "CON": {"name": "Unbounded Consumption", "owasp": "LLM10:2025", "scorecard_dim": "Availability & Cost Resilience"},
    "HAL": {"name": "Misinformation", "owasp": "LLM09:2025", "scorecard_dim": "Output Safety"},
    "SUP": {"name": "Supply Chain", "owasp": "LLM03:2025", "scorecard_dim": "Agency & Tool Control"},
}

# Gate levels: packs with Sensitive techniques require G1 approval before execution.
SENSITIVE_PACK_TECHNIQUES = {t.id for t in TECHNIQUES if t.gate_level == "Sensitive"}
BUDGET_GATED_TECHNIQUES = {t.id for t in TECHNIQUES if t.gate_level.startswith("G1")}


def pack_techniques(pack: str) -> list[Technique]:
    if pack not in PACKS:
        raise KeyError(f"unknown pack {pack}")
    return [t for t in TECHNIQUES if t.pack == pack]
