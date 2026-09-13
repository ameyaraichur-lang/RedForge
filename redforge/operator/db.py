"""Shared SQLite access for durable operator stores."""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class OperatorDb:
    """Thread-safe SQLite helper with WAL for concurrent readers/writers."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS consumed_confirmations (
                        jti TEXT PRIMARY KEY,
                        actor TEXT NOT NULL,
                        fingerprint TEXT NOT NULL,
                        consumed_at REAL NOT NULL,
                        expires_at REAL NOT NULL
                    )
                    """,
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_consumed_expires "
                    "ON consumed_confirmations(expires_at)",
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS operator_audit (
                        seq INTEGER PRIMARY KEY AUTOINCREMENT,
                        id TEXT NOT NULL UNIQUE,
                        correlation_id TEXT NOT NULL,
                        actor TEXT NOT NULL,
                        role TEXT NOT NULL,
                        action TEXT NOT NULL,
                        input_fingerprint TEXT NOT NULL,
                        decision TEXT NOT NULL,
                        result_summary TEXT NOT NULL,
                        ts TEXT NOT NULL,
                        idempotency_key TEXT,
                        prev_hash TEXT NOT NULL,
                        entry_hash TEXT NOT NULL
                    )
                    """,
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_audit_idempotency "
                    "ON operator_audit(idempotency_key, decision)",
                )
            finally:
                conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                yield conn
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            finally:
                conn.close()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = self._connect()
            try:
                yield conn
            finally:
                conn.close()
