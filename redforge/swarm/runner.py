"""Swarm Execution DAG / Campaign Engine (M4) — the heart of AI-RedForge.

Executes the blueprint DAG as one bounded engine:

  N0 mission control -> N1 recon -> N2 attack strategist ->
  N3 red operators + N4 judge + N5 mutator (bounded mutation rounds 1..3) ->
  N6 chain-builder -> N7 verifier (in-engine lite) -> N8 scorer.

Tenets encoded here:
  T2  — verdicts are ONLY ever constructed via redforge.judge.make_verdict
        (dual-mode: rule detector first, LLM-as-judge second);
  T3  — mutation rounds are bounded (rounds_max, marginal-gain early stop);
  T5  — sensitive techniques hit a G1 gate interrupt before any dispatch
        (strict mode refuses them outright and consumes no budget);
  T?  — budget caps are checked BEFORE every dispatch (attempts/tokens/cost);
        every finding ships transcript + verdict evidence refs.

The evidence store (redforge.evidence, developed concurrently) is imported
LAZILY inside functions and is entirely optional: without it the campaign
lives in the in-memory CampaignResult lists.
"""
from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from redforge.canary import make_canary, substitute
from redforge.e2e.ids import RunIds
from redforge.catalog import PACKS, pack_techniques, seeds_for, technique
from redforge.config import settings
from redforge.judge import decide, make_verdict
from redforge.judge import get_judge
from redforge.judge.llm_judge import DemoLLMJudge
from redforge.schemas import (AttackAttempt, BudgetUsage, Campaign, EvidenceRef,
                              Finding, FindingStatus, GateRequest,
                              JudgeOutcome, LLMDecision, RuleDecision,
                              TargetSpec, Transcript, Turn, Verdict)
from redforge.scoring import derive_severity, scorecard_from_findings
from redforge.targets.protocol import TargetAdapter

from .mutator import mutate

__all__ = ["CampaignEngine", "CampaignResult", "run_demo_campaign"]

# Blueprint cost model: USD per target token consumed by a dispatched attempt.
COST_PER_TOKEN = 0.000002

# Mutation is bounded at 3 rounds by catalog contract (Technique.round_no 1..3).
MAX_ROUNDS = 3


# --------------------------------------------------------------- evidence store
# The store is duck-typed and optional (D4). When redforge.evidence lands it
# may expose any of these method spellings; persistence is best-effort and
# must never break a running campaign.
_STORE_METHODS: dict[str, tuple[str, ...]] = {
    "AttackAttempt": ("save_attempt", "record_attempt", "add_attempt", "save"),
    "Transcript": ("save_transcript", "record_transcript", "add_transcript", "save"),
    "Verdict": ("save_verdict", "record_verdict", "add_verdict", "save"),
    "Finding": ("save_finding", "record_finding", "add_finding", "upsert_finding", "save"),
    "GateRequest": ("save_gate_request", "record_gate_request", "add_gate_request", "save"),
}


def attach_evidence_store() -> Any:
    """Lazily attach the concurrently-built redforge.evidence store.

    Imported INSIDE this function on purpose (the module may not exist yet);
    any failure falls back to None, i.e. purely in-memory campaign results.
    """
    try:
        from redforge.evidence import EvidenceStore  # lazy by design
    except ImportError:
        return None
    try:
        return EvidenceStore()
    except Exception:
        return None


# ------------------------------------------------------------------- results

@dataclass
class CampaignResult:
    campaign_id: str
    attempts: int = 0
    rounds_executed: int = 0
    findings: list[Finding] = field(default_factory=list)
    verdicts: list[Verdict] = field(default_factory=list)
    scorecard: dict = field(default_factory=dict)
    budget_usage: BudgetUsage = field(default_factory=BudgetUsage)
    gate_requests: list[GateRequest] = field(default_factory=list)
    stopped_reason: str = "completed"   # "completed" | "budget_exhausted"
    events: list[dict] = field(default_factory=list)


