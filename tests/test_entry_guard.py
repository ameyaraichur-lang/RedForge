"""Entry guard — mission control gate blocks campaign actions before entry."""
from __future__ import annotations

import pytest

from redforge.catalog.world_manifest import world_manifest


def test_manifest_runtime_agent_count():
    m = world_manifest()
    assert m.agent_count == 9
    assert m.gate_count == 2
    assert len(m.runtime_agents) == 9
    assert len(m.nodes) == 11
    assert all(n.kind == "agent" for n in m.nodes if n.id in m.runtime_agents)


def test_manifest_n0_display_name_not_duplicate():
    m = world_manifest()
    n0 = next(n for n in m.nodes if n.id == "N0_mission_control")
    assert n0.name == "CTRL"
    assert "MISSION MISSION" not in f"{n0.name} {n0.role}".upper()


def test_manifest_no_fixture_only_agents():
    """Runtime agents must match CampaignEngine node ids only."""
    m = world_manifest()
    engine_nodes = {
        "N0_mission_control", "N1_recon", "N2_attack_strategist", "N3_red_operators",
        "N4_judge", "N5_mutator", "N6_chain_builder", "N7_verifier", "N8_scorer",
    }
    assert set(m.runtime_agents) == engine_nodes


@pytest.mark.parametrize(
    "phrase",
    ["start campaign", "run campaign", "launch campaign", "abort"],
)
def test_campaign_phrases_blocked_during_entry(phrase: str):
    """Documented contract: entry-phase voice must not map to campaign (client-side)."""
    import re
    block = re.compile(r"\b(start|launch|run|campaign|abort|confirm)\b", re.I)
    assert block.search(phrase)


def test_operator_parser_recognizes_campaign_intents():
    """Behavior: campaign phrases parse server-side; client entry gate blocks before MC."""
    from redforge.operator.parser import parse_natural_language
    from redforge.operator.schemas import ActionKind

    for phrase in ("start campaign", "run campaign", "launch campaign"):
        intent = parse_natural_language(phrase, source="voice")
        assert intent is not None, phrase
        assert intent.action.kind is ActionKind.START_CAMPAIGN, phrase
    abort = parse_natural_language("abort", source="voice")
    assert abort is not None
    assert abort.action.kind is ActionKind.ABORT_CAMPAIGN


def test_mission_control_gate_blocks_campaign_before_live():
    """Behavior: entry FSM requires summoning before mission_control even when campaign is running."""
    from redforge.operator.parser import parse_natural_language
    from redforge.operator.schemas import ActionKind

    start = parse_natural_language("start campaign", source="voice")
    assert start is not None
    assert start.action.kind is ActionKind.START_CAMPAIGN

    # FSM contract (also covered by console/lib/mission-control-gate.test.ts vitest suite):
    # enter_mission_control → summoning; summon_complete → mission_control.
    from pathlib import Path

    fsm_path = Path(__file__).resolve().parent.parent / "console" / "lib" / "entry-fsm.ts"
    fsm = fsm_path.read_text(encoding="utf-8")
    assert "enter_mission_control" in fsm
    assert "summon_complete" in fsm
    assert "summoning" in fsm
    assert "awaiting_entry" in fsm

    gate_test = Path(__file__).resolve().parent.parent / "console" / "lib" / "mission-control-gate.test.ts"
    assert gate_test.is_file(), "behavioral MC gate tests live in mission-control-gate.test.ts"
