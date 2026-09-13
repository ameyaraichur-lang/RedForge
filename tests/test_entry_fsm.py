"""Entry FSM contract — validate manifest parity helpers used at boot."""
from __future__ import annotations

from redforge.catalog.world_manifest import world_manifest


def test_manifest_agent_count_matches_live_node_order():
    """Console LIVE_NODE_ORDER must match backend pipeline_order."""
    m = world_manifest()
    # Mirror of console/lib/live.tsx LIVE_NODE_ORDER
    live_order = [
        "N0_mission_control", "N1_recon", "N2_attack_strategist", "N3_red_operators",
        "N4_judge", "N5_mutator", "G1_gatekeeper", "N6_chain_builder",
        "N7_verifier", "N8_scorer", "G2_release",
    ]
    assert m.pipeline_order == live_order


def test_every_swarm_runner_node_in_manifest():
    """Nodes emitted by CampaignEngine must appear in manifest."""
    runner_nodes = {
        "N0_mission_control", "N1_recon", "N2_attack_strategist",
        "N3_red_operators", "N4_judge", "N5_mutator",
        "N6_chain_builder", "N7_verifier", "N8_scorer",
    }
    manifest_ids = {n.id for n in world_manifest().nodes}
    assert runner_nodes <= manifest_ids
