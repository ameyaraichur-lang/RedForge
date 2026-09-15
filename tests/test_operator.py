"""Operator auth, actions, confirmation boundaries, and API contracts."""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

import httpx
import pytest

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

from redforge.operator.audit import AuditStore
from redforge.operator.auth import OperatorPrincipal, bootstrap_demo_session, role_at_least, session_secret
from redforge.operator.confirm_store import ConfirmationStore
from redforge.operator.parser import parse_natural_language
from redforge.operator.schemas import ActionKind, AuditDecision, OperatorAction, OperatorRole
from redforge.operator.service import OperatorService
from redforge.operator.sessions import issue_session_token, sign_payload, verify_token


@pytest.fixture
def audit_tmp():
    with tempfile.TemporaryDirectory() as d:
        db = Path(d) / "operator.db"
        yield AuditStore(db), ConfirmationStore(db)


async def _mock_start(packs, rounds, target=None):
    return ({"campaign_id": "C-TEST", "target_id": (target.target_id if target
                                                    else "TGT-DEMO")}, 200)


def _svc(audit: AuditStore, confirm: ConfirmationStore) -> OperatorService:
    return OperatorService(
        audit,
        confirm,
        live_status=lambda: {"running": False, "attempts": 0, "findings_total": 0},
        live_start=_mock_start,
        live_abort=lambda: {"aborting": False, "reason": "no campaign running"},
        live_gates=lambda: [{"id": "G-001", "decided": False, "technique_ids": ["PIN-01"]}],
        live_findings=lambda: [{"id": "RF-F-001", "title": "Test finding"}],
        live_sign_gate=lambda gid, signer: {"id": gid, "approvals": [signer], "decided": False},
        live_report=lambda: {"ready": False},
        live_events=lambda: [],
    )


DEMO_ENV = {
    "RF_LLM_PROVIDER": "demo",
    "RF_ASTRA_API_KEY": "",
    "RF_OPERATOR_AUTH_MODE": "demo",
    "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
    "RF_OPERATOR_SESSION_SECRET": "test-demo-secret",
}

SECURE_ENV = {
    **DEMO_ENV,
    "RF_OPERATOR_AUTH_MODE": "secure",
    "RF_OPERATOR_DEMO_BOOTSTRAP": "0",
    "RF_OPERATOR_SESSION_SECRET": "test-secure-secret-min-16-chars",
    "RF_OPERATOR_AUDIT_SIGNING_KEY": "test-secure-audit-signing-key-32b",
    "RF_OPERATOR_ALLOW_PLAIN_PASSWORDS": "1",
    "RF_OPERATOR_SECURE_USERS": json.dumps([
        {"username": "operator", "password": "op-pass", "role": "operator"},
        {"username": "lead", "password": "lead-pass", "role": "lead"},
    ]),
}


@pytest.fixture(scope="module")
def demo_server():
    port = allocate_port()
    with tempfile.TemporaryDirectory() as d:
        env = {**os.environ, **DEMO_ENV, "RF_OPERATOR_DB": str(Path(d) / "operator.db")}
        with uvicorn_server(port=port, env=env) as base:
            yield base


@pytest.fixture(scope="module")
def secure_server():
    port = allocate_port()
    with tempfile.TemporaryDirectory() as d:
        env = {**os.environ, **SECURE_ENV, "RF_OPERATOR_DB": str(Path(d) / "operator.db")}
        with uvicorn_server(port=port, env=env) as base:
            yield base


def _client_with_demo_bootstrap(server: str) -> httpx.Client:
    c = httpx.Client(base_url=server)
    r = c.post("/api/operator/bootstrap")
    assert r.status_code == 200, r.text
    assert r.json()["auth_mode"] == "demo-labeled"
    assert "session_token" not in r.json()
    return c


