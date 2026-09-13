"""Astra LLM judge — provider selection, parsing, API wiring (judge-only, never target)."""
from __future__ import annotations

import os
from unittest.mock import MagicMock

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

from redforge.config import effective_judge_provider, effective_target_provider, settings
from redforge.judge import get_judge
from redforge.judge.llm_judge import AstraLLMJudge
from redforge.schemas import JudgeOutcome
from redforge.swarm import CampaignEngine
from redforge.targets import get_target_adapter, target_adapter_kind
from redforge.targets.adapter import demo_adapter

_ASTRA_JUDGE_RESPONSE = {
    "output": [{
        "type": "message",
        "content": [{"type": "output_text",
                     "text": '{"outcome": "Fail", "confidence": 0.82, "reason": "refused"}'}],
    }],
}


def test_effective_target_never_astra_from_llm_provider(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "astra")
    monkeypatch.setattr(settings, "target_provider", "")
    assert effective_target_provider() == "demo"
    assert effective_judge_provider() == "astra"


def test_effective_target_rejects_explicit_astra(monkeypatch):
    monkeypatch.setattr(settings, "target_provider", "astra")
    monkeypatch.setattr(settings, "llm_provider", "demo")
    assert effective_target_provider() == "demo"


def test_get_target_adapter_never_astra(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "astra")
    monkeypatch.setattr(settings, "judge_provider", "astra")
    monkeypatch.setattr(settings, "astra_api_key", "test-key")
    adapter = get_target_adapter()
    assert target_adapter_kind(adapter) == "demo"
    assert adapter.base_url == demo_adapter().base_url


def test_campaign_engine_default_uses_get_judge(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "astra")
    monkeypatch.setattr(settings, "judge_provider", "astra")
    monkeypatch.setattr(settings, "astra_api_key", "test-key")
    engine = CampaignEngine()
    assert isinstance(engine.judge, AstraLLMJudge)


def test_astra_judge_parses_responses_api(monkeypatch):
    client = MagicMock()
    client.configured = True
    client.complete.return_value = _ASTRA_JUDGE_RESPONSE
    judge = AstraLLMJudge(client=client)

    decision = judge.judge("attack", "I can't help with that.", "PIN-001")

    assert decision.judge == "astra"
    assert decision.outcome is JudgeOutcome.FAIL
    assert decision.confidence == 0.82
    client.complete.assert_called_once()


def test_astra_judge_error_returns_close(monkeypatch):
    client = MagicMock()
    client.configured = True
    client.complete.side_effect = RuntimeError("network down")
    judge = AstraLLMJudge(client=client)

    decision = judge.judge("attack", "response", "PIN-001")

    assert decision.judge == "astra"
    assert decision.outcome is JudgeOutcome.CLOSE
    assert "unavailable" in decision.reason


@pytest.fixture(scope="module")
def server_astra_judge():
    port = allocate_port()
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "astra",
        "RF_JUDGE_PROVIDER": "astra",
        "RF_TARGET_PROVIDER": "demo",
        "RF_ASTRA_API_KEY": "mock-key-for-health-only",
    }
    with uvicorn_server(port=port, env=env) as base:
        yield base


def test_api_health_astra_judge_demo_target(server_astra_judge):
    r = httpx.get(f"{server_astra_judge}/api/health", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["target_provider"] == "demo"
    assert body["judge_provider"] == "astra"
    assert body["target_adapter"] == "demo"
    assert body["judge_mode"] == "astra"


def test_api_campaign_start_demo_target_astra_judge(server_astra_judge):
    r = httpx.post(f"{server_astra_judge}/api/campaign/start",
                   json={"packs": ["PIN"], "rounds": 1}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["target_id"] == "TGT-DEMO"
    assert body["target_provider"] == "demo"
    assert body["judge_provider"] == "astra"