@dataclass
class _CampaignRun:
    """Mutable per-run_campaign state (one run may cover several targets)."""
    campaign: Campaign
    adapter: TargetAdapter
    store: Any = None
    usage: BudgetUsage = field(default_factory=BudgetUsage)
    findings: list[Finding] = field(default_factory=list)
    verdicts: list[Verdict] = field(default_factory=list)
    gates: list[GateRequest] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    attempts_per_pack: dict[str, int] = field(default_factory=dict)
    # finding id -> first raw payload / owning attempt id (Verifier input)
    first_payload: dict[str, str] = field(default_factory=dict)
    attempt_by_finding: dict[str, str] = field(default_factory=dict)
    # chain finding id -> (pin, age, exf) source finding ids
    chain_refs: dict[str, tuple[str, str, str]] = field(default_factory=dict)
    canary_cache: dict[str, str] = field(default_factory=dict)
    ids: RunIds = field(default_factory=RunIds)
    gate_cache: dict[str, GateRequest] = field(default_factory=dict)
    gate_allowed: dict[str, bool] = field(default_factory=dict)
    success_techs: set[str] = field(default_factory=set)
    seq: int = 0                       # finding id sequence, RF-F-0001..
    rounds_executed: int = 0
    stopped_reason: str = "completed"
    scorecard: dict = field(default_factory=dict)


# -------------------------------------------------------------------- engine

