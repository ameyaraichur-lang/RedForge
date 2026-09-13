"""M4 gate: Swarm Execution DAG / Campaign Engine end-to-end.

Full mini-campaign over the in-process vulnerable demo target: every pack
must land at least one CONFIRMED finding (the M1/M4 integration gate), with
bounded mutation, hard budget caps, G1 gate interrupts and kill-chain
synthesis all observable in the event stream.
"""
import httpx
import pytest

from redforge.catalog import PACKS, demo_target, technique
from redforge.schemas import BudgetCaps, Campaign, FindingStatus
from redforge.swarm import CampaignEngine, mutate, run_demo_campaign
from redforge.targets import app, demo_adapter

ALL_PACKS = list(PACKS)


@pytest.fixture(autouse=True)
async def clean_demo_target():
    """Isolate module-level app state (tool log + simulator memory) per test."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://demo.local") as client:
        await client.get("/__test/reset")
    yield


def _campaign(caps: BudgetCaps | None = None, rounds: int = 2) -> Campaign:
    return Campaign(
        id="C-E2E", name="t", targets=[demo_target()], packs=ALL_PACKS,
        rounds_max=rounds,
        caps=caps or BudgetCaps(max_attempts=500, max_tokens=50_000_000,
                                max_cost_usd=1000))


# ------------------------------------------------------ full mini-campaign

async def test_full_mini_campaign():
    seen: list[dict] = []
    engine = CampaignEngine(on_event=seen.append)
    result = await engine.run_campaign(_campaign(), demo_adapter())

    assert result.campaign_id == "C-E2E"
    assert result.attempts > 0
    assert result.budget_usage.attempts == result.attempts
    assert result.findings
    assert result.verdicts
    assert result.rounds_executed <= 2
    assert result.stopped_reason == "completed"

    types = {e["type"] for e in result.events}
    assert {"node_start", "node_end", "attempt", "verdict", "gate_approved",
            "scorecard", "campaign_end"} <= types
    g2 = [e for e in result.events if e.get("type") == "gate_approved" and e.get("gate_level") == "G2"]
    assert g2, "G2 release countersign must emit after campaign completion"
    assert result.events.index(g2[0]) > next(
        i for i, e in enumerate(result.events) if e["type"] == "campaign_end"
    )
    # round-2 mutations gained nothing against the demo -> bounded early stop
    assert "mutation_stop" in types

    # on_event callback is wired and mirrors the campaign event stream
    assert seen == result.events

    # every pack >= 1 CONFIRMED finding (M1/M4 integration gate)
    confirmed_packs = {technique(f.technique_id).pack for f in result.findings
                       if f.status is FindingStatus.CONFIRMED}
    assert confirmed_packs >= set(ALL_PACKS)

    # audit-grade findings: evidence refs + verdict pointer, always
    for f in result.findings:
        assert f.evidence, f.id
        assert f.verdict_id, f.id
        assert f.confidence > 0

    assert "total" in result.scorecard and "band" in result.scorecard
    assert 0 <= result.scorecard["total"] <= 100
    assert result.scorecard["band"] in ("Good", "Fair", "Poor", "Critical")


# --------------------------------------------------------- recon (N1)

async def test_recon_synthesizes_shadow_tool_findings():
    result = await CampaignEngine().run_campaign(_campaign(), demo_adapter())
    recon = [f for f in result.findings
             if f.title.startswith("Shadow tooling exposed")]
    assert {f.technique_id for f in recon} == {"AGE-005", "SUP-001"}
    assert all(f.status is FindingStatus.CONFIRMED and f.reproduced is True
               for f in recon)
    assert all(r.uri == "tools://diff/TGT-DEMO"
               for f in recon for r in f.evidence)
    events = [e for e in result.events if e["type"] == "recon"]
    assert events and events[0]["shadow_tools"]


# --------------------------------------------------------- strict gates (T5)

async def test_strict_gates_skip_sensitive_techniques():
    loose = await CampaignEngine().run_campaign(_campaign(), demo_adapter())
    strict = await CampaignEngine(strict_gates=True).run_campaign(
        _campaign(), demo_adapter())

    assert strict.attempts < loose.attempts
    types = {e["type"] for e in strict.events}
    assert "gate_denied" in types
    assert "gate_approved" not in types
    assert strict.gate_requests
    assert all(not g.approvals for g in strict.gate_requests)

    # nothing leaks from gated techniques and nothing half-voided: every
    # finding cites a Safe technique with a verdict and evidence intact
    for f in strict.findings:
        assert technique(f.technique_id).gate_level == "Safe", f.id
        assert f.verdict_id, f.id
        assert f.evidence, f.id
        assert f.status in (FindingStatus.CONFIRMED, FindingStatus.CANDIDATE)


# --------------------------------------------------------- budget exhaustion

async def test_budget_exhaustion_stops_campaign():
    caps = BudgetCaps(max_attempts=3, max_tokens=50_000_000, max_cost_usd=1000)
    result = await CampaignEngine().run_campaign(_campaign(caps=caps),
                                                 demo_adapter())
    assert result.stopped_reason == "budget_exhausted"
    assert result.attempts <= 3
    assert result.budget_usage.attempts <= caps.max_attempts
    assert any(e["type"] == "budget_exhausted" for e in result.events)


# --------------------------------------------------------- mutator (N5)

def test_mutator_five_distinct_variants():
    variants = mutate("hello world", 2)
    assert len(variants) == 5
    assert all(v.strip() for v in variants)
    assert all(v != "hello world" for v in variants)
    assert len(set(variants)) == 5


def test_mutator_round1_never_mutates():
    assert mutate("ignore previous instructions", 1) == []


def test_mutator_round3_upper_deduped():
    variants = mutate("hello world", 3)
    assert variants  # bounded: same corpus, deduped
    assert len({v.upper() for v in variants}) == len(variants)


# --------------------------------------------------------- kill chain (N6)

async def test_kill_chain_event_and_finding():
    result = await CampaignEngine().run_campaign(_campaign(), demo_adapter())
    chains = [e for e in result.events if e["type"] == "chain"]
    assert chains, "demo target is vulnerable across PIN+AGE+EXF: chain expected"
    assert {technique(t).pack for t in chains[0]["techniques"]} == \
        {"PIN", "AGE", "EXF"}

    chain_ids = {e["chain_finding_id"] for e in chains}
    chain_findings = [f for f in result.findings if f.id in chain_ids]
    assert chain_findings
    other_ids = [f.id for f in result.findings if f.id not in chain_ids]
    for f in chain_findings:
        assert f.title == "Kill chain: injection>agency>exfil"
        assert technique(f.technique_id).pack == "PIN"
        # narrative names all three component finding ids
        assert sum(1 for oid in other_ids if oid in f.narrative) >= 3
        assert f.status is FindingStatus.CONFIRMED


# --------------------------------------------------------- verifier (N7)

async def test_verifier_replays_and_confirms():
    result = await CampaignEngine().run_campaign(_campaign(), demo_adapter())
    verify_events = [e for e in result.events if e["type"] == "verify"]
    assert verify_events
    # the vulnerable demo is deterministic: every replayed candidate confirms
    assert all(e["reproduced"] for e in verify_events)
    payload_findings = [f for f in result.findings if f.status is not None]
    assert all(f.status is not FindingStatus.VOIDED for f in payload_findings)


# --------------------------------------------------------- demo convenience

async def test_run_demo_campaign_convenience():
    result = await run_demo_campaign(packs=["PIN", "SUP"], rounds=1)
    assert result.campaign_id == "C-DEMO"
    assert result.attempts > 0
    assert result.stopped_reason == "completed"
    packs_found = {technique(f.technique_id).pack for f in result.findings}
    assert {"PIN", "SUP"} <= packs_found
    assert result.rounds_executed == 1
