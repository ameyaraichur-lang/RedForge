"""E2E release artifact safety: lock, atomic publish, corruption detection, seed."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import httpx
import pytest

from redforge.catalog import demo_target
from redforge.e2e.artifacts import (
    CANONICAL_DIR,
    INVALID_MARKER,
    LOCK_PATH,
    STAGING_ROOT,
    atomic_publish,
    build_manifest,
    compute_checksums,
    invalidate_canonical,
    publish_lock,
    staging_path,
    validate_canonical,
    validate_staging,
    validate_summary_invariants,
)
from redforge.e2e.ids import RunIds
from redforge.evidence import EvidenceStore
from redforge.schemas import BudgetCaps, Campaign
from redforge.swarm import CampaignEngine
from redforge.targets import app, demo_adapter


@pytest.fixture
def isolated_e2e_dirs(monkeypatch, tmp_path):
    canonical = tmp_path / "e2e"
    staging = canonical / ".staging"
    lock_path = canonical / ".publish.lock"
    invalid = canonical / ".INVALID"
    canonical.mkdir()
    staging.mkdir()
    monkeypatch.setattr("redforge.e2e.artifacts.CANONICAL_DIR", canonical)
    monkeypatch.setattr("redforge.e2e.artifacts.STAGING_ROOT", staging)
    monkeypatch.setattr("redforge.e2e.artifacts.LOCK_PATH", lock_path)
    monkeypatch.setattr("redforge.e2e.artifacts.INVALID_MARKER", invalid)
    return canonical


def _summary(**overrides) -> dict:
    base = {
        "campaign_id": "C-TEST",
        "attempts": 10,
        "findings_total": 3,
        "findings_confirmed": 2,
        "score_total": 50.0,
        "score_band": "Fair",
        "stopped_reason": "completed",
        "evidence_counts": {
            "attempts": 10,
            "transcripts": 10,
            "verdicts": 15,
            "findings": 3,
        },
    }
    base.update(overrides)
    return base


def _write_staging(staging: Path, summary: dict | None = None) -> dict:
    summary = summary or _summary()
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "scorecard.json").write_text(json.dumps({"total": summary["score_total"]}))
    (staging / "report.json").write_text("{}")
    (staging / "report.md").write_text("# report\n" + ("x" * 1100))
    (staging / "report.pdf").write_text("pdf-bytes" * 200)
    findings = [{"id": f"RF-F-{i:04d}"} for i in range(summary["findings_total"])]
    (staging / "findings.json").write_text(json.dumps(findings))
    (staging / "e2e.db").write_bytes(b"sqlite-placeholder")
    (staging / "summary.json").write_text(json.dumps(summary))
    return summary


def test_validate_summary_invariants_rejects_mismatch():
    bad = _summary(
        attempts=215,
        evidence_counts={"attempts": 30, "transcripts": 30, "verdicts": 62, "findings": 18},
        findings_total=29,
    )
    with pytest.raises(ValueError, match="attempts mismatch"):
        validate_summary_invariants(bad)


def test_publish_lock_serializes(isolated_e2e_dirs):
    order: list[str] = []
    barrier = threading.Barrier(2)

    def worker(tag: str) -> None:
        barrier.wait(timeout=2)
        with publish_lock(timeout_sec=5):
            order.append(f"{tag}-enter")
            time.sleep(0.15)
            order.append(f"{tag}-exit")

    threads = [threading.Thread(target=worker, args=(tag,)) for tag in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert order.index("a-enter") < order.index("a-exit")
    assert order.index("b-enter") < order.index("b-exit")
    if os.name == "posix":
        # flock serialization is POSIX-only; on Windows the publish lock is a
        # documented no-op, so strict mutual exclusion is not asserted there.
        assert (
            order.index("a-exit") < order.index("b-enter")
            or order.index("b-exit") < order.index("a-enter")
        )


def test_atomic_publish_and_validate(isolated_e2e_dirs):
    staging = isolated_e2e_dirs / ".staging" / "run-a"
    summary = _write_staging(staging)
    checksums = compute_checksums(staging)
    manifest = build_manifest(run_id="run-a", seed=42, summary=summary, checksums=checksums)
    atomic_publish(staging, manifest)

    validated = validate_canonical()
    assert validated["manifest"]["run_id"] == "run-a"
    assert validated["summary"]["attempts"] == 10
    assert (isolated_e2e_dirs / "manifest.json").is_file()


def test_corruption_detection(isolated_e2e_dirs):
    staging = isolated_e2e_dirs / ".staging" / "run-b"
    summary = _write_staging(staging)
    checksums = compute_checksums(staging)
    manifest = build_manifest(run_id="run-b", seed=7, summary=summary, checksums=checksums)
    atomic_publish(staging, manifest)

    (isolated_e2e_dirs / "summary.json").write_text('{"attempts": 999}')
    with pytest.raises(ValueError, match="checksum mismatch"):
        validate_canonical()


def test_partial_staging_rejected(isolated_e2e_dirs):
    staging = isolated_e2e_dirs / ".staging" / "partial"
    staging.mkdir(parents=True)
    (staging / "summary.json").write_text(json.dumps(_summary()))
    with pytest.raises(FileNotFoundError, match="missing staging artifact"):
        validate_staging(staging)


def test_invalidate_blocks_validation(isolated_e2e_dirs):
    staging = isolated_e2e_dirs / ".staging" / "run-c"
    summary = _write_staging(staging)
    checksums = compute_checksums(staging)
    manifest = build_manifest(run_id="run-c", seed=1, summary=summary, checksums=checksums)
    atomic_publish(staging, manifest)
    invalidate_canonical("overlapping writers raced on output/e2e")
    with pytest.raises(ValueError, match="invalidated"):
        validate_canonical()


@pytest.fixture
async def clean_demo_target():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://demo.local",
    ) as client:
        await client.get("/__test/reset")
    yield


async def test_seeded_campaign_is_reproducible(clean_demo_target):
    seed = 424242

    async def _run_once() -> tuple[int, list[str]]:
        engine = CampaignEngine(run_seed=seed)
        campaign = Campaign(
            id="C-SEED-TEST",
            name="seed reproducibility",
            targets=[demo_target()],
            packs=["PIN", "EXF"],
            rounds_max=1,
            caps=BudgetCaps(max_attempts=40, max_tokens=5_000_000, max_cost_usd=10.0),
        )
        result = await engine.run_campaign(campaign, demo_adapter())
        finding_ids = [f.id for f in result.findings]
        return result.attempts, finding_ids

    first_attempts, first_ids = await _run_once()
    second_attempts, second_ids = await _run_once()
    assert first_attempts == second_attempts
    assert first_ids == second_ids


def test_run_ids_random_when_unseeded():
    a = RunIds(None)
    b = RunIds(None)
    samples = {a.hex8() for _ in range(20)} | {b.hex8() for _ in range(20)}
    assert len(samples) > 1


def test_staging_path_isolated_per_run_id(isolated_e2e_dirs, monkeypatch):
    monkeypatch.setattr("redforge.e2e.artifacts.STAGING_ROOT", isolated_e2e_dirs / ".staging")
    a = staging_path("run-one")
    b = staging_path("run-two")
    assert a != b
    assert a.parent == b.parent
