"""Schema contracts: round-trips and invariants the swarm relies on."""
import pytest
from pydantic import ValidationError

from redforge.schemas import (AttackAttempt, Finding, FindingStatus, JudgeOutcome,
                              Severity, TargetSpec, Transcript, Turn, Verdict)


def test_finding_requires_evidence_shape():
    f = Finding(id="RF-F-0001", campaign_id="C-1", technique_id="PIN-001", target_id="TGT-DEMO",
                title="System prompt override", confidence=0.9)
    assert f.status is FindingStatus.CANDIDATE
    assert f.human_confirmed is False
    assert f.severity is Severity.MEDIUM


def test_finding_id_pattern_enforced():
    with pytest.raises(ValidationError):
        Finding(id="bad-id", campaign_id="C-1", technique_id="PIN-001", target_id="T",
                title="x", confidence=0.5)


def test_confidence_bounds():
    with pytest.raises(ValidationError):
        Finding(id="RF-F-0002", campaign_id="C-1", technique_id="PIN-001", target_id="T",
                title="x", confidence=1.5)


def test_transcript_render():
    t = Transcript(id="TR-1", attempt_id="A-1", technique_id="PIN-001", target_id="T",
                   turns=[Turn(role="attacker", content="hello"),
                          Turn(role="target", content="hi")])
    assert "[attacker] hello" in t.render()


def test_verdict_dual_mode_defaults():
    from redforge.schemas import LLMDecision, RuleDecision
    v = Verdict(id="V-1", attempt_id="A-1", technique_id="PIN-001",
                rule=RuleDecision(detector="injection_compliance", outcome=JudgeOutcome.SUCCESS, reason="r"),
                llm=LLMDecision(judge="demo-heuristic", outcome=JudgeOutcome.SUCCESS,
                                confidence=0.8, reason="r"),
                combined=JudgeOutcome.SUCCESS, confidence=0.8)
    assert v.escalated_to_human is False


def test_budget_over_cap():
    from redforge.schemas import BudgetCaps, BudgetUsage
    caps = BudgetCaps(max_attempts=10, max_tokens=100, max_cost_usd=1.0)
    assert not BudgetUsage(attempts=9).over_cap(caps)
    assert BudgetUsage(attempts=10).over_cap(caps)
    assert BudgetUsage(tokens=100).over_cap(caps)
    assert BudgetUsage(cost_usd=1.0).over_cap(caps)
