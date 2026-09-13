"""World manifest API — authoritative agent topology parity."""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

from redforge.catalog.world_manifest import world_manifest


def test_manifest_has_all_campaign_agents():
    m = world_manifest()
    ids = {n.id for n in m.nodes}
    expected = {
        "N0_mission_control", "N1_recon", "N2_attack_strategist", "N3_red_operators",
        "N4_judge", "N5_mutator", "G1_gatekeeper", "N6_chain_builder",
        "N7_verifier", "N8_scorer", "G2_release",
    }
    assert ids == expected
    assert m.agent_count == 9
    assert m.gate_count == 2
    assert len(m.nodes) == 11
    assert len(m.runtime_agents) == 9
    gates = [n for n in m.nodes if n.kind == "gate"]
    assert len(gates) == 2
    assert {g.gate for g in gates} == {"G1", "G2"}


def test_manifest_pipeline_order_matches_dag():
    m = world_manifest()
    assert m.pipeline_order[0] == "N0_mission_control"
    assert m.pipeline_order[-1] == "G2_release"
    assert len(m.pipeline_order) == len(m.nodes)


def test_manifest_edges_reference_known_nodes():
    m = world_manifest()
    node_ids = {n.id for n in m.nodes} | {"CORE"}
    for e in m.edges:
        assert e.from_id in node_ids, e.from_id
        assert e.to_id in node_ids, e.to_id


@pytest.fixture(scope="module")
def api_server():
    port = allocate_port()
    with uvicorn_server(port=port) as base:
        yield base


def test_world_manifest_api(api_server):
    r = httpx.get(f"{api_server}/api/world/manifest", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1.0.0"
    assert body["agent_count"] == 9
    assert body["gate_count"] == 2
    assert len(body["nodes"]) == 11
    assert len(body["edges"]) == 15
    assert len(body["pipeline_order"]) == 11
