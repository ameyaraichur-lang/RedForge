"""Durable confirmation JTI ledger and tamper-evident audit chain tests."""
from __future__ import annotations

import multiprocessing as mp
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

from redforge.operator.audit import AuditChainError, AuditStore, GENESIS_HASH
from redforge.operator.auth import OperatorPrincipal
from redforge.operator.confirm_store import ConfirmationStore
from redforge.operator.schemas import ActionKind, AuditDecision, OperatorAction, OperatorRole
from redforge.operator.secrets import assert_secure_operator_config, audit_signing_key
from redforge.operator.service import OperatorService
from redforge.config import settings


@pytest.fixture
def op_db(tmp_path):
    return tmp_path / "operator.db"


@pytest.fixture
def audit_store(op_db):
    return AuditStore(op_db)


@pytest.fixture
def confirm_store(op_db):
    return ConfirmationStore(op_db)


def _svc(audit: AuditStore, confirm: ConfirmationStore) -> OperatorService:
    async def _start(packs, rounds, target=None):
        return ({"campaign_id": "C-TEST"}, 200)

    return OperatorService(
        audit,
        confirm,
        live_status=lambda: {"running": False, "attempts": 0, "findings_total": 0},
        live_start=_start,
        live_abort=lambda: {"aborting": False, "reason": "no campaign running"},
        live_gates=lambda: [],
        live_findings=lambda: [],
        live_sign_gate=lambda gid, signer: {"id": gid},
        live_report=lambda: {"ready": False},
        live_events=lambda: [],
    )


def test_confirm_jti_survives_restart(op_db, confirm_store):
    assert confirm_store.try_consume(
        jti="jti-restart-1", actor="alice", fingerprint="fp1", expires_at=time.time() + 300,
    )
    reloaded = ConfirmationStore(op_db)
    assert not reloaded.try_consume(
        jti="jti-restart-1", actor="alice", fingerprint="fp1", expires_at=time.time() + 300,
    )
    assert reloaded.is_consumed("jti-restart-1")


def _mp_try_consume_jti(db_path: str, jti: str, out: mp.Queue) -> None:
    store = ConfirmationStore(Path(db_path))
    ok = store.try_consume(
        jti=jti, actor="a", fingerprint="fp", expires_at=time.time() + 300,
    )
    out.put(ok)


def test_confirm_jti_multiprocess_single_winner(op_db):
    jti = "jti-mp-race"
    q: mp.Queue = mp.Queue()
    workers = [
        mp.Process(target=_mp_try_consume_jti, args=(str(op_db), jti, q))
        for _ in range(4)
    ]
    for p in workers:
        p.start()
    for p in workers:
        p.join(timeout=30)
    results = [q.get_nowait() for _ in range(4)]
    assert results.count(True) == 1
    assert results.count(False) == 3
    reloaded = ConfirmationStore(op_db)
    assert reloaded.is_consumed(jti)


def test_confirm_jti_multiprocess_restart_replay(op_db, confirm_store):
    jti = "jti-mp-restart"
    assert confirm_store.try_consume(
        jti=jti, actor="a", fingerprint="fp", expires_at=time.time() + 300,
    )
    q: mp.Queue = mp.Queue()
    p = mp.Process(target=_mp_try_consume_jti, args=(str(op_db), jti, q))
    p.start()
    p.join(timeout=30)
    assert q.get() is False


def test_confirm_jti_concurrent_single_winner(op_db, confirm_store):
    barrier = threading.Barrier(8)
    results: list[bool] = []

    def attempt() -> None:
        barrier.wait()
        results.append(
            confirm_store.try_consume(
                jti="jti-race", actor="a", fingerprint="fp", expires_at=time.time() + 120,
            ),
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: attempt(), range(8)))

    assert results.count(True) == 1
    assert results.count(False) == 7


