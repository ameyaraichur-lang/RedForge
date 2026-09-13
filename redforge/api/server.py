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

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..operator.audit import AuditChainError, AuditStore
from ..operator.auth import (
    SESSION_COOKIE,
    OperatorPrincipal,
    authenticate_credentials,
    bootstrap_demo_session,
    create_session_response,
    resolve_principal,
)
from ..operator.parser import parse_natural_language
from ..operator.schemas import OperatorAction
from ..operator.confirm_store import ConfirmationStore
from ..operator.secrets import assert_secure_operator_config
from ..operator.service import OperatorService
from ..operator.voice import SttRequest, TtsRequest, get_voice_gateway

from ..catalog import PACKS, TECHNIQUES, TARGET_CATALOGUE, campaign_target, demo_target, world_manifest
from ..config import effective_judge_provider, effective_target_provider, settings
from ..evidence.store import EvidenceStore
from ..judge import get_judge
from ..judge.llm_judge import AstraLLMJudge, DemoLLMJudge, RealLLMJudge
from ..reporting import generate_report, render_pdf
from ..schemas import BudgetCaps, Campaign
from ..swarm import CampaignEngine
from ..swarm.runner import CampaignResult
from ..targets import get_target_adapter, target_adapter_kind
from ..version import api_version, release_codename

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "output" / "live"
OPERATOR_DB_PATH = Path(settings.operator_db)


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
        target_spec = campaign_target()
        adapter = get_target_adapter()
        live_provider = effective_target_provider()
        self.campaign = Campaign(
            id=f"C-LIVE-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            name=f"RedForge live campaign ({live_provider} target)",
            targets=[target_spec],
            packs=packs or list(PACKS),
            rounds_max=max(1, min(3, rounds)),
            caps=BudgetCaps(max_attempts=600, max_tokens=50_000_000, max_cost_usd=100.0),
        )
        self.started_at = datetime.now(timezone.utc).isoformat()
        engine = CampaignEngine(judge=get_judge())
        engine.on_event = self.publish

        async def _run() -> None:
            try:
                self.result = await engine.run_campaign(
                    self.campaign, adapter, store=self.store)
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
        judge_provider = effective_judge_provider()
        self.publish({"type": "campaign_start", "campaign_id": self.campaign.id,
                      "packs": self.campaign.packs, "rounds_max": self.campaign.rounds_max,
                      "target_id": target_spec.id, "target_provider": live_provider,
                      "judge_provider": judge_provider})
        return {"campaign_id": self.campaign.id, "packs": self.campaign.packs,
                "rounds_max": self.campaign.rounds_max,
                "target_id": target_spec.id, "target_provider": live_provider,
                "judge_provider": judge_provider}, 200

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

_confirm_store = ConfirmationStore(OPERATOR_DB_PATH)
_audit_store = AuditStore(OPERATOR_DB_PATH)


def _operator_service() -> OperatorService:
    return OperatorService(
        _audit_store,
        _confirm_store,
        live_status=live.status,
        live_start=live.start,
        live_abort=live.abort,
        live_gates=lambda: live.gates,
        live_findings=lambda: (
            [f.model_dump(mode="json") for f in live.store.live_findings]
            if live.store else []
        ),
        live_sign_gate=lambda gid, signer: _gates_sign_impl(gid, signer),
        live_report=lambda: _report_impl(),
        live_events=lambda: live.events,
    )


def _gates_sign_impl(gate_id: str, signer: str) -> dict:
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


def _report_impl() -> dict:
    md = OUTPUT_DIR / "report.md"
    pdf = OUTPUT_DIR / "report.pdf"
    if not md.exists():
        return {"ready": False}
    return {"ready": True, "markdown": md.read_text(encoding="utf-8"),
            "pdf_path": str(pdf), "pdf_bytes": pdf.stat().st_size if pdf.exists() else 0}


operator_svc = _operator_service()
voice_gw = get_voice_gateway()

app = FastAPI(
    title="RedForge Live API",
    version=api_version(),
    description=f"Release codename: {release_codename()}",
)
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


def _judge_mode() -> str:
    judge = get_judge()
    if isinstance(judge, AstraLLMJudge):
        return "astra"
    if isinstance(judge, RealLLMJudge):
        return "real-llm"
    return "demo-heuristic"


@app.on_event("startup")
def _operator_security_startup() -> None:
    assert_secure_operator_config()
    _confirm_store.cleanup_expired()


