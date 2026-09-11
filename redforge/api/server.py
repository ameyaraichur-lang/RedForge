"""RedForge Live API — SSE event bus + campaign control for the Console (M6b).

One process drives everything: start/abort campaigns against the vulnerable demo
target, stream every swarm event to the UI (EventSource), serve live findings/
scorecard/gates, and generate the report + regulatory PDF at campaign end.
Run: python -m redforge.api  (127.0.0.1:8000)
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..catalog import PACKS, TECHNIQUES, TARGET_CATALOGUE, demo_target
from ..evidence.store import EvidenceStore
from ..reporting import generate_report, render_pdf
from ..schemas import BudgetCaps, Campaign
from ..swarm import CampaignEngine
from ..swarm.runner import CampaignResult
from ..targets.adapter import demo_adapter

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "output" / "live"


class LiveStore(EvidenceStore):
    """EvidenceStore that ALSO keeps in-memory live lists for the API."""

    def __init__(self) -> None:
        super().__init__(":memory:")
        self.live_findings: list[Any] = []
        self.live_gate_requests: list[Any] = []

    def record_finding(self, f: Any) -> None:  # noqa: D102
        self.live_findings = [x for x in self.live_findings if x.id != f.id]
        self.live_findings.append(f)
        super().record_finding(f)

    def record_gate_request(self, g: Any) -> None:  # noqa: D102
        self.live_gate_requests = [x for x in self.live_gate_requests if x.id != g.id]
        self.live_gate_requests.append(g)


class LiveCampaign:
    """Wraps one campaign task: event fan-out, briefings, live state."""

    def __init__(self) -> None:
        self.task: asyncio.Task | None = None
        self.campaign: Campaign | None = None
        self.result: CampaignResult | None = None
        self.store: LiveStore | None = None
        self.events: list[dict] = []
        self.briefings: list[dict] = []
        self.gates: list[dict] = []   # captured from gate events (engine keeps its own list)
        self.queues: set[asyncio.Queue] = set()
        self.error: str | None = None
        self.started_at: str | None = None
        self.ended_at: str | None = None
        self._verdict_count = 0
        self._success_count = 0
        self.seq = 0  # monotonic across campaign restarts (stream gate: seq > sent)

    # ---------------------------------------------------------------- state
    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def publish(self, event: dict) -> None:
        self.seq += 1
        wrapped = {"seq": self.seq,
                   "ts": datetime.now(timezone.utc).isoformat(), **event}
        self.events.append(wrapped)
        self._capture_gate(wrapped)
        self._maybe_brief(wrapped)
        for q in list(self.queues):
            q.put_nowait(wrapped)

    def _capture_gate(self, event: dict) -> None:
        """Gate requests live in engine state; rebuild them from gate events."""
        if event["type"] not in ("gate_approved", "gate_denied"):
            return
        gid = str(event.get("gate_request_id") or f"G-{len(self.gates)+1:03d}")
        tech = str(event.get("technique_id") or "?")
        for g in self.gates:
            if tech in g["technique_ids"]:
                return  # one row per technique (engine caches one request per technique)
        self.gates.append({
            "id": gid, "kind": "prod_attack", "technique_ids": [tech],
            "justification": f"gate level {event.get('gate_level', 'Sensitive')} · ROAI scope",
            "approvals": list(event.get("approvals") or []),
            "decided": True,
        })

    def _maybe_brief(self, event: dict) -> None:
        text: str | None = None
        t = event["type"]
        if t == "verdict":
            self._verdict_count += 1
            if event.get("combined") == "Success":
                self._success_count += 1
            if self._verdict_count % 10 == 0:
                text = (f"Progress: {self._verdict_count} verdicts, "
                        f"{self._success_count} successful hits.")
        elif t == "gate_approved":
            text = (f"Gatekeeper approved {event.get('technique_id')} "
                    f"({event.get('gate_level')}).")
        elif t == "gate_denied":
            text = f"Gate denied {event.get('technique_id')} — sandbox only."
        elif t == "mutation_stop":
            text = (f"Mutation stopped at round {event.get('round')} — "
                    f"diminishing returns cutoff reached.")
        elif t == "budget_exhausted":
            text = "Budget cap reached — campaign halted."
        elif t == "campaign_end":
            text = (f"Campaign complete: {event.get('attempts')} attempts, "
                    f"{event.get('findings')} findings recorded.")
        if text:
            self.briefings.append({"seq": len(self.events), "text": text, "ts": event["ts"]})

    # -------------------------------------------------------------- control
    async def start(self, packs: list[str] | None, rounds: int) -> tuple[dict, int]:
        if self.running:
            return {"error": "campaign already running"}, 409
        subscribers = self.queues  # keep live SSE streams attached across the reset
        seq = self.seq  # keep seq monotonic (stream gate drops e.seq <= sent)
        self.__init__()  # reset state
        self.queues = subscribers
        self.seq = seq
        self.store = LiveStore()
        self.campaign = Campaign(
            id=f"C-LIVE-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            name="RedForge live console campaign",
            targets=[demo_target()],
            packs=packs or list(PACKS),
            rounds_max=max(1, min(3, rounds)),
            caps=BudgetCaps(max_attempts=600, max_tokens=50_000_000, max_cost_usd=100.0),
        )
        self.started_at = datetime.now(timezone.utc).isoformat()
        engine = CampaignEngine()
        engine.on_event = self.publish

        async def _run() -> None:
            try:
                self.result = await engine.run_campaign(
                    self.campaign, demo_adapter(), store=self.store)
                self._finish()
            except asyncio.CancelledError:
                self.error = "aborted"
                self.ended_at = datetime.now(timezone.utc).isoformat()
                self.publish({"type": "campaign_end", "campaign_id": self.campaign.id,
                              "stopped_reason": "aborted", "attempts": 0,
                              "findings": len(self.store.live_findings)})
            except Exception as e:  # noqa: BLE001 — surface to UI, never crash server
                self.error = f"{type(e).__name__}: {e}"
                self.publish({"type": "campaign_error", "error": self.error})

        self.task = asyncio.create_task(_run())
        self.publish({"type": "campaign_start", "campaign_id": self.campaign.id,
                      "packs": self.campaign.packs, "rounds_max": self.campaign.rounds_max})
        return {"campaign_id": self.campaign.id, "packs": self.campaign.packs,
                "rounds_max": self.campaign.rounds_max}, 200

    def abort(self) -> dict:
        if self.running and self.task:
            self.task.cancel()
            return {"aborting": True}
        return {"aborting": False, "reason": "no campaign running"}

    def _finish(self) -> None:
        self.ended_at = datetime.now(timezone.utc).isoformat()
        if self.result is None or self.store is None:
            return
        try:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            report = generate_report(
                findings=self.result.findings, verdicts=self.result.verdicts,
                scorecard=self.result.scorecard, campaign_id=self.campaign.id,
                target_name=self.campaign.targets[0].name)
            (OUTPUT_DIR / "report.md").write_text(report["markdown"], encoding="utf-8")
            pdf = render_pdf(report, str(OUTPUT_DIR / "report.pdf"))
            self.publish({"type": "report_ready",
                          "markdown_path": str(OUTPUT_DIR / "report.md"),
                          "pdf_path": pdf, "pdf_bytes": Path(pdf).stat().st_size})
        except Exception as e:  # noqa: BLE001 — report failure must not kill stream
            self.publish({"type": "report_error", "error": str(e)})

    # --------------------------------------------------------------- status
    def status(self) -> dict:
        verdicts = [e for e in self.events if e["type"] == "verdict"]
        successes = [e for e in verdicts if e.get("combined") == "Success"]
        attempts_per_pack: dict[str, int] = {}
        for e in self.events:
            if e["type"] == "attempt":
                pack = str(e.get("tech_id", "?")).split("-")[0]
                attempts_per_pack[pack] = attempts_per_pack.get(pack, 0) + 1
        findings = self.store.live_findings if self.store else []
        confirmed_packs = sorted({f.technique_id.split("-")[0] for f in findings
                                  if f.status.value == "Confirmed"})
        return {
            "running": self.running,
            "campaign_id": self.campaign.id if self.campaign else None,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "stopped_reason": (self.result.stopped_reason if self.result
                               else ("aborted" if self.error == "aborted" else None)),
            "error": self.error,
            "events": len(self.events),
            "attempts": sum(attempts_per_pack.values()),
            "attempts_per_pack": attempts_per_pack,
            "verdicts": len(verdicts),
            "successes": len(successes),
            "findings_total": len(findings),
            "findings_confirmed": sum(1 for f in findings if f.status.value == "Confirmed"),
            "findings_voided": sum(1 for f in findings if f.status.value == "Voided"),
            "confirmed_packs": confirmed_packs,
            "scorecard": (self.result.scorecard if self.result
                          and isinstance(self.result.scorecard, dict) else None),
            "budget": ({"attempts": self.result.budget_usage.attempts,
                        "tokens": self.result.budget_usage.tokens,
                        "cost_usd": round(self.result.budget_usage.cost_usd, 4)}
                       if self.result else None),
            "rounds_executed": self.result.rounds_executed if self.result else None,
            "briefings": len(self.briefings),
        }


live = LiveCampaign()

app = FastAPI(title="RedForge Live API", version="1.0.0")
# NOTE: SSE is consumed cross-origin from the console (:3100; :3000 kept for the
# reference app) — Next rewrites buffer the streamed body for browsers, so the
# console's EventSource targets this origin directly (quirk Q-11).
app.add_middleware(CORSMiddleware, allow_origins=[
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3100", "http://127.0.0.1:3100"],
    allow_methods=["*"], allow_headers=["*"])


class StartBody(BaseModel):
    packs: list[str] | None = None
    rounds: int = 3


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "provider": "demo", "running": live.running,
            "events": len(live.events)}


@app.post("/api/campaign/start")
async def start_campaign(body: StartBody) -> JSONResponse:
    result, code = await live.start(body.packs, body.rounds)
    return JSONResponse(result, status_code=code)


@app.post("/api/campaign/abort")
def abort_campaign() -> dict:
    return live.abort()


@app.get("/api/campaign/status")
def campaign_status() -> dict:
    return live.status()


@app.get("/api/events")
async def events(since: int = 0) -> JSONResponse:
    """Historical events after seq `since` (replay scrubber source)."""
    return JSONResponse([e for e in live.events if e["seq"] > since])


@app.get("/api/events/stream")
async def events_stream():
    async def gen():
        q: asyncio.Queue = asyncio.Queue()
        sent = 0
        live.queues.add(q)
        try:
            for e in live.events:  # replay backlog first
                yield f"data: {json.dumps(e, default=str)}\n\n"
                sent = e["seq"]
            while True:
                try:
                    e = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if e["seq"] > sent:
                    yield f"data: {json.dumps(e, default=str)}\n\n"
                    sent = e["seq"]
        finally:
            live.queues.discard(q)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.get("/api/findings")
def findings_list() -> list[dict]:
    if not live.store:
        return []
    return [f.model_dump(mode="json") for f in
            sorted(live.store.live_findings, key=lambda f: f.id)]


@app.get("/api/verdicts")
def verdicts_list() -> list[dict]:
    return [{"attempt_id": e.get("attempt_id"), "tech_id": e.get("tech_id"),
             "combined": e.get("combined"), "escalated": e.get("escalated"),
             "seq": e["seq"], "ts": e["ts"]}
            for e in live.events if e["type"] == "verdict"]


@app.get("/api/gates")
def gates_list() -> list[dict]:
    return live.gates


@app.post("/api/gates/{gate_id}/sign")
def gates_sign(gate_id: str, signer: str = "console-operator") -> dict:
    for g in live.gates:
        if g["id"] == gate_id:
            if signer not in g["approvals"]:
                g["approvals"].append(signer)
            g["decided"] = len(g["approvals"]) >= 2
            live.publish({"type": "gate_signed", "gate_request_id": g["id"],
                          "signer": signer, "approvals": list(g["approvals"]),
                          "decided": g["decided"]})
            return g
    return {"error": "unknown gate"}


@app.get("/api/briefings")
def briefings() -> list[dict]:
    return live.briefings


@app.get("/api/report")
def report() -> dict:
    md = OUTPUT_DIR / "report.md"
    pdf = OUTPUT_DIR / "report.pdf"
    if not md.exists():
        return {"ready": False}
    return {"ready": True, "markdown": md.read_text(encoding="utf-8"),
            "pdf_path": str(pdf), "pdf_bytes": pdf.stat().st_size if pdf.exists() else 0}


@app.get("/api/targets")
def targets() -> list[dict]:
    return [t.model_dump(mode="json") for t in
            [*TARGET_CATALOGUE, demo_target()]]


@app.get("/api/techniques")
def techniques() -> list[dict]:
    return [{"id": t.id, "pack": t.pack, "category": t.category, "name": t.name,
             "owasp_ref": t.owasp_ref, "gate_level": t.gate_level}
            for t in TECHNIQUES]


@app.get("/api/packs")
def packs() -> dict:
    return {k: v["name"] for k, v in PACKS.items()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
