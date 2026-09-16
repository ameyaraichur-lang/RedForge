"""Provider-independent NL → typed operator intent parser (rule-based)."""
from __future__ import annotations

import re
import uuid

from .schemas import ActionKind, OperatorAction, ParsedIntent


_ROUTE_MAP: list[tuple[list[str], str]] = [
    (["world", "cinematic", "constellation"], "/world"),
    (["mission", "control", "dag", "swarm"], "/mission"),
    (["finding", "vulnerab", "issue"], "/findings"),
    (["score", "posture", "scorecard"], "/scorecard"),
    (["gate", "approv", "gatekeeper"], "/gates"),
    (["dossier", "compliance", "regulat", "ai act", "iso"], "/dossier"),
    (["target"], "/targets"),
    (["technique", "payload", "attack list"], "/techniques"),
    (["admin", "sentinel"], "/admin"),
    (["ops", "command center", "dashboard"], "/command"),
]

_RULES: list[tuple[list[str], ActionKind, dict]] = [
    (["abort", "stop campaign", "halt campaign", "kill campaign"], ActionKind.ABORT_CAMPAIGN, {}),
    (["start campaign", "launch campaign", "run campaign", "begin attack", "run full"], ActionKind.START_CAMPAIGN, {"rounds": 3}),
    (["brief", "sitrep", "status", "report status", "how is"], ActionKind.REPORT_STATUS, {}),
    (["sign gate", "approve gate"], ActionKind.SIGN_GATE, {}),
    (["review gate", "gate status"], ActionKind.REVIEW_GATE, {}),
    (["inspect finding", "explain finding", "show finding", "finding details"], ActionKind.INSPECT_FINDING, {}),
    (["generate dossier", "create dossier", "build dossier"], ActionKind.GENERATE_DOSSIER, {}),
    (["open dossier", "dossier"], ActionKind.OPEN_DOSSIER, {}),
    (["navigate to", "go to"], ActionKind.NAVIGATE, {}),
]

_FINDING_RE = re.compile(r"\b(?:finding|rf-f)[-\s]?(\w+)\b", re.I)
_GATE_RE = re.compile(r"\bgate[-\s]?(\w+)\b", re.I)
#: Catalogue target ids as spoken or typed: "TGT-04", "tgt 04", "tgt demo".
#: Only the suffix is captured, so the canonical id is rebuilt rather than
#: patched up from whatever separator the operator used.
_TARGET_RE = re.compile(r"\btgt[-\s]?(demo|\d{2})\b", re.I)


def parse_natural_language(
    text: str,
    *,
    source: str = "text",
) -> ParsedIntent | None:
    """Map natural language to a typed operator action. Returns None if unmatched."""
    raw = text.strip()
    if not raw:
        return None
    lower = raw.lower()

    for patterns, kind, defaults in _RULES:
        if any(p in lower for p in patterns):
            params = dict(defaults)
            if kind == ActionKind.INSPECT_FINDING:
                m = _FINDING_RE.search(raw)
                if m:
                    params["finding_id"] = m.group(1).upper()
            if kind in (ActionKind.REVIEW_GATE, ActionKind.SIGN_GATE):
                m = _GATE_RE.search(raw)
                if m:
                    params["gate_id"] = f"G-{m.group(1).zfill(3)}" if m.group(1).isdigit() else m.group(1)
            if kind == ActionKind.START_CAMPAIGN:
                if "1 round" in lower or "one round" in lower:
                    params["rounds"] = 1
                elif "2 round" in lower or "two round" in lower:
                    params["rounds"] = 2
                m = _TARGET_RE.search(raw)
                if m:
                    # Unknown ids are rejected by the catalogue, and Astra is
                    # refused by the registry, so this only has to normalise.
                    params["target"] = {"target_id": f"TGT-{m.group(1).upper()}"}
            return ParsedIntent(
                action=OperatorAction(
                    kind=kind,
                    params=params,
                    correlation_id=f"corr-{uuid.uuid4().hex[:10]}",
                ),
                confidence=0.92,
                source=source,  # type: ignore[arg-type]
                raw_input=raw,
            )

    # navigation fallback
    for patterns, route in _ROUTE_MAP:
        if any(p in lower for p in patterns):
            return ParsedIntent(
                action=OperatorAction(
                    kind=ActionKind.NAVIGATE,
                    params={"route": route},
                    correlation_id=f"corr-{uuid.uuid4().hex[:10]}",
                ),
                confidence=0.85,
                source=source,  # type: ignore[arg-type]
                raw_input=raw,
            )

    return None
