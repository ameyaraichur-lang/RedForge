"""End-to-end demo campaign: full swarm vs vulnerable demo target -> scorecard,
report (md/json) and regulatory PDF. Artifacts land in output/e2e/."""
import asyncio
import json
from pathlib import Path

from redforge.canary import make_canary
from redforge.catalog import demo_target
from redforge.config import settings
from redforge.evidence import EvidenceStore
from redforge.reporting import generate_report, render_pdf
from redforge.schemas import BudgetCaps, Campaign
from redforge.swarm import CampaignEngine
from redforge.targets.adapter import demo_adapter

OUT = Path(__file__).resolve().parent.parent / "output" / "e2e"


async def main() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    db = OUT / "e2e.db"
    if db.exists():
        db.unlink()
    store = EvidenceStore(str(db))

    campaign = Campaign(
        id="C-E2E-DEMO", name="RedForge E2E demo campaign",
        targets=[demo_target()],
        packs=["PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"],
        rounds_max=3,
        caps=BudgetCaps(max_attempts=600, max_tokens=50_000_000, max_cost_usd=100.0),
    )
    engine = CampaignEngine()
    result = await engine.run_campaign(campaign, demo_adapter(), store=store)

    report = generate_report(
        findings=result.findings, verdicts=result.verdicts,
        scorecard=result.scorecard, campaign_id=campaign.id,
        target_name=campaign.targets[0].name)
    pdf_path = render_pdf(report, str(OUT / "report.pdf"))

    (OUT / "scorecard.json").write_text(json.dumps(result.scorecard, indent=2))
    (OUT / "report.json").write_text(json.dumps(
        {k: v for k, v in report.items() if k != "markdown"}, indent=2, default=str))
    (OUT / "report.md").write_text(report["markdown"])
    (OUT / "findings.json").write_text(
        json.dumps([f.model_dump(mode="json") for f in result.findings], indent=2))

    confirmed = sum(1 for f in result.findings if f.status.value == "Confirmed")
    packs_hit = sorted({f.technique_id.split("-")[0] for f in result.findings
                        if f.status.value == "Confirmed"})
    summary = {
        "campaign_id": campaign.id,
        "attempts": result.attempts,
        "rounds_executed": result.rounds_executed,
        "stopped_reason": result.stopped_reason,
        "findings_total": len(result.findings),
        "findings_confirmed": confirmed,
        "packs_confirmed": packs_hit,
        "score_total": result.scorecard["total"],
        "score_band": result.scorecard["band"],
        "evidence_counts": store.counts(),
        "artifacts": ["scorecard.json", "report.json", "report.md",
                      "report.pdf", "findings.json", "e2e.db"],
        "pdf_bytes": Path(pdf_path).stat().st_size,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
