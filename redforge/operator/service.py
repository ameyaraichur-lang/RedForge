"""Operator action service — single routing path for voice and text."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import ValidationError

from .audit import AuditStore
from .auth import OperatorPrincipal, role_at_least, session_secret
from .confirm_store import ConfirmationStore
from .sessions import issue_confirmation_token, verify_token
from redforge.schemas.campaign import TargetRequest

from .policy import evaluate_policy
from .schemas import (
    ALLOWED_ACTIONS,
    CONFIRMATION_REQUIRED,
    ROLE_REQUIREMENTS,
    ActionKind,
    ActionResult,
    AuditDecision,
    ConfirmationRequest,
    InspectFindingParams,
    NavigateParams,
    OperatorAction,
    OperatorPlan,
    OperatorRole,
    ReviewGateParams,
    SignGateParams,
    StartCampaignParams,
)

class OperatorService:
    def __init__(
        self,
        audit: AuditStore,
        confirm_store: ConfirmationStore,
        *,
        live_status: Callable[[], dict],
        live_start: Callable[[list[str] | None, int, TargetRequest | None], Any],
        live_abort: Callable[[], dict],
        live_gates: Callable[[], list[dict]],
        live_findings: Callable[[], list[dict]],
        live_sign_gate: Callable[[str, str], dict],
        live_report: Callable[[], dict],
        live_events: Callable[[], list[dict]],
    ) -> None:
        self.audit = audit
        self.confirm_store = confirm_store
        self._live_status = live_status
        self._live_start = live_start
        self._live_abort = live_abort
        self._live_gates = live_gates
        self._live_findings = live_findings
        self._live_sign_gate = live_sign_gate
        self._live_report = live_report
        self._live_events = live_events

    def build_plan(self) -> OperatorPlan:
        st = self._live_status()
        events = self._live_events()
        gates = self._live_gates()
        pending_gates = [g for g in gates if not g.get("decided")]
        current = "idle"
        if st.get("running"):
            current = "campaign_running"
            for e in reversed(events):
                if e.get("type") == "node_start" and e.get("node"):
                    current = f"node:{e['node']}"
                    break
        elif st.get("stopped_reason"):
            current = f"ended:{st['stopped_reason']}"

        blockers: list[str] = []
        if pending_gates:
            blockers.append(f"{len(pending_gates)} gate(s) awaiting review")
        if st.get("error"):
            blockers.append(str(st["error"]))

        steps = [
            "recon → attack plan",
            "red operators dispatch",
            "judge verdicts",
            "gatekeeper review",
            "chain builder",
            "verifier + scorer",
            "dossier handoff",
        ]
        next_action = "start bounded campaign" if not st.get("running") else "monitor progress"
        if pending_gates:
            next_action = f"review gate {pending_gates[0].get('id')}"

        return OperatorPlan(
            campaign_id=st.get("campaign_id"),
            running=bool(st.get("running")),
            current_step=current,
            plan_steps=steps,
            evidence_count=int(st.get("findings_total") or 0),
            blockers=blockers,
            next_action=next_action,
            findings_total=int(st.get("findings_total") or 0),
            gates_pending=len(pending_gates),
        )

    def _validate_params(self, action: OperatorAction) -> dict[str, Any]:
        kind = action.kind
        p = action.params
        if kind == ActionKind.NAVIGATE:
            return NavigateParams.model_validate(p).model_dump()
        if kind == ActionKind.START_CAMPAIGN:
            return StartCampaignParams.model_validate(p).model_dump()
        if kind == ActionKind.INSPECT_FINDING:
            return InspectFindingParams.model_validate(p).model_dump()
        if kind == ActionKind.REVIEW_GATE:
            return ReviewGateParams.model_validate(p).model_dump()
        if kind == ActionKind.SIGN_GATE:
            return SignGateParams.model_validate(p).model_dump()
        return p

    def _issue_confirmation(
        self,
        action: OperatorAction,
        summary: str,
        principal: OperatorPrincipal,
    ) -> ConfirmationRequest:
        token = issue_confirmation_token(
            secret=session_secret(),
            actor=principal.actor,
            fingerprint=action.fingerprint(),
            action=action.model_dump(),
            summary=summary,
            ttl_seconds=300,
        )
        payload = verify_token(token, session_secret()) or {}
        exp = payload.get("exp", 0)
        return ConfirmationRequest(
            token=token,
            action=action,
            expires_at=datetime.fromtimestamp(int(exp), tz=timezone.utc).isoformat(),
            summary=summary,
        )

    async def execute(
        self,
        action: OperatorAction,
        principal: OperatorPrincipal,
        *,
        confirmation_token: str | None = None,
    ) -> ActionResult:
        corr = action.correlation_id or f"corr-{uuid.uuid4().hex[:10]}"
        action.correlation_id = corr

        if action.kind not in ALLOWED_ACTIONS:
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.DENIED,
                result_summary="action not allowlisted",
                correlation_id=corr,
                idempotency_key=action.idempotency_key,
            )
            return ActionResult(
                ok=False,
                kind=action.kind,
                message="Action not allowlisted",
                correlation_id=corr,
            )

        need = ROLE_REQUIREMENTS[action.kind]
        if not role_at_least(principal.role, need):
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.DENIED,
                result_summary=f"requires role {need.value}",
                correlation_id=corr,
            )
            return ActionResult(
                ok=False,
                kind=action.kind,
                message=f"Requires {need.value} role",
                correlation_id=corr,
            )

        policy = evaluate_policy(principal, action)
        if not policy.allowed:
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.DENIED,
                result_summary=policy.reason,
                correlation_id=corr,
            )
            return ActionResult(ok=False, kind=action.kind, message=policy.reason, correlation_id=corr)

        if action.idempotency_key:
            prior = self.audit.find_idempotency(action.idempotency_key)
            if prior:
                return ActionResult(
                    ok=True,
                    kind=action.kind,
                    message=f"Idempotent replay: {prior.result_summary}",
                    correlation_id=prior.correlation_id,
                )

        try:
            params = self._validate_params(action)
        except ValidationError as e:
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.FAILED,
                result_summary=str(e.errors()[0]["msg"]),
                correlation_id=corr,
            )
            return ActionResult(ok=False, kind=action.kind, message="Invalid parameters", correlation_id=corr)

        if action.kind in CONFIRMATION_REQUIRED and not confirmation_token:
            summaries = {
                ActionKind.START_CAMPAIGN: "Start bounded campaign (consumes budget)",
                ActionKind.ABORT_CAMPAIGN: "Abort running campaign (destructive)",
                ActionKind.SIGN_GATE: "Sign gate approval (authorization)",
                ActionKind.GENERATE_DOSSIER: "Generate regulatory dossier",
            }
            conf = self._issue_confirmation(action, summaries[action.kind], principal)
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.CONFIRMATION_REQUIRED,
                result_summary=conf.summary,
                correlation_id=corr,
            )
            return ActionResult(
                ok=False,
                kind=action.kind,
                message="Confirmation required",
                requires_confirmation=True,
                confirmation=conf,
                correlation_id=corr,
            )

        if confirmation_token:
            payload = verify_token(confirmation_token, session_secret())
            if not payload or payload.get("typ") != "confirm":
                return ActionResult(
                    ok=False, kind=action.kind, message="Invalid confirmation token", correlation_id=corr,
                )
            if payload.get("sub") != principal.actor:
                return ActionResult(
                    ok=False, kind=action.kind, message="Confirmation actor mismatch", correlation_id=corr,
                )
            if payload.get("fp") != action.fingerprint():
                return ActionResult(
                    ok=False, kind=action.kind, message="Confirmation action mismatch", correlation_id=corr,
                )
            jti = str(payload.get("jti") or "")
            exp = float(payload.get("exp") or 0)
            if not jti or not self.confirm_store.try_consume(
                jti=jti,
                actor=principal.actor,
                fingerprint=action.fingerprint(),
                expires_at=exp,
            ):
                return ActionResult(
                    ok=False, kind=action.kind, message="Confirmation token replay", correlation_id=corr,
                )
            self.confirm_store.cleanup_expired()
            self.audit.append(
                actor=principal.actor,
                role=principal.role,
                action=action.kind,
                input_fingerprint=action.fingerprint(),
                decision=AuditDecision.CONFIRMED,
                result_summary="operator confirmed",
                correlation_id=corr,
            )

        result = await self._dispatch(action.kind, params, principal)
        self.audit.append(
            actor=principal.actor,
            role=principal.role,
            action=action.kind,
            input_fingerprint=action.fingerprint(),
            decision=AuditDecision.EXECUTED if result.ok else AuditDecision.FAILED,
            result_summary=result.message[:200],
            correlation_id=corr,
            idempotency_key=action.idempotency_key,
        )
        result.correlation_id = corr
        return result

    async def _dispatch(
        self,
        kind: ActionKind,
        params: dict[str, Any],
        principal: OperatorPrincipal,
    ) -> ActionResult:
        if kind == ActionKind.NAVIGATE:
            route = params["route"]
            return ActionResult(ok=True, kind=kind, message=f"Navigate to {route}", data={"route": route})

        if kind == ActionKind.REPORT_STATUS:
            st = self._live_status()
            plan = self.build_plan()
            msg = (
                f"Campaign {'running' if st.get('running') else st.get('stopped_reason') or 'idle'}. "
                f"{st.get('attempts', 0)} attempts, {st.get('findings_total', 0)} findings."
            )
            return ActionResult(ok=True, kind=kind, message=msg, data={"status": st, "plan": plan.model_dump()})

        if kind == ActionKind.START_CAMPAIGN:
            packs = params.get("packs")
            rounds = int(params.get("rounds", 3))
            target = params.get("target")
            out = await self._live_start(
                packs, rounds,
                TargetRequest.model_validate(target) if target else None)
            if isinstance(out, tuple):
                body, code = out
                if code != 200:
                    return ActionResult(ok=False, kind=kind, message=body.get("error", "start failed"), data=body)
                return ActionResult(ok=True, kind=kind, message="Campaign started", data=body)
            return ActionResult(ok=True, kind=kind, message="Campaign started", data=out)

        if kind == ActionKind.ABORT_CAMPAIGN:
            body = self._live_abort()
            return ActionResult(
                ok=bool(body.get("aborting")),
                kind=kind,
                message="Campaign aborting" if body.get("aborting") else body.get("reason", "nothing to abort"),
                data=body,
            )

        if kind == ActionKind.INSPECT_FINDING:
            findings = self._live_findings()
            fid = params.get("finding_id")
            if fid:
                match = next((f for f in findings if fid.lower() in str(f.get("id", "")).lower()), None)
                if match:
                    return ActionResult(ok=True, kind=kind, message=match.get("title", "finding"), data={"finding": match})
                return ActionResult(ok=False, kind=kind, message=f"Finding {fid} not found")
            if findings:
                f0 = findings[-1]
                return ActionResult(ok=True, kind=kind, message=f0.get("title", "latest finding"), data={"finding": f0})
            return ActionResult(ok=False, kind=kind, message="No findings yet")

        if kind == ActionKind.REVIEW_GATE:
            gates = self._live_gates()
            gid = params.get("gate_id")
            if gid:
                g = next((x for x in gates if x.get("id") == gid), None)
                if g:
                    return ActionResult(ok=True, kind=kind, message=f"Gate {gid}", data={"gate": g})
                return ActionResult(ok=False, kind=kind, message=f"Gate {gid} not found")
            if gates:
                return ActionResult(ok=True, kind=kind, message="Gate list", data={"gates": gates})
            return ActionResult(ok=False, kind=kind, message="No gates recorded")

        if kind == ActionKind.SIGN_GATE:
            gid = params["gate_id"]
            signer = params.get("signer") or principal.actor
            body = self._live_sign_gate(gid, signer)
            if body.get("error"):
                return ActionResult(ok=False, kind=kind, message=body["error"], data=body)
            return ActionResult(ok=True, kind=kind, message=f"Gate {gid} signed", data=body)

        if kind == ActionKind.OPEN_DOSSIER:
            return ActionResult(ok=True, kind=kind, message="Open dossier", data={"route": "/dossier"})

        if kind == ActionKind.GENERATE_DOSSIER:
            rep = self._live_report()
            ready = rep.get("ready", False)
            return ActionResult(
                ok=ready,
                kind=kind,
                message="Dossier ready" if ready else "Report not ready — complete a campaign first",
                data=rep,
            )

        return ActionResult(ok=False, kind=kind, message="Unhandled action")