@app.get("/api/health")
def health() -> dict:
    audit_ok = _audit_store.chain_valid
    return {
        "ok": audit_ok,
        "target_provider": effective_target_provider(),
        "judge_provider": effective_judge_provider(),
        "target_adapter": target_adapter_kind(get_target_adapter()),
        "judge_mode": _judge_mode(),
        "running": live.running,
        "events": len(live.events),
        "operator_audit_chain_ok": audit_ok,
        "operator_audit_chain_error": _audit_store.chain_error,
    }


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
             "llm_judge": e.get("llm_judge"), "seq": e["seq"], "ts": e["ts"]}
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
    return [t.model_dump(mode="json") for t in [*TARGET_CATALOGUE, demo_target()]]


@app.get("/api/techniques")
def techniques() -> list[dict]:
    return [{"id": t.id, "pack": t.pack, "category": t.category, "name": t.name,
             "owasp_ref": t.owasp_ref, "gate_level": t.gate_level}
            for t in TECHNIQUES]


@app.get("/api/packs")
def packs() -> dict:
    return {k: v["name"] for k, v in PACKS.items()}


@app.get("/api/world/manifest")
def world_manifest_api() -> dict:
    """Authoritative Mission Control agent/DAG topology for the console."""
    return world_manifest().model_dump()


# ------------------------------------------------------------------ operator
class IntentBody(BaseModel):
    text: str
    source: str = "text"


class ActionBody(BaseModel):
    action: OperatorAction
    confirmation_token: str | None = None


@app.post("/api/operator/intent")
def operator_intent(
    body: IntentBody,
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> JSONResponse:
    parsed = parse_natural_language(body.text, source=body.source)
    if not parsed:
        return JSONResponse({"ok": False, "error": "no matching intent"}, status_code=422)
    return JSONResponse({
        "ok": True,
        "intent": parsed.model_dump(),
        "actor": principal.actor,
    })


@app.post("/api/operator/action")
async def operator_action(
    body: ActionBody,
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> JSONResponse:
    result = await operator_svc.execute(
        body.action,
        principal,
        confirmation_token=body.confirmation_token,
    )
    code = 200 if result.ok or result.requires_confirmation else 400
    return JSONResponse(result.model_dump(), status_code=code)


@app.get("/api/operator/plan")
def operator_plan(
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> dict:
    return operator_svc.build_plan().model_dump()


@app.get("/api/operator/audit")
def operator_audit(
    limit: int = 50,
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> JSONResponse:
    try:
        rows = [r.model_dump() for r in _audit_store.list_records(limit=min(limit, 200))]
    except AuditChainError as exc:
        return JSONResponse(
            {"error": "audit chain verification failed", "detail": str(exc)},
            status_code=503,
        )
    return JSONResponse(rows)


@app.post("/api/operator/voice/stt")
async def operator_voice_stt(
    body: SttRequest,
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> JSONResponse:
    if body.simulate_transcript and settings.operator_auth_mode == "secure":
        return JSONResponse({"error": "simulate_transcript forbidden in secure mode"}, status_code=403)
    resp = await voice_gw.transcribe(body)
    return JSONResponse(resp.model_dump())


@app.post("/api/operator/voice/tts")
async def operator_voice_tts(
    body: TtsRequest,
    principal: OperatorPrincipal = Depends(resolve_principal),
) -> JSONResponse:
    resp = await voice_gw.synthesize(body)
    return JSONResponse(resp.model_dump())


class LoginBody(BaseModel):
    username: str
    password: str


@app.get("/api/operator/config")
def operator_config() -> dict:
    """Public operator auth config (no secrets)."""
    return {
        "auth_mode": settings.operator_auth_mode,
        "demo_bootstrap": settings.operator_demo_bootstrap,
        "voice_mode": settings.operator_voice_mode,
        "session_ttl_minutes": settings.operator_session_ttl_minutes,
    }


@app.post("/api/operator/login")
def operator_login(body: LoginBody, response: Response) -> dict:
    principal = authenticate_credentials(body.username, body.password)
    return create_session_response(principal, response)


@app.post("/api/operator/logout")
def operator_logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.post("/api/operator/bootstrap")
def operator_bootstrap(response: Response) -> dict:
    """Demo-labeled operator session only — explicit demo mode + RF_OPERATOR_DEMO_BOOTSTRAP=1."""
    return bootstrap_demo_session(response)


@app.get("/api/operator/session")
def operator_session(request: Request) -> JSONResponse:
    """Session probe — always 200; never 401 (avoids startup poll noise in the console)."""
    try:
        p = resolve_principal(request)
    except HTTPException as exc:
        if exc.status_code in (401, 403):
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            return JSONResponse({"authenticated": False, "error": detail})
        raise
    body: dict = {
        "authenticated": True,
        "actor": p.actor,
        "role": p.role.value,
        "auth_mode": p.auth_mode,
    }
    if p.auth_mode == "demo-labeled":
        body["demo_labeled"] = True
        body["label"] = "DEMO ONLY — not enterprise authentication"
    return JSONResponse(body)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
