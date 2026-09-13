"""Durable confirmation-token JTI consumption — survives restarts and multi-worker races."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from .db import OperatorDb


class ConfirmationStore:
    """Atomic consumed-JTI ledger backed by SQLite PRIMARY KEY uniqueness."""

    def __init__(self, db_path: Path) -> None:
        self._db = OperatorDb(db_path)

    def try_consume(
        self,
        *,
        jti: str,
        actor: str,
        fingerprint: str,
        expires_at: float,
    ) -> bool:
        """Record first use of a confirmation JTI. Returns False on replay."""
        if not jti:
            return False
        now = time.time()
        if expires_at and now > float(expires_at):
            return False
        try:
            with self._db.transaction() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO consumed_confirmations
                        (jti, actor, fingerprint, consumed_at, expires_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (jti, actor, fingerprint, now, float(expires_at or now)),
                )
                return cur.rowcount == 1
        except sqlite3.IntegrityError:
            return False

    def cleanup_expired(self, *, now: float | None = None) -> int:
        """Remove consumed JTIs past expiry (tokens themselves are short-lived)."""
        cutoff = float(now if now is not None else time.time())
        with self._db.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM consumed_confirmations WHERE expires_at < ?",
                (cutoff,),
            )
            return int(cur.rowcount or 0)

    def is_consumed(self, jti: str) -> bool:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM consumed_confirmations WHERE jti = ?",
                (jti,),
            ).fetchone()
            return row is not None
