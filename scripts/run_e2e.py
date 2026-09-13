"""End-to-end demo campaign: full swarm vs vulnerable demo target -> scorecard,
report (md/json) and regulatory PDF.

Each run stages artifacts under output/e2e/.staging/<run_id>/, then atomically
publishes to output/e2e/ under an exclusive lock with a checksum manifest.

Environment:
  RF_E2E_SEED       Fixed RNG seed for reproducible demo ids (default: 42).
                    Set to "random" for production-style uuid ids.
  RF_E2E_RUN_ID     Optional staging directory name (for tests).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from redforge.gates.demo_env import apply_gate_demo_env

apply_gate_demo_env()

from redforge.catalog import demo_target
from redforge.e2e.artifacts import (
    PUBLISH_ARTIFACTS,
    atomic_publish,
    build_manifest,
    compute_checksums,
    new_run_id,
    staging_path,
    validate_staging,
)
from redforge.evidence import EvidenceStore
from redforge.reporting import generate_report, render_pdf
from redforge.judge.llm_judge import DemoLLMJudge
from redforge.schemas import BudgetCaps, Campaign
from redforge.swarm import CampaignEngine
from redforge.targets.adapter import demo_adapter
from redforge.version import __version__


def _parse_seed(raw: str | None) -> int | None:
    if raw is None or raw.strip() == "":
        return 42
    lowered = raw.strip().lower()
    if lowered in {"random", "none", "uuid"}:
        return None
    return int(raw)


async def main() -> dict:
    run_id = os.environ.get("RF_E2E_RUN_ID") or new_run_id()
    seed = _parse_seed(os.environ.get("RF_E2E_SEED"))
    out = staging_path(run_id)
    db = out / "e2e.db"
    if db.exists():
        db.unlink()
    store = EvidenceStore(str(db))

    campaign = Campaign(
        id="C-E2E-DEMO",
        name="RedForge E2E demo campaign",
        targets=[demo_target()],
        packs=["PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"],
        rounds_max=3,
        caps=BudgetCaps(max_attempts=600, max_tokens=50_000_000, max_cost_usd=100.0),
    )
    engine = CampaignEngine(run_seed=seed, judge=DemoLLMJudge())
    result = await engine.run_campaign(campaign, demo_adapter(), store=store)

    report = generate_report(
        findings=result.findings,
        verdicts=result.verdicts,
        scorecard=result.scorecard,
        campaign_id=campaign.id,
        target_name=campaign.targets[0].name,
    )
    pdf_path = render_pdf(report, str(out / "report.pdf"))

    (out / "scorecard.json").write_text(json.dumps(result.scorecard, indent=2))
    (out / "report.json").write_text(
        json.dumps(
            {k: v for k, v in report.items() if k != "markdown"},
            indent=2,
            default=str,
        )
    )
    (out / "report.md").write_text(report["markdown"])
    (out / "findings.json").write_text(
        json.dumps([f.model_dump(mode="json") for f in result.findings], indent=2)
    )

    confirmed = sum(1 for f in result.findings if f.status.value == "Confirmed")
    packs_hit = sorted(
        {
            f.technique_id.split("-")[0]
            for f in result.findings
            if f.status.value == "Confirmed"
        }
    )
    evidence_counts = store.counts()
    summary = {
        "run_id": run_id,
        "seed": seed,
        "redforge_version": __version__,
        "campaign_id": campaign.id,
        "attempts": result.attempts,
        "rounds_executed": result.rounds_executed,
        "stopped_reason": result.stopped_reason,
        "findings_total": len(result.findings),
        "findings_confirmed": confirmed,
        "packs_confirmed": packs_hit,
        "score_total": result.scorecard["total"],
        "score_band": result.scorecard["band"],
        "evidence_counts": evidence_counts,
        "artifacts": list(PUBLISH_ARTIFACTS),
        "pdf_bytes": Path(pdf_path).stat().st_size,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    validate_staging(out)
    checksums = compute_checksums(out)
    manifest = build_manifest(
        run_id=run_id,
        seed=seed,
        summary=summary,
        checksums=checksums,
    )
    atomic_publish(out, manifest)

    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
