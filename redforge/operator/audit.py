"""Tamper-evident operator audit log — SQLite append-only HMAC hash chain."""
from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .db import OperatorDb
from .schemas import AuditDecision, AuditRecord, OperatorRole, ActionKind
from .secrets import audit_signing_key

GENESIS_HASH = "0" * 64


class AuditChainError(Exception):
    """Raised when the audit hash chain fails verification."""


class AuditStore:
    """Append-only audit with per-entry HMAC chain and startup verification."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._db = OperatorDb(db_path)
        self.chain_valid = True
        self.chain_error: str | None = None
        self._verify_on_startup()

    def _signing_key(self) -> str:
        return audit_signing_key()

    @staticmethod
    def _canonical_payload(rec: AuditRecord) -> str:
        body = {
            "id": rec.id,
            "correlation_id": rec.correlation_id,
            "actor": rec.actor,
            "role": rec.role.value,
            "action": rec.action.value,
            "input_fingerprint": rec.input_fingerprint,
            "decision": rec.decision.value,
            "result_summary": rec.result_summary,
            "ts": rec.ts,
            "idempotency_key": rec.idempotency_key,
        }
        return json.dumps(body, sort_keys=True, separators=(",", ":"))

    def _compute_entry_hash(self, seq: int, prev_hash: str, payload: str) -> str:
        msg = f"{seq}|{prev_hash}|{payload}".encode()
        return hmac.new(self._signing_key().encode(), msg, hashlib.sha256).hexdigest()

    def _row_to_record(self, row) -> AuditRecord:
        return AuditRecord(
            id=row["id"],
            correlation_id=row["correlation_id"],
            actor=row["actor"],
            role=OperatorRole(row["role"]),
            action=ActionKind(row["action"]),
            input_fingerprint=row["input_fingerprint"],
            decision=AuditDecision(row["decision"]),
            result_summary=row["result_summary"],
            ts=row["ts"],
            idempotency_key=row["idempotency_key"],
        )

    def verify_chain(self) -> None:
        """Verify full chain integrity; sets chain_valid / chain_error."""
        try:
            with self._db.connect() as conn:
                rows = conn.execute(
                    "SELECT seq, prev_hash, entry_hash, id, correlation_id, actor, role, "
                    "action, input_fingerprint, decision, result_summary, ts, idempotency_key "
                    "FROM operator_audit ORDER BY seq ASC",
                ).fetchall()
            prev = GENESIS_HASH
            for row in rows:
                rec = self._row_to_record(row)
                payload = self._canonical_payload(rec)
                if row["prev_hash"] != prev:
                    raise AuditChainError(
                        f"broken chain at seq {row['seq']}: prev_hash mismatch",
                    )
                expected = self._compute_entry_hash(int(row["seq"]), prev, payload)
                if not hmac.compare_digest(expected, row["entry_hash"]):
                    raise AuditChainError(
                        f"tampered entry at seq {row['seq']}: entry_hash mismatch",
                    )
                prev = row["entry_hash"]
            self.chain_valid = True
            self.chain_error = None
        except AuditChainError as exc:
            self.chain_valid = False
            self.chain_error = str(exc)
            raise

    def _verify_on_startup(self) -> None:
        try:
            self.verify_chain()
        except AuditChainError:
            pass  # chain_valid / chain_error already set

    def _require_valid_chain(self) -> None:
        if not self.chain_valid:
            raise AuditChainError(self.chain_error or "audit chain invalid")

    def append(
        self,
        *,
        actor: str,
        role: OperatorRole,
        action: ActionKind,
        input_fingerprint: str,
        decision: AuditDecision,
        result_summary: str,
        correlation_id: str,
        idempotency_key: str | None = None,
    ) -> AuditRecord:
        self._require_valid_chain()
        rec = AuditRecord(
            id=f"AUD-{uuid.uuid4().hex[:12]}",
            correlation_id=correlation_id,
            actor=actor,
            role=role,
            action=action,
            input_fingerprint=input_fingerprint,
            decision=decision,
            result_summary=result_summary,
            ts=datetime.now(timezone.utc).isoformat(),
            idempotency_key=idempotency_key,
        )
        payload = self._canonical_payload(rec)
        with self._db.transaction() as conn:
            last = conn.execute(
                "SELECT seq, entry_hash FROM operator_audit ORDER BY seq DESC LIMIT 1",
            ).fetchone()
            seq = int(last["seq"]) + 1 if last else 1
            prev_hash = last["entry_hash"] if last else GENESIS_HASH
            entry_hash = self._compute_entry_hash(seq, prev_hash, payload)
            conn.execute(
                """
                INSERT INTO operator_audit
                    (id, correlation_id, actor, role, action, input_fingerprint,
                     decision, result_summary, ts, idempotency_key, prev_hash, entry_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rec.id,
                    rec.correlation_id,
                    rec.actor,
                    rec.role.value,
                    rec.action.value,
                    rec.input_fingerprint,
                    rec.decision.value,
                    rec.result_summary,
                    rec.ts,
                    rec.idempotency_key,
                    prev_hash,
                    entry_hash,
                ),
            )
        return rec

    def list_records(self, *, limit: int = 100) -> list[AuditRecord]:
        self._require_valid_chain()
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT id, correlation_id, actor, role, action, input_fingerprint, "
                "decision, result_summary, ts, idempotency_key "
                "FROM operator_audit ORDER BY seq DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        out = [self._row_to_record(r) for r in reversed(rows)]
        return out

    def find_idempotency(self, key: str) -> AuditRecord | None:
        if not key:
            return None
        self._require_valid_chain()
        with self._db.connect() as conn:
            row = conn.execute(
                """
                SELECT id, correlation_id, actor, role, action, input_fingerprint,
                       decision, result_summary, ts, idempotency_key
                FROM operator_audit
                WHERE idempotency_key = ? AND decision = ?
                ORDER BY seq DESC LIMIT 1
                """,
                (key, AuditDecision.EXECUTED.value),
            ).fetchone()
        return self._row_to_record(row) if row else None