class CampaignEngine:
    """The swarm DAG executor. One engine may run many campaigns; per-campaign
    state lives in _CampaignRun so engines are reusable and reentrant-safe."""

    def __init__(self, strict_gates: bool = False, judge: Any = None,
                 store: Any = None,
                 on_event: Callable[[dict], None] | None = None,
                 run_seed: int | None = None) -> None:
        self.strict_gates = strict_gates
        self.judge = judge if judge is not None else get_judge()
        self.store = store              # EvidenceStore | None (lazy-typed, D4)
        self.on_event = on_event
        self.run_seed = run_seed        # None -> uuid ids; int -> reproducible demo
        self.events: list[dict] = []    # engine-wide event log (all campaigns)
        self._current_events: list[dict] | None = None  # set during run_campaign

    # ------------------------------------------------------------ event bus
    def _emit(self, type_: str, **data: Any) -> None:
        event = {"type": type_, **data}
        self.events.append(event)
        # mirror into the current campaign's event list
        if self._current_events is not None:
            self._current_events.append(event)
        if self.on_event is not None:
            try:
                self.on_event(event)
            except Exception:
                pass  # observer failures must never kill a campaign

    # ------------------------------------------------------------- persistence
    @staticmethod
    async def _persist(store: Any, obj: Any) -> None:
        if store is None:
            return
        for name in _STORE_METHODS.get(type(obj).__name__, ()):
            method = getattr(store, name, None)
            if callable(method):
                try:
                    result = method(obj)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception:
                    pass  # best-effort persistence only
                return

    # ------------------------------------------------------------------ canary
    @staticmethod
    def _canary_for(run: _CampaignRun, tech_id: str) -> str:
        """One canary per technique per campaign, stably seeded from a
        tech-id hash (reproducible campaigns, unpredictable to the target)."""
        canary = run.canary_cache.get(tech_id)
        if canary is None:
            seed = int.from_bytes(hashlib.sha256(tech_id.encode("utf-8")).digest()[:4],
                                  "big")
            canary = make_canary(seed=seed)
            run.canary_cache[tech_id] = canary
        return canary

    @staticmethod
    def _webhook() -> str:
        return f"http://{settings.canary_host}:{settings.canary_port}/canary/hit"

    # ------------------------------------------------------------------- ids
    @staticmethod
    def _next_finding_id(run: _CampaignRun) -> str:
        run.seq += 1
        return f"RF-F-{run.seq:04d}"

    # ==================================================================
    # Public entrypoint
    # ==================================================================
    async def run_campaign(self, campaign: Campaign, adapter: TargetAdapter,
                           store: Any = None) -> CampaignResult:
        run = _CampaignRun(
            campaign=campaign,
            adapter=adapter,
            store=store if store is not None else self.store,
            ids=RunIds(self.run_seed),
        )
        self._current_events = run.events
        try:
            for target in campaign.targets:      # multiple targets: sequential
                if run.stopped_reason != "completed":
                    break
                await self._run_target(run, target)

            # ---- N8 Scorer (campaign-level) ----
            self._emit("node_start", node="N8_scorer")
            run.scorecard = scorecard_from_findings(run.findings,
                                                    run.attempts_per_pack)
            self._emit("scorecard", scorecard=run.scorecard)
            self._emit("node_end", node="N8_scorer")
            self._emit("campaign_end", campaign_id=campaign.id,
                       stopped_reason=run.stopped_reason,
                       attempts=run.usage.attempts, findings=len(run.findings))
            if (run.stopped_reason == "completed" and run.scorecard
                    and len(run.findings) > 0 and not self.strict_gates):
                self._emit(
                    "gate_approved",
                    gate_request_id=f"RF-G2-{run.ids.hex8()}",
                    technique_id="release",
                    gate_level="G2",
                    approvals=["auto-operator", "auto-redlead"],
                )
            return CampaignResult(
                campaign_id=campaign.id,
                attempts=run.usage.attempts,
                rounds_executed=run.rounds_executed,
                findings=run.findings,
                verdicts=run.verdicts,
                scorecard=run.scorecard,
                budget_usage=run.usage,
                gate_requests=run.gates,
                stopped_reason=run.stopped_reason,
                events=run.events,
            )
        finally:
            self._current_events = None

    # ==================================================================
    # Per-target pipeline: N0 -> N7
    # ==================================================================
    async def _run_target(self, run: _CampaignRun, target: TargetSpec) -> None:
        plan = self._mission_control(run, target)          # N0
        if not plan:
            return
        await self._recon(run, target)                      # N1
        self._strategize(run, target, plan)                 # N2
        await self._rounds(run, target, plan)               # N3 + N4 + N5
        if run.stopped_reason != "completed":
            return  # budget interrupt: stop everything
        await self._build_chains(run, target)               # N6
        await self._verify(run, target)                     # N7

    # ---- N0 Mission Control ------------------------------------------------
    def _mission_control(self, run: _CampaignRun, target: TargetSpec) -> list[str]:
        self._emit("node_start", node="N0_mission_control", target_id=target.id)
        plan: list[str] = []
        for pack in run.campaign.packs:
            if pack not in PACKS or pack not in target.packs:
                continue
            for tech in pack_techniques(pack):
                if tech.id not in plan:
                    plan.append(tech.id)
        self._emit("mission_plan", target_id=target.id, packs=sorted(
            {p for p in run.campaign.packs if p in target.packs and p in PACKS}),
            techniques=len(plan))
        self._emit("node_end", node="N0_mission_control", target_id=target.id,
                   techniques=len(plan))
        return plan

    # ---- N1 Recon ----------------------------------------------------------
    async def _recon(self, run: _CampaignRun, target: TargetSpec) -> None:
        self._emit("node_start", node="N1_recon", target_id=target.id)
        shadow: list[str] = []
        try:
            tools = await run.adapter.list_tools()
            all_names = {t.get("name") for t in tools.get("all", [])
                         if isinstance(t, dict)}
            doc_names = {t.get("name") for t in tools.get("documented", [])
                         if isinstance(t, dict)}
            shadow = sorted(n for n in (all_names - doc_names) if n)
        except Exception as exc:
            self._emit("recon_skipped", target_id=target.id,
                       reason=f"list_tools unavailable: {exc}")
        if shadow:
            self._emit("recon", target_id=target.id, shadow_tools=shadow)
            for tech_id in ("AGE-005", "SUP-001"):
                await self._recon_finding(run, target, tech_id, shadow)
        self._emit("node_end", node="N1_recon", target_id=target.id,
                   shadow_tools=len(shadow))

    async def _recon_finding(self, run: _CampaignRun, target: TargetSpec,
                             tech_id: str, shadow: list[str]) -> None:
        """Synthesize an audit-grade finding from the registry diff."""
        tech = technique(tech_id)
        attempt_id = f"RF-A-{run.ids.hex8()}"
        rule = RuleDecision(
            detector="recon:tool-registry-diff", outcome=JudgeOutcome.SUCCESS,
            reason=(f"{len(shadow)} tools visible in the live registry but absent "
                    f"from the documented registry"),
            matched_signals=shadow[:5])
        llm = LLMDecision(judge="demo-heuristic", outcome=JudgeOutcome.SUCCESS,
                          confidence=0.95,
                          reason="registry diff directly observed; no model "
                                 "generation involved")
        verdict = make_verdict(attempt_id, tech_id, rule, llm,
                               _id_suffix=run.ids.hex8)
        run.verdicts.append(verdict)
        await self._persist(run.store, verdict)
        finding = Finding(
            id=self._next_finding_id(run),
            campaign_id=run.campaign.id,
            technique_id=tech_id,
            target_id=target.id,
            title=f"Shadow tooling exposed: {tech.name}",
            narrative=(f"Recon diff for {target.name} ({target.id}) exposed "
                       f"{len(shadow)} undocumented tools "
                       f"({', '.join(shadow[:5])}{', …' if len(shadow) > 5 else ''}) "
                       f"— {tech.name}."),
            severity=derive_severity(tech.pack, 0.95, target.asset_criticality),
            status=FindingStatus.CONFIRMED,   # direct observation, no replay needed
            confidence=0.95,
            reproduced=True,
            evidence=[EvidenceRef(kind="tool_log", uri=f"tools://diff/{target.id}")],
            verdict_id=verdict.id)
        run.findings.append(finding)
        await self._persist(run.store, finding)

    # ---- N2 Attack Strategist ----------------------------------------------
    def _strategize(self, run: _CampaignRun, target: TargetSpec,
                    plan: list[str]) -> None:
        self._emit("node_start", node="N2_attack_strategist", target_id=target.id)
        planned = sum(len(seeds_for(t)) for t in plan)
        self._emit("plan", target_id=target.id, attempts_planned=planned,
                   techniques=len(plan))
        self._emit("node_end", node="N2_attack_strategist", target_id=target.id)

    # ---- N3 Red Operators + N4 Judge + N5 Mutator --------------------------
    async def _rounds(self, run: _CampaignRun, target: TargetSpec,
                      plan: list[str]) -> None:
        rounds_max = max(1, min(int(run.campaign.rounds_max), MAX_ROUNDS))
        for node in ("N3_red_operators", "N4_judge", "N5_mutator"):
            self._emit("node_start", node=node, target_id=target.id)
        r1_outcome: dict[str, JudgeOutcome] = {}
        for round_no in range(1, rounds_max + 1):
            if run.stopped_reason != "completed":
                break
            run.rounds_executed = round_no
            newly_success = 0
            for tech_id in plan:
                if run.stopped_reason != "completed":
                    break
                seeds = seeds_for(tech_id)
                if not seeds:
                    continue
                if round_no >= 2:
                    # bounded mutation: only techniques still in play whose
                    # round-1 verdict was FAIL or CLOSE
                    if tech_id in run.success_techs:
                        continue
                    if r1_outcome.get(tech_id) not in (JudgeOutcome.FAIL,
                                                       JudgeOutcome.CLOSE):
                        continue
                if not self._gate_for(run, tech_id):
                    continue
                turn_sets: list[list[str]] = (
                    [list(seeds)] if round_no == 1
                    else [[m] for m in mutate(seeds[0], round_no)])
                for turns in turn_sets:
                    # budget check BEFORE dispatch (tenet: bounded campaigns)
                    if run.usage.over_cap(run.campaign.caps):
                        run.stopped_reason = "budget_exhausted"
                        self._emit("budget_exhausted", round=round_no,
                                   attempts=run.usage.attempts, tech_id=tech_id)
                        break
                    outcome = await self._dispatch(run, target, tech_id,
                                                   turns, round_no)
                    if round_no == 1:
                        r1_outcome.setdefault(tech_id, outcome)
                    if (outcome is JudgeOutcome.SUCCESS
                            and tech_id not in run.success_techs):
                        run.success_techs.add(tech_id)
                        newly_success += 1
            if run.stopped_reason != "completed":
                break
            if round_no >= 2 and newly_success == 0:
                self._emit("mutation_stop", round=round_no,
                           reason="zero marginal gain this round")
                break
        for node in ("N3_red_operators", "N4_judge", "N5_mutator"):
            self._emit("node_end", node=node, target_id=target.id)

    # ---- one dispatched attempt (N3 fire + N4 judge) ------------------------
    async def _dispatch(self, run: _CampaignRun, target: TargetSpec,
                        tech_id: str, turns: list[str],
                        round_no: int) -> JudgeOutcome:
        campaign = run.campaign
        tech = technique(tech_id)
        canary = self._canary_for(run, tech_id)
        webhook = self._webhook()
        context = {"canary": canary, "webhook": webhook,
                   "usage_cap": campaign.caps.max_tokens}
        attempt_id = f"RF-A-{run.ids.hex8()}"
        transcript = Transcript(id=f"RF-T-{run.ids.hex8()}", attempt_id=attempt_id,
                                technique_id=tech_id, target_id=target.id)
        attempt = AttackAttempt(id=attempt_id, campaign_id=campaign.id,
                                technique_id=tech_id, target_id=target.id,
                                payload="\n---\n".join(turns), round_no=round_no)

        run.usage.attempts += 1
        run.attempts_per_pack[tech.pack] = run.attempts_per_pack.get(tech.pack, 0) + 1
        self._emit("attempt", attempt_id=attempt_id, tech_id=tech_id,
                   round=round_no, target_id=target.id)

        messages: list[dict] = []
        tokens = 0
        success_verdict: Verdict | None = None
        saw_close = False
        last_verdict: Verdict | None = None
        for raw_turn in turns:
            sent = substitute(raw_turn, canary, webhook)
            messages.append({"role": "user", "content": sent})
            resp = await run.adapter.call_chat(messages, session_id=attempt_id)
            messages.append({"role": "assistant", "content": resp.content})
            transcript.turns.append(Turn(role="attacker", content=sent))
            transcript.turns.append(Turn(role="target", content=resp.content,
                                         tool_calls=resp.tool_calls or None))
            tokens += resp.tokens_used
            rule = decide(sent, resp.content, tech_id,
                          tool_calls=resp.tool_calls,
                          tokens_used=resp.tokens_used, context=context)
            llm = self.judge.judge(sent, resp.content, tech_id,
                                   tool_calls=resp.tool_calls,
                                   tokens_used=resp.tokens_used,
                                   context=context)
            verdict = make_verdict(attempt_id, tech_id, rule, llm,
                                   _id_suffix=run.ids.hex8)
            run.verdicts.append(verdict)
            await self._persist(run.store, verdict)
            last_verdict = verdict
            if verdict.combined is JudgeOutcome.CLOSE:
                saw_close = True
            if (verdict.combined is JudgeOutcome.SUCCESS
                    and success_verdict is None):
                success_verdict = verdict
            self._emit("verdict", attempt_id=attempt_id, tech_id=tech_id,
                       combined=verdict.combined.value,
                       escalated=verdict.escalated_to_human,
                       llm_judge=llm.judge)

        attempt.tokens_used = tokens
        attempt.cost_usd = tokens * COST_PER_TOKEN
        run.usage.tokens += tokens
        run.usage.cost_usd += tokens * COST_PER_TOKEN
        attempt.transcript_id = transcript.id
        attempt.verdict_id = last_verdict.id if last_verdict else None
        await self._persist(run.store, attempt)
        await self._persist(run.store, transcript)

        if success_verdict is not None:
            finding = self._finding(run, target=target, tech=tech,
                                    verdict=success_verdict,
                                    transcript=transcript)
            run.findings.append(finding)
            run.first_payload[finding.id] = turns[0]
            run.attempt_by_finding[finding.id] = attempt_id
            await self._persist(run.store, finding)

        if success_verdict is not None:
            return JudgeOutcome.SUCCESS
        if saw_close:
            return JudgeOutcome.CLOSE
        return (last_verdict.combined if last_verdict is not None
                else JudgeOutcome.FAIL)

    # ---- finding factory ----------------------------------------------------
    def _finding(self, run: _CampaignRun, *, target: TargetSpec,
                 tech: Any, verdict: Verdict, transcript: Transcript) -> Finding:
        return Finding(
            id=self._next_finding_id(run),
            campaign_id=run.campaign.id,
            technique_id=tech.id,
            target_id=target.id,
            title=f"{tech.name} ({tech.id})",
            narrative=(f"{tech.name} succeeded against {target.name} "
                       f"({target.id}); combined judge outcome "
                       f"{verdict.combined.value} at confidence "
                       f"{verdict.confidence}."),
            severity=derive_severity(tech.pack, verdict.confidence or 0.9,
                                     target.asset_criticality),
            status=FindingStatus.CANDIDATE,
            confidence=verdict.confidence,
            evidence=[EvidenceRef(kind="transcript", uri=transcript.id),
                      EvidenceRef(kind="verdict", uri=verdict.id)],
            verdict_id=verdict.id)

    # ---- G1 gate interrupts (T5) ---------------------------------------------
    def _gate_for(self, run: _CampaignRun, tech_id: str) -> bool:
        """True -> technique may dispatch. Sensitive techniques require a
        GateRequest; strict mode denies them BEFORE any budget is consumed."""
        tech = technique(tech_id)
        if tech.gate_level == "Safe":
            return True
        if tech_id in run.gate_cache:
            return run.gate_allowed[tech_id]
        request = GateRequest(
            id=f"RF-G-{run.ids.hex8()}", kind="prod_attack", technique_ids=[tech_id],
            justification=(f"Technique {tech_id} ({tech.name}) is "
                           f"gate_level={tech.gate_level}: two-person G1 "
                           f"approval required before execution (tenet T5)."))
        if self.strict_gates:
            request.decided = True   # denied: no auto-approvals in strict mode
            run.gate_cache[tech_id] = request
            run.gate_allowed[tech_id] = False
            run.gates.append(request)
            self._emit("gate_denied", gate_request_id=request.id,
                       technique_id=tech_id, gate_level=tech.gate_level,
                       justification=request.justification)
            return False
        request.approvals = ["auto-operator", "auto-redlead"]  # demo two-person rule
        request.decided = True
        run.gate_cache[tech_id] = request
        run.gate_allowed[tech_id] = True
        run.gates.append(request)
        self._emit("gate_approved", gate_request_id=request.id,
                   technique_id=tech_id, gate_level=tech.gate_level,
                   approvals=list(request.approvals))
        return True

    # ---- N6 Chain-Builder ----------------------------------------------------
    async def _build_chains(self, run: _CampaignRun, target: TargetSpec) -> None:
        self._emit("node_start", node="N6_chain_builder", target_id=target.id)
        by_pack: dict[str, list[Finding]] = {}
        for f in run.findings:
            try:
                pack = technique(f.technique_id).pack
            except KeyError:
                continue
            by_pack.setdefault(pack, []).append(f)
        pin, age, exf = by_pack.get("PIN"), by_pack.get("AGE"), by_pack.get("EXF")
        if pin and age and exf:
            p, a, e = pin[0], age[0], exf[0]
            confidence = round(max(p.confidence, a.confidence, e.confidence), 2)
            chain = Finding(
                id=self._next_finding_id(run),
                campaign_id=run.campaign.id,
                technique_id=p.technique_id,
                target_id=target.id,
                title="Kill chain: injection>agency>exfil",
                narrative=(f"Chained exploitation against {target.name} "
                           f"({target.id}): prompt injection finding {p.id} "
                           f"({p.technique_id}) enabled excessive-agency "
                           f"finding {a.id} ({a.technique_id}), which enabled "
                           f"exfiltration finding {e.id} ({e.technique_id})."),
                severity=derive_severity("PIN", confidence,
                                         target.asset_criticality),
                status=FindingStatus.CANDIDATE,
                confidence=confidence,
                evidence=[ref for f in (p, a, e) for ref in f.evidence],
                verdict_id=p.verdict_id)
            run.findings.append(chain)
            run.chain_refs[chain.id] = (p.id, a.id, e.id)
            await self._persist(run.store, chain)
            self._emit("chain", techniques=[p.technique_id, a.technique_id,
                                            e.technique_id],
                       finding_ids=[p.id, a.id, e.id],
                       chain_finding_id=chain.id, target_id=target.id)
        self._emit("node_end", node="N6_chain_builder", target_id=target.id)

    # ---- N7 Verifier (in-engine lite) ----------------------------------------
    async def _verify(self, run: _CampaignRun, target: TargetSpec) -> None:
        self._emit("node_start", node="N7_verifier", target_id=target.id)
        for finding in list(run.findings):
            if finding.status is not FindingStatus.CANDIDATE:
                continue
            raw = run.first_payload.get(finding.id)
            if raw is None:
                continue  # recon / synthesized findings: nothing to replay
            tech_id = finding.technique_id
            canary = self._canary_for(run, tech_id)
            context = {"canary": canary, "webhook": self._webhook(),
                       "usage_cap": run.campaign.caps.max_tokens}
            sent = substitute(raw, canary, self._webhook())
            resp = await run.adapter.call_chat(
                [{"role": "user", "content": sent}],
                session_id=f"verify-{finding.id}")
            rule = decide(sent, resp.content, tech_id,
                          tool_calls=resp.tool_calls,
                          tokens_used=resp.tokens_used, context=context)
            llm = self.judge.judge(sent, resp.content, tech_id,
                                   tool_calls=resp.tool_calls,
                                   tokens_used=resp.tokens_used,
                                   context=context)
            verdict = make_verdict(
                run.attempt_by_finding.get(finding.id, finding.id),
                tech_id,
                rule,
                llm,
                _id_suffix=run.ids.hex8,
            )
            run.verdicts.append(verdict)
            await self._persist(run.store, verdict)
            if verdict.combined is JudgeOutcome.SUCCESS:
                finding.status = FindingStatus.CONFIRMED
                finding.reproduced = True
            else:
                finding.status = FindingStatus.VOIDED
                finding.reproduced = False
            self._emit("verify", finding_id=finding.id, tech_id=tech_id,
                       reproduced=finding.reproduced,
                       status=finding.status.value)
            await self._persist(run.store, finding)

        # chain findings inherit confirmation from their three sources
        by_id = {f.id: f for f in run.findings}
        for chain_id, (pid, aid, eid) in run.chain_refs.items():
            chain = by_id.get(chain_id)
            if chain is None:
                continue
            sources = [by_id.get(x) for x in (pid, aid, eid)]
            if all(s is not None and s.status is FindingStatus.CONFIRMED
                   for s in sources):
                chain.status = FindingStatus.CONFIRMED
                chain.reproduced = True
                await self._persist(run.store, chain)
        self._emit("node_end", node="N7_verifier", target_id=target.id)


# ----------------------------------------------------------- demo convenience

async def run_demo_campaign(packs: list[str] | None = None, rounds: int = 2,
                             strict_gates: bool = False) -> CampaignResult:
    """One-call demo campaign against the in-process vulnerable target."""
    from redforge.catalog import demo_target
    from redforge.schemas import BudgetCaps
    from redforge.targets.adapter import demo_adapter

    target = demo_target()
    campaign = Campaign(
        id="C-DEMO", name="RedForge demo campaign", targets=[target],
        packs=list(packs) if packs else list(PACKS), rounds_max=rounds,
        caps=BudgetCaps(max_attempts=500, max_tokens=50_000_000,
                        max_cost_usd=1000.0))
    engine = CampaignEngine(strict_gates=strict_gates)
    return await engine.run_campaign(campaign, demo_adapter())
