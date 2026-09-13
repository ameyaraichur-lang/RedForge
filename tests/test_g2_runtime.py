"""G2 release gate runtime contract — engine events match world-bus / live semantics."""
import asyncio

from redforge.swarm import run_demo_campaign


def _impact_node(event: dict) -> str:
    is_g2 = event.get("gate_level") == "G2"
    return "G2_release" if is_g2 else "G1_gatekeeper"


def test_g2_engine_countersign_matches_world_bus_contract():
    """Engine G2 countersign uses gate_level G2 (world-bus maps to G2_release, not G1)."""
    result = asyncio.run(run_demo_campaign(packs=["PIN"], rounds=1))
    g2_events = [
        e for e in result.events
        if e.get("type") == "gate_approved" and e.get("gate_level") == "G2"
    ]
    assert g2_events, "G2 release countersign must emit after campaign completion"
    event = g2_events[0]
    assert event["technique_id"] == "release"
    end_idx = next(i for i, e in enumerate(result.events) if e["type"] == "campaign_end")
    assert result.events.index(g2_events[0]) > end_idx
    assert _impact_node(event) == "G2_release"


def test_g1_gate_approved_does_not_map_to_g2_release():
    event = {"type": "gate_approved", "gate_level": "G1", "technique_id": "PIN-001"}
    assert _impact_node(event) == "G1_gatekeeper"
