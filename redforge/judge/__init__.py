"""Dual-mode judge (M2) — rule detectors FIRST, LLM-as-judge SECOND,
no single-judge verdicts; disagreement escalates to a human (tenet T2)."""
from .combine import combine, make_verdict
from .detectors import DETECTORS, decide
from .llm_judge import DemoLLMJudge, LLMJudge, RealLLMJudge, get_judge

__all__ = ["DETECTORS", "DemoLLMJudge", "LLMJudge", "RealLLMJudge",
           "combine", "decide", "get_judge", "make_verdict"]