def _client_with_secure_login(server: str, user: str, pw: str) -> httpx.Client:
    c = httpx.Client(base_url=server)
    r = c.post("/api/operator/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    assert r.json()["auth_mode"] == "secure"
    return c


def test_parser_voice_text_parity():
    text = parse_natural_language("report status", source="text")
    voice = parse_natural_language("brief me on the situation", source="voice")
    assert text is not None and text.action.kind == ActionKind.REPORT_STATUS
    assert voice is not None and voice.action.kind == ActionKind.REPORT_STATUS


def test_parser_navigate_and_campaign():
    nav = parse_natural_language("open findings")
    assert nav is not None
    assert nav.action.kind == ActionKind.NAVIGATE
    assert nav.action.params["route"] == "/findings"


def test_signed_session_expiry():
    secret = "unit-test-secret-key"
    token, _ = issue_session_token(
        secret=secret, actor="u", role="operator", auth_mode="secure", ttl_seconds=1,
    )
    assert verify_token(token, secret) is not None
    time.sleep(1.1)
    assert verify_token(token, secret) is None


def test_anonymous_access_denied(demo_server):
    r = httpx.post(f"{demo_server}/api/operator/intent", json={"text": "status"})
    assert r.status_code == 401


def test_session_probe_unauthenticated_returns_200(demo_server, secure_server):
    """Session probe must not 401 — console uses it before bootstrap completes."""
    for server in (demo_server, secure_server):
        r = httpx.get(f"{server}/api/operator/session")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["authenticated"] is False
        assert "error" in body


def test_protected_plan_without_auth_returns_401(demo_server):
    r = httpx.get(f"{demo_server}/api/operator/plan")
    assert r.status_code == 401
    r = httpx.get(f"{demo_server}/api/operator/audit")
    assert r.status_code == 401


def test_demo_bootstrap_before_protected_polls(demo_server):
    """Console contract: session probe is public; plan/audit only after bootstrap."""
    c = httpx.Client(base_url=demo_server)
    probe = c.get("/api/operator/session")
    assert probe.status_code == 200
    assert probe.json()["authenticated"] is False
    assert c.get("/api/operator/plan").status_code == 401
    assert c.get("/api/operator/audit").status_code == 401
    boot = c.post("/api/operator/bootstrap")
    assert boot.status_code == 200
    assert c.get("/api/operator/session").json()["authenticated"] is True
    assert c.get("/api/operator/plan").status_code == 200
    assert c.get("/api/operator/audit").status_code == 200


def test_secure_mode_no_bootstrap_protected_stays_401(secure_server):
    """Secure mode: no demo bootstrap; protected endpoints stay 401 until login."""
    c = httpx.Client(base_url=secure_server)
    assert c.get("/api/operator/session").json()["authenticated"] is False
    assert c.post("/api/operator/bootstrap").status_code == 403
    assert c.get("/api/operator/plan").status_code == 401
    c = _client_with_secure_login(secure_server, "operator", "op-pass")
    assert c.get("/api/operator/plan").status_code == 200


def test_invalid_token_denied(demo_server):
    headers = {"authorization": "Bearer not-a-valid-token"}
    r = httpx.post(f"{demo_server}/api/operator/intent", headers=headers, json={"text": "status"})
    assert r.status_code == 403


def test_demo_bootstrap_disabled_without_flag(secure_server):
    r = httpx.post(f"{secure_server}/api/operator/bootstrap")
    assert r.status_code == 403


def test_secure_login_and_session(secure_server):
    c = _client_with_secure_login(secure_server, "operator", "op-pass")
    r = c.get("/api/operator/session")
    assert r.json()["authenticated"] is True
    assert r.json()["role"] == "operator"


def test_operator_cannot_become_lead_via_demo_bootstrap(demo_server):
    c = _client_with_demo_bootstrap(demo_server)
    sess = c.get("/api/operator/session").json()
    assert sess["role"] == "operator"
    body = {"action": {"kind": "sign_gate", "params": {"gate_id": "G-001"}}}
    r = c.post("/api/operator/action", json=body)
    assert r.status_code == 400
    assert "lead" in r.json()["message"].lower()


def test_lead_can_sign_gate_in_secure_mode(secure_server):
    c = _client_with_secure_login(secure_server, "lead", "lead-pass")
    body = {"action": {"kind": "sign_gate", "params": {"gate_id": "G-001"}}}
    pending = c.post("/api/operator/action", json=body).json()
    assert pending["requires_confirmation"] is True
    conf = pending["confirmation"]["token"]
    r = c.post("/api/operator/action", json={**body, "confirmation_token": conf})
    assert r.status_code == 400  # gate may not exist in live — role check passed confirm path


@pytest.mark.asyncio
async def test_confirmation_actor_and_fingerprint_bound(audit_tmp):
    audit, confirm = audit_tmp
    svc = _svc(audit, confirm)
    op = OperatorPrincipal("alice", OperatorRole.OPERATOR, "secure")
    action = OperatorAction(kind=ActionKind.START_CAMPAIGN, params={"rounds": 1})
    pending = await svc.execute(action, op)
    assert pending.confirmation is not None
    token = pending.confirmation.token

    bob = OperatorPrincipal("bob", OperatorRole.OPERATOR, "secure")
    replay = await svc.execute(action, bob, confirmation_token=token)
    assert "actor mismatch" in replay.message.lower()

    tampered = OperatorAction(kind=ActionKind.START_CAMPAIGN, params={"rounds": 2})
    replay2 = await svc.execute(tampered, op, confirmation_token=token)
    assert "mismatch" in replay2.message.lower()

    ok = await svc.execute(action, op, confirmation_token=token)
    assert ok.ok is True
    replay3 = await svc.execute(action, op, confirmation_token=token)
    assert "replay" in replay3.message.lower()


@pytest.mark.asyncio
async def test_idempotency_replay(audit_tmp):
    audit, confirm = audit_tmp
    svc = _svc(audit, confirm)
    op = OperatorPrincipal("alice", OperatorRole.OPERATOR, "secure")
    action = OperatorAction(kind=ActionKind.REPORT_STATUS, idempotency_key="idem-1")
    r1 = await svc.execute(action, op)
    r2 = await svc.execute(action, op)
    assert r1.ok and r2.ok
    assert "Idempotent replay" in r2.message


def test_operator_api_contract(demo_server):
    c = _client_with_demo_bootstrap(demo_server)
    intent = c.post("/api/operator/intent", json={"text": "report status", "source": "text"})
    assert intent.status_code == 200
    act = c.post("/api/operator/action", json={"action": intent.json()["intent"]["action"]})
    assert act.json()["ok"] is True
    audit = c.get("/api/operator/audit")
    assert len(audit.json()) >= 1


def test_campaign_confirmation_flow(demo_server):
    c = _client_with_demo_bootstrap(demo_server)
    body = {"action": {"kind": "start_campaign", "params": {"rounds": 1, "packs": ["MEM"]}}}
    pending = c.post("/api/operator/action", json=body).json()
    assert pending["requires_confirmation"] is True
    conf = pending["confirmation"]["token"]
    started = c.post("/api/operator/action", json={**body, "confirmation_token": conf})
    assert started.json()["ok"] is True


def test_voice_simulated_stt_demo_only(demo_server):
    c = _client_with_demo_bootstrap(demo_server)
    r = c.post("/api/operator/voice/stt", json={"simulate_transcript": "report status"})
    assert r.json()["adapter"] == "simulated"


def test_voice_simulate_blocked_in_secure_mode(secure_server):
    c = _client_with_secure_login(secure_server, "operator", "op-pass")
    r = c.post("/api/operator/voice/stt", json={"simulate_transcript": "report status"})
    assert r.status_code == 403
