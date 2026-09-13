"""G2 release gate semantics — release-ready vs countersigned complete."""


def test_g2_campaign_end_is_release_ready_not_complete():
    """Mirror of console/lib/live.tsx nodeStatesFromEvents G2 contract."""
    states = {n: "pending" for n in [
        "N0_mission_control", "N1_recon", "N2_attack_strategist", "N3_red_operators",
        "N4_judge", "N5_mutator", "G1_gatekeeper", "N6_chain_builder",
        "N7_verifier", "N8_scorer", "G2_release",
    ]}
    events = [{"type": "campaign_end", "stopped_reason": "completed"}]
    for e in events:
        if e["type"] == "campaign_end":
            if states["G2_release"] != "complete":
                states["G2_release"] = "active"
    assert states["G2_release"] == "active"


def test_g2_countersign_marks_complete():
    states = {n: "pending" for n in ["G2_release"]}
    states["G2_release"] = "active"
    e = {"type": "gate_approved", "gate_level": "G2"}
    if e["type"] == "gate_approved" and e.get("gate_level") == "G2":
        states["G2_release"] = "complete"
    assert states["G2_release"] == "complete"


def test_g1_gate_approved_does_not_complete_g2():
    """G1 technique approvals must not mark G2 release complete."""
    states = {n: "pending" for n in ["G1_gatekeeper", "G2_release"]}
    for e in [{"type": "gate_approved", "gate_level": "G1"}, {"type": "campaign_end"}]:
        if e["type"] == "gate_approved" and e.get("gate_level") == "G2":
            states["G2_release"] = "complete"
        elif e["type"] == "gate_approved":
            states["G1_gatekeeper"] = "complete"
        elif e["type"] == "campaign_end" and states["G2_release"] != "complete":
            states["G2_release"] = "active"
    assert states["G1_gatekeeper"] == "complete"
    assert states["G2_release"] == "active"
