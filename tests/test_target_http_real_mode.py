"""Real-mode target coverage: attack the demo target over a real HTTP socket.

Every other target test reaches the demo app through ``httpx.ASGITransport``,
so until now the ``real`` provider branch of ``get_target_adapter()`` — the only
path to a target RedForge does not host itself — had no automated coverage at
all. These tests exercise it against the one target whose seeded flaws are
already known, which makes the in-process run a correctness oracle for the
socket run: same campaign, same seed, same findings, or the HTTP client is
wrong.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, demo_target_server, uvicorn_server  # noqa: E402

from redforge.catalog.targets import demo_target
from redforge.judge.llm_judge import get_judge
from redforge.schemas import BudgetCaps, Campaign
from redforge.swarm import CampaignEngine
from redforge.targets.adapter import OpenAICompatibleTarget, demo_adapter

PACKS = ["PIN", "EXF", "AGE"]  # fast subset; the full 8-pack run is the E2E script


@pytest.fixture(scope="module")
def http_target():
    """The vulnerable demo target, served over a real socket."""
    with demo_target_server() as base:
        yield base


async def _reset_http(base: str) -> None:
    root = base.rsplit("/v1", 1)[0]
    async with httpx.AsyncClient(timeout=10.0) as c:
        await c.get(f"{root}/__test/reset")


async def _reset_in_process() -> None:
    from redforge.targets.app import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 timeout=10.0) as c:
        await c.get("http://demo.local/__test/reset")


async def _run_campaign(adapter, label: str) -> list[str]:
    campaign = Campaign(
        id=f"C-HTTP-{label}", name=f"transport parity ({label})",
        targets=[demo_target()], packs=PACKS, rounds_max=1,
        caps=BudgetCaps(max_attempts=400, max_tokens=5_000_000, max_cost_usd=50.0),
    )
    engine = CampaignEngine(judge=get_judge())
    result = await engine.run_campaign(campaign, adapter)
    return sorted({f.technique_id for f in result.findings})


# --------------------------------------------------------------- transport


async def test_http_adapter_speaks_to_a_socket_target(http_target):
    """The three methods the swarm relies on must work over the wire."""
    adapter = OpenAICompatibleTarget(http_target, api_key="placeholder-demo-ignores-it")

    chat = await adapter.call_chat([{"role": "user", "content": "hello"}],
                                   session_id="parity")
    assert chat.content, "empty completion over HTTP"
    assert chat.tokens_used > 0, "usage not parsed from the HTTP response"

    tools = await adapter.list_tools()
    # The shadow registry is the SUP/AGE signal: more live tools than documented.
    assert len(tools["all"]) > len(tools["documented"]) > 0

    called = await adapter.call_tool("search_kb", {"query": "policy"}, confirmed=False)
    assert isinstance(called, dict) and called


async def test_http_transport_matches_in_process(http_target):
    """The oracle: identical campaigns must produce identical findings.

    The demo target seeds one flaw per technique, so a divergence here is a
    defect in the HTTP client (headers, status handling, usage parsing), not a
    difference in the target.
    """
    await _reset_in_process()
    in_process = await _run_campaign(demo_adapter(), "asgi")

    await _reset_http(http_target)
    over_http = await _run_campaign(
        OpenAICompatibleTarget(http_target, api_key="placeholder"), "http")

    assert in_process == over_http, (
        "transports disagree — "
        f"in-process only: {[t for t in in_process if t not in over_http]}, "
        f"http only: {[t for t in over_http if t not in in_process]}"
    )
    assert len(over_http) >= 10, f"oracle too weak to be meaningful: {over_http}"


# -------------------------------------------------------------- API surface


@pytest.fixture(scope="module")
def real_mode_api(http_target):
    """The live API in real mode, pointed at the socket-served demo target."""
    port = allocate_port()
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_JUDGE_PROVIDER": "demo",
        "RF_TARGET_PROVIDER": "real",
        "RF_TARGET_BASE_URL": http_target,
        "RF_TARGET_API_KEY": "placeholder-unlocks-the-real-branch",
    }
    with uvicorn_server(port=port, env=env) as base:
        yield base


def test_api_health_reports_openai_compatible_target(real_mode_api):
    body = httpx.get(f"{real_mode_api}/api/health", timeout=10).json()
    assert body["ok"] is True
    assert body["target_provider"] == "openai-compatible"
    assert body["target_adapter"] == "openai-compatible"
    # Astra stays judge-side no matter what the target is doing.
    assert body["judge_provider"] == "demo"


def test_real_mode_campaign_finds_seeded_flaws(real_mode_api):
    r = httpx.post(f"{real_mode_api}/api/campaign/start",
                   json={"packs": PACKS, "rounds": 1}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["target_provider"] == "openai-compatible"

    deadline = time.time() + 180
    while time.time() < deadline:
        status = httpx.get(f"{real_mode_api}/api/campaign/status", timeout=10).json()
        if not status["running"]:
            break
        time.sleep(1)
    status = httpx.get(f"{real_mode_api}/api/campaign/status", timeout=10).json()
    assert status["running"] is False
    assert status["stopped_reason"] == "completed", status
    assert status["attempts"] > 0, "no attempts reached the HTTP target"
    assert status["findings_total"] > 0, "real-mode campaign over HTTP found nothing"
    assert status["findings_confirmed"] > 0, status["confirmed_packs"]


def test_real_target_mode_never_yields_an_astra_target(http_target):
    """RF_TARGET_PROVIDER=astra must not become a target even with a key present."""
    port = allocate_port()
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "astra",
        "RF_JUDGE_PROVIDER": "astra",
        "RF_TARGET_PROVIDER": "astra",
        "RF_ASTRA_API_KEY": "mock-key-for-health-only",
        "RF_TARGET_BASE_URL": http_target,
        "RF_TARGET_API_KEY": "placeholder",
    }
    with uvicorn_server(port=port, env=env) as base:
        body = httpx.get(f"{base}/api/health", timeout=10).json()
        assert body["target_provider"] == "demo", "astra leaked onto the target path"
        assert body["target_adapter"] == "demo"
        assert body["judge_provider"] == "astra"
