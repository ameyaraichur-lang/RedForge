"""Evidence Store (M5a): durable SQLite persistence for the four audit
artifacts — attempts, transcripts, verdicts, findings.

CANONICAL PROTOCOL: other modules import EvidenceStore from this module.

Tenets: every finding ships with full transcript evidence + judge confidence
(audit-grade by construction); persistence is idempotent (safe re-runs).
"""
from __future__ import annotations

from typing import TypeVar

from sqlalchemy import Column, MetaData, String, Table, create_engine, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from redforge.schemas import (
    AttackAttempt,
    Finding,
    FindingStatus,
    Transcript,
    Verdict,
)

ModelT = TypeVar("ModelT", AttackAttempt, Transcript, Verdict, Finding)

metadata = MetaData()

attempts = Table(
    "attempts",
    metadata,
    Column("id", String, primary_key=True),
    Column("campaign_id", String),
    Column("payload_json", String),
)
transcripts = Table(
    "transcripts",
    metadata,
    Column("id", String, primary_key=True),
    Column("campaign_id", String),
    Column("payload_json", String),
)
verdicts = Table(
    "verdicts",
    metadata,
    Column("id", String, primary_key=True),
    Column("campaign_id", String),
    Column("payload_json", String),
)
findings = Table(
    "findings",
    metadata,
    Column("id", String, primary_key=True),
    Column("campaign_id", String),
    Column("payload_json", String),
)


class EvidenceStore:
    """SQLite-backed store for the audit trail.

    All writes are upserts keyed by artifact id (idempotent re-runs).
    Every method opens a fresh session (context manager) so instances are
    safe to share across threads.
    """

    def __init__(self, db_path: str = ":memory:"):
        if db_path == ":memory:":
            url = "sqlite:///:memory:"
        else:
            url = f"sqlite:///{db_path}"
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        self._session_factory = sessionmaker(bind=self.engine)
        metadata.create_all(self.engine)

    # ------------------------------------------------------------------ write

    def _upsert(self, table: Table, model: ModelT) -> None:
        payload = model.model_dump_json()
        campaign_id = getattr(model, "campaign_id", None)
        stmt = sqlite_insert(table).values(
            id=model.id, campaign_id=campaign_id, payload_json=payload
        ).on_conflict_do_update(
            index_elements=[table.c.id],
            set_={"payload_json": payload, "campaign_id": campaign_id},
        )
        with self._session_factory.begin() as session:
            session.execute(stmt)

    def record_attempt(self, a: AttackAttempt) -> None:
        self._upsert(attempts, a)

    def record_transcript(self, t: Transcript) -> None:
        self._upsert(transcripts, t)

    def record_verdict(self, v: Verdict) -> None:
        self._upsert(verdicts, v)

    def record_finding(self, f: Finding) -> None:
        self._upsert(findings, f)

    # ------------------------------------------------------------------- read

    def _get(self, table: Table, model_cls: type[ModelT], row_id: str) -> ModelT | None:
        with self._session_factory.begin() as session:
            row = session.execute(
                select(table.c.payload_json).where(table.c.id == row_id)
            ).scalar_one_or_none()
        if row is None:
            return None
        return model_cls.model_validate_json(row)

    def get_finding(self, fid: str) -> Finding | None:
        return self._get(findings, Finding, fid)

    def get_transcript(self, tid: str) -> Transcript | None:
        return self._get(transcripts, Transcript, tid)

    def _list(
        self,
        table: Table,
        model_cls: type[ModelT],
        campaign_id: str | None = None,
    ) -> list[ModelT]:
        stmt = select(table.c.payload_json)
        if campaign_id is not None:
            stmt = stmt.where(table.c.campaign_id == campaign_id)
        stmt = stmt.order_by(table.c.id)
        with self._session_factory.begin() as session:
            rows = session.execute(stmt).scalars().all()
        return [model_cls.model_validate_json(r) for r in rows]

    def list_findings(
        self,
        status: FindingStatus | None = None,
        campaign_id: str | None = None,
    ) -> list[Finding]:
        result = self._list(findings, Finding, campaign_id)
        if status is not None:
            result = [f for f in result if f.status == status]
        return result

    def list_attempts(self, campaign_id: str | None = None) -> list[AttackAttempt]:
        return self._list(attempts, AttackAttempt, campaign_id)

    def list_verdicts(self, campaign_id: str | None = None) -> list[Verdict]:
        return self._list(verdicts, Verdict, campaign_id)

    def counts(self) -> dict[str, int]:
        with self._session_factory.begin() as session:
            return {
                name: session.execute(select(func.count()).select_from(t)).scalar_one()
                for name, t in (
                    ("attempts", attempts),
                    ("transcripts", transcripts),
                    ("verdicts", verdicts),
                    ("findings", findings),
                )
            }