def test_confirm_jti_expiry_cleanup(op_db, confirm_store):
    assert confirm_store.try_consume(
        jti="old-jti", actor="a", fingerprint="fp", expires_at=time.time() + 60,
    )
    with confirm_store._db.transaction() as conn:
        conn.execute(
            "UPDATE consumed_confirmations SET expires_at = ? WHERE jti = ?",
            (time.time() - 10, "old-jti"),
        )
    removed = confirm_store.cleanup_expired()
    assert removed >= 1
    assert not confirm_store.is_consumed("old-jti")


@pytest.mark.asyncio
async def test_confirmation_restart_replay_blocked(op_db, audit_store, confirm_store):
    svc = _svc(audit_store, confirm_store)
    op = OperatorPrincipal("alice", OperatorRole.OPERATOR, "secure")
    action = OperatorAction(kind=ActionKind.START_CAMPAIGN, params={"rounds": 1})
    pending = await svc.execute(action, op)
    token = pending.confirmation.token

    ok = await svc.execute(action, op, confirmation_token=token)
    assert ok.ok is True

    svc2 = _svc(AuditStore(op_db), ConfirmationStore(op_db))
    replay = await svc2.execute(action, op, confirmation_token=token)
    assert "replay" in replay.message.lower()


@pytest.mark.asyncio
async def test_confirmation_actor_fingerprint_binding(op_db, audit_store, confirm_store):
    svc = _svc(audit_store, confirm_store)
    op = OperatorPrincipal("alice", OperatorRole.OPERATOR, "secure")
    action = OperatorAction(kind=ActionKind.START_CAMPAIGN, params={"rounds": 1})
    pending = await svc.execute(action, op)
    token = pending.confirmation.token

    bob = OperatorPrincipal("bob", OperatorRole.OPERATOR, "secure")
    assert "actor mismatch" in (
        await svc.execute(action, bob, confirmation_token=token)
    ).message.lower()

    tampered = OperatorAction(kind=ActionKind.START_CAMPAIGN, params={"rounds": 2})
    assert "mismatch" in (
        await svc.execute(tampered, op, confirmation_token=token)
    ).message.lower()


@pytest.mark.asyncio
async def test_idempotency_via_audit_chain(op_db, audit_store, confirm_store):
    svc = _svc(audit_store, confirm_store)
    op = OperatorPrincipal("alice", OperatorRole.OPERATOR, "secure")
    action = OperatorAction(kind=ActionKind.REPORT_STATUS, idempotency_key="idem-x")
    r1 = await svc.execute(action, op)
    r2 = await svc.execute(action, op)
    assert r1.ok and r2.ok
    assert "Idempotent replay" in r2.message


def test_audit_chain_valid_append_and_verify(audit_store):
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp1", decision=AuditDecision.EXECUTED,
        result_summary="ok", correlation_id="c1",
    )
    audit_store.verify_chain()
    assert audit_store.chain_valid
    recs = audit_store.list_records()
    assert len(recs) == 1


def test_audit_chain_restart_continuity(op_db):
    s1 = AuditStore(op_db)
    s1.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp1", decision=AuditDecision.EXECUTED,
        result_summary="first", correlation_id="c1",
    )
    s2 = AuditStore(op_db)
    s2.append(
        actor="b", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp2", decision=AuditDecision.EXECUTED,
        result_summary="second", correlation_id="c2",
    )
    s2.verify_chain()
    assert len(s2.list_records()) == 2


def test_audit_chain_detects_modified_entry(op_db, audit_store):
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp", decision=AuditDecision.EXECUTED,
        result_summary="ok", correlation_id="c1",
    )
    conn = sqlite3.connect(op_db)
    conn.execute("UPDATE operator_audit SET result_summary = 'tampered' WHERE seq = 1")
    conn.commit()
    conn.close()
    reloaded = AuditStore(op_db)
    assert not reloaded.chain_valid
    with pytest.raises(AuditChainError):
        reloaded.list_records()


def test_audit_chain_detects_deleted_entry(op_db, audit_store):
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp1", decision=AuditDecision.EXECUTED,
        result_summary="one", correlation_id="c1",
    )
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp2", decision=AuditDecision.EXECUTED,
        result_summary="two", correlation_id="c2",
    )
    conn = sqlite3.connect(op_db)
    conn.execute("DELETE FROM operator_audit WHERE seq = 1")
    conn.commit()
    conn.close()
    reloaded = AuditStore(op_db)
    assert not reloaded.chain_valid


