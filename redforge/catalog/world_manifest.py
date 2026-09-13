"""Authoritative campaign agent / DAG manifest for Mission Control topology.

Single source of truth for swarm nodes, gate crystals, pipeline order, and
dependency edges. The console fetches this via /api/world/manifest — never
maintain a drifting UI-only node count.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class WorldAgentNode(BaseModel):
    id: str
    name: str
    role: str
    color: str
    angle: float
    radius: float
    y: float
    pipeline_order: int
    kind: Literal["agent", "gate"] = "agent"
    gate: Literal["G1", "G2"] | None = None


class WorldManifestEdge(BaseModel):
    from_id: str
    to_id: str


class WorldManifest(BaseModel):
    version: str = "1.0.0"
    core_id: str = "CORE"
    agent_count: int = 9
    gate_count: int = 2
    runtime_agents: list[str] = Field(default_factory=list)
    nodes: list[WorldAgentNode]
    edges: list[WorldManifestEdge]
    pipeline_order: list[str] = Field(default_factory=list)


# Layout matches the swarm runner DAG (N0..N8 + G1/G2).
_WORLD_NODES: list[WorldAgentNode] = [
    WorldAgentNode(id="N0_mission_control", name="CTRL", role="mission control",
                   color="#7fe7ff", angle=96, radius=10.4, y=2.3, pipeline_order=0),
    WorldAgentNode(id="N1_recon", name="SCOUT", role="recon",
                   color="#f5b841", angle=137, radius=11.4, y=-0.6, pipeline_order=1),
    WorldAgentNode(id="N2_attack_strategist", name="STRATEGIST", role="attack planner",
                   color="#ff8c4d", angle=176, radius=9.8, y=1.2, pipeline_order=2),
    WorldAgentNode(id="N3_red_operators", name="OPERATORS", role="red execution",
                   color="#ff4d9d", angle=214, radius=12.2, y=-1.4, pipeline_order=3),
    WorldAgentNode(id="N4_judge", name="SENTINEL", role="adjudicator",
                   color="#3bff9e", angle=253, radius=10.6, y=0.8, pipeline_order=4),
    WorldAgentNode(id="N5_mutator", name="MUTATOR", role="evolution",
                   color="#9d5cff", angle=291, radius=11.8, y=-1.8, pipeline_order=5),
    WorldAgentNode(id="G1_gatekeeper", name="G1", role="two-person gate",
                   color="#f5b841", angle=322, radius=12.8, y=0.4, pipeline_order=6,
                   kind="gate", gate="G1"),
    WorldAgentNode(id="N6_chain_builder", name="CHAINER", role="kill chains",
                   color="#5ea0ff", angle=352, radius=13.6, y=2.2, pipeline_order=7),
    WorldAgentNode(id="N7_verifier", name="VERIFIER", role="fp-kill",
                   color="#4fe3c1", angle=17, radius=11.2, y=-2.4, pipeline_order=8),
    WorldAgentNode(id="N8_scorer", name="SCORER", role="opa policy",
                   color="#ffd166", angle=47, radius=13.0, y=0.6, pipeline_order=9),
    WorldAgentNode(id="G2_release", name="G2", role="release gate",
                   color="#7fe7ff", angle=71, radius=14.4, y=-1.2, pipeline_order=10,
                   kind="gate", gate="G2"),
]

_WORLD_EDGES: list[WorldManifestEdge] = [
    WorldManifestEdge(from_id="CORE", to_id="N0_mission_control"),
    WorldManifestEdge(from_id="CORE", to_id="N1_recon"),
    WorldManifestEdge(from_id="N0_mission_control", to_id="N1_recon"),
    WorldManifestEdge(from_id="N1_recon", to_id="N2_attack_strategist"),
    WorldManifestEdge(from_id="N2_attack_strategist", to_id="N3_red_operators"),
    WorldManifestEdge(from_id="N3_red_operators", to_id="N4_judge"),
    WorldManifestEdge(from_id="N4_judge", to_id="N5_mutator"),
    WorldManifestEdge(from_id="N5_mutator", to_id="N3_red_operators"),
    WorldManifestEdge(from_id="N4_judge", to_id="G1_gatekeeper"),
    WorldManifestEdge(from_id="G1_gatekeeper", to_id="N6_chain_builder"),
    WorldManifestEdge(from_id="G1_gatekeeper", to_id="N7_verifier"),
    WorldManifestEdge(from_id="N6_chain_builder", to_id="N8_scorer"),
    WorldManifestEdge(from_id="N7_verifier", to_id="N8_scorer"),
    WorldManifestEdge(from_id="N8_scorer", to_id="G2_release"),
    WorldManifestEdge(from_id="G2_release", to_id="N0_mission_control"),
]


def world_manifest() -> WorldManifest:
    """Return the canonical Mission Control topology."""
    ordered = sorted(_WORLD_NODES, key=lambda n: n.pipeline_order)
    agents = [n.id for n in ordered if n.kind == "agent"]
    return WorldManifest(
        agent_count=len(agents),
        gate_count=sum(1 for n in ordered if n.kind == "gate"),
        runtime_agents=agents,
        nodes=list(_WORLD_NODES),
        edges=list(_WORLD_EDGES),
        pipeline_order=[n.id for n in ordered],
    )
