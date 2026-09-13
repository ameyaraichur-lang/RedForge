"""Staging, checksum manifests, and atomic publication for E2E release artifacts."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from redforge.version import __version__

REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_DIR = REPO_ROOT / "output" / "e2e"
STAGING_ROOT = CANONICAL_DIR / ".staging"
LOCK_PATH = CANONICAL_DIR / ".publish.lock"
INVALID_MARKER = CANONICAL_DIR / ".INVALID"

PUBLISH_ARTIFACTS: tuple[str, ...] = (
    "scorecard.json",
    "report.json",
    "report.md",
    "report.pdf",
    "findings.json",
    "e2e.db",
    "summary.json",
)

SUMMARY_SNAPSHOT_KEYS = (
    "campaign_id",
    "attempts",
    "findings_total",
    "findings_confirmed",
    "score_total",
    "score_band",
    "stopped_reason",
)


def new_run_id() -> str:
    return f"e2e-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}-{os.getpid()}"


def staging_path(run_id: str) -> Path:
    path = STAGING_ROOT / run_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_checksums(
    directory: Path,
    names: tuple[str, ...] = PUBLISH_ARTIFACTS,
) -> dict[str, str]:
    return {name: file_sha256(directory / name) for name in names}


def validate_summary_invariants(summary: dict[str, Any]) -> None:
    """Raise ValueError when campaign metrics disagree with evidence store counts."""
    ec = summary.get("evidence_counts")
    if not isinstance(ec, dict):
        raise ValueError("summary missing evidence_counts object")

    attempts = summary.get("attempts")
    findings_total = summary.get("findings_total")
    if not isinstance(attempts, int) or attempts < 0:
        raise ValueError(f"invalid attempts: {attempts!r}")
    if not isinstance(findings_total, int) or findings_total < 0:
        raise ValueError(f"invalid findings_total: {findings_total!r}")

    if ec.get("attempts") != attempts:
        raise ValueError(
            f"attempts mismatch: summary={attempts} evidence={ec.get('attempts')}"
        )
    if ec.get("transcripts") != attempts:
        raise ValueError(
            f"transcripts mismatch: summary={attempts} evidence={ec.get('transcripts')}"
        )
    if ec.get("findings") != findings_total:
        raise ValueError(
            f"findings mismatch: summary={findings_total} evidence={ec.get('findings')}"
        )
    verdicts = ec.get("verdicts")
    if not isinstance(verdicts, int) or verdicts < attempts:
        raise ValueError(
            f"verdicts invariant failed: verdicts={verdicts} attempts={attempts}"
        )


def validate_staging(staging: Path) -> dict[str, Any]:
    """Ensure a staging directory is complete and internally consistent."""
    for name in PUBLISH_ARTIFACTS:
        if not (staging / name).is_file():
            raise FileNotFoundError(f"missing staging artifact: {name}")

    summary = json.loads((staging / "summary.json").read_text(encoding="utf-8"))
    if summary.get("stopped_reason") != "completed":
        raise ValueError(
            f"staging campaign incomplete: stopped_reason={summary.get('stopped_reason')!r}"
        )
    validate_summary_invariants(summary)

    findings = json.loads((staging / "findings.json").read_text(encoding="utf-8"))
    if len(findings) != summary["findings_total"]:
        raise ValueError(
            f"findings.json count {len(findings)} != summary findings_total "
            f"{summary['findings_total']}"
        )
    return summary


def build_manifest(
    *,
    run_id: str,
    seed: int | None,
    summary: dict[str, Any],
    checksums: dict[str, str],
    completion_status: str = "complete",
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "seed": seed,
        "redforge_version": __version__,
        "published_at": datetime.now(UTC).isoformat(),
        "completion_status": completion_status,
        "summary": {key: summary[key] for key in SUMMARY_SNAPSHOT_KEYS if key in summary},
        "evidence_counts": dict(summary.get("evidence_counts") or {}),
        "checksums": checksums,
        "artifacts": list(PUBLISH_ARTIFACTS),
    }


@contextmanager
def publish_lock(timeout_sec: float = 600) -> Iterator[None]:
    """Exclusive process lock for canonical E2E publication."""
    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)
    lock_file = LOCK_PATH.open("a+", encoding="utf-8")
    try:
        deadline = time.monotonic() + timeout_sec
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"timed out waiting for publish lock ({LOCK_PATH})"
                    ) from None
                time.sleep(0.05)
        yield
    finally:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


def atomic_publish(staging: Path, manifest: dict[str, Any]) -> Path:
    """Validate staging, then atomically replace canonical release artifacts."""
    summary = validate_staging(staging)
    checksums = compute_checksums(staging)
    for name, digest in checksums.items():
        if manifest["checksums"].get(name) != digest:
            raise ValueError(f"manifest checksum mismatch for {name}")
    for key in SUMMARY_SNAPSHOT_KEYS:
        if manifest.get("summary", {}).get(key) != summary.get(key):
            raise ValueError(f"manifest summary drift for {key}")

    with publish_lock():
        INVALID_MARKER.unlink(missing_ok=True)
        for name in PUBLISH_ARTIFACTS:
            src = staging / name
            dst = CANONICAL_DIR / name
            tmp = CANONICAL_DIR / f".{name}.tmp"
            shutil.copy2(src, tmp)
            os.replace(tmp, dst)

        tmp_manifest = CANONICAL_DIR / ".manifest.json.tmp"
        tmp_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        os.replace(tmp_manifest, CANONICAL_DIR / "manifest.json")

    return CANONICAL_DIR


def validate_canonical() -> dict[str, Any]:
    """Gate entrypoint: reject partial, stale, or inconsistent canonical artifacts."""
    if INVALID_MARKER.is_file():
        reason = INVALID_MARKER.read_text(encoding="utf-8").strip()
        raise ValueError(f"canonical E2E artifacts invalidated: {reason or 'unspecified'}")

    manifest_path = CANONICAL_DIR / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(
            "manifest.json missing — canonical output/e2e was not atomically published"
        )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("completion_status") != "complete":
        raise ValueError(
            f"incomplete publication status: {manifest.get('completion_status')!r}"
        )

    for name in PUBLISH_ARTIFACTS:
        path = CANONICAL_DIR / name
        if not path.is_file():
            raise FileNotFoundError(f"missing canonical artifact: {name}")
        expected = manifest.get("checksums", {}).get(name)
        if not expected:
            raise ValueError(f"manifest missing checksum for {name}")
        actual = file_sha256(path)
        if actual != expected:
            raise ValueError(f"checksum mismatch for {name}")

    summary = json.loads((CANONICAL_DIR / "summary.json").read_text(encoding="utf-8"))
    validate_summary_invariants(summary)

    for key in SUMMARY_SNAPSHOT_KEYS:
        if manifest.get("summary", {}).get(key) != summary.get(key):
            raise ValueError(f"summary drift vs manifest for {key}")

    findings = json.loads((CANONICAL_DIR / "findings.json").read_text(encoding="utf-8"))
    if len(findings) != summary["findings_total"]:
        raise ValueError("findings.json count disagrees with summary.json")

    return {"manifest": manifest, "summary": summary}


def invalidate_canonical(reason: str) -> None:
    """Mark canonical release artifacts untrustworthy (e.g. after a writer race)."""
    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)
    INVALID_MARKER.write_text(reason.strip() + "\n", encoding="utf-8")
    (CANONICAL_DIR / "manifest.json").unlink(missing_ok=True)