def test_audit_chain_detects_reordered_prev_hash(op_db, audit_store):
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp1", decision=AuditDecision.EXECUTED,
        result_summary="one", correlation_id="c1",
    )
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp2", decision=AuditDecision.EXECUTED,
        result_summary="two", correlation_id="c2",
    )
    conn = sqlite3.connect(op_db)
    conn.execute(
        "UPDATE operator_audit SET prev_hash = ? WHERE seq = 2",
        (GENESIS_HASH,),
    )
    conn.commit()
    conn.close()
    reloaded = AuditStore(op_db)
    assert not reloaded.chain_valid


def test_audit_concurrent_appends(op_db):
    store = AuditStore(op_db)
    errors: list[str] = []

    def writer(i: int) -> None:
        try:
            store.append(
                actor=f"u{i}", role=OperatorRole.OPERATOR,
                action=ActionKind.REPORT_STATUS, input_fingerprint=f"fp{i}",
                decision=AuditDecision.EXECUTED, result_summary=f"r{i}",
                correlation_id=f"c{i}",
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(writer, range(24)))

    assert not errors
    store.verify_chain()
    assert len(store.list_records(limit=500)) == 24


def test_secure_mode_rejects_unsafe_audit_key(monkeypatch):
    monkeypatch.setattr(settings, "operator_auth_mode", "secure")
    monkeypatch.setattr(settings, "operator_audit_signing_key", "rf-dev-audit-signing-key-not-for-production")
    with pytest.raises(RuntimeError, match="unsafe"):
        audit_signing_key()


def test_secure_mode_rejects_unsafe_session_on_startup(monkeypatch):
    monkeypatch.setattr(settings, "operator_auth_mode", "secure")
    monkeypatch.setattr(settings, "operator_session_secret", "short")
    monkeypatch.setattr(settings, "operator_audit_signing_key", "a" * 32)
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        assert_secure_operator_config()


def _mp_audit_append(db_path: str, i: int, out: mp.Queue) -> None:
    try:
        store = AuditStore(Path(db_path))
        store.append(
            actor=f"mp{i}", role=OperatorRole.OPERATOR,
            action=ActionKind.REPORT_STATUS, input_fingerprint=f"fp{i}",
            decision=AuditDecision.EXECUTED, result_summary=f"r{i}",
            correlation_id=f"c{i}",
        )
        out.put(None)
    except Exception as exc:  # noqa: BLE001
        out.put(str(exc))


def test_audit_multiprocess_concurrent_append(op_db):
    q: mp.Queue = mp.Queue()
    workers = [
        mp.Process(target=_mp_audit_append, args=(str(op_db), i, q))
        for i in range(8)
    ]
    for p in workers:
        p.start()
    for p in workers:
        p.join(timeout=60)
    errors = [q.get() for _ in range(8)]
    assert all(e is None for e in errors)
    store = AuditStore(op_db)
    store.verify_chain()
    assert len(store.list_records(limit=500)) == 8


def test_health_degrades_on_tampered_audit_chain(op_db, audit_store):
    audit_store.append(
        actor="a", role=OperatorRole.OPERATOR, action=ActionKind.REPORT_STATUS,
        input_fingerprint="fp", decision=AuditDecision.EXECUTED,
        result_summary="ok", correlation_id="c1",
    )
    conn = sqlite3.connect(op_db)
    conn.execute("UPDATE operator_audit SET result_summary = 'tampered' WHERE seq = 1")
    conn.commit()
    conn.close()

    import os

    from _server import allocate_port, uvicorn_server

    port = allocate_port()
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_OPERATOR_AUTH_MODE": "demo",
        "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
        "RF_OPERATOR_DB": str(op_db),
    }
    with uvicorn_server(port=port, env=env) as base:
        health = httpx.get(f"{base}/api/health", timeout=5).json()
        assert health["ok"] is False
        assert health["operator_audit_chain_ok"] is False
        assert health["operator_audit_chain_error"]
