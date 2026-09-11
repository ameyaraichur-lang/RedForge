"""Scribe: citation-linted report generation.

Hard gates (by construction):
- citation lint — any line asserting an attack outcome ("confirmed",
  "successful", "vulnerable", "exploited", "found") must cite a finding id
  matching ``RF-F-\\d{4}``; ``generate_report`` lints its own markdown and
  raises ``RuntimeError`` rather than emitting a report that fails;
- every finding keeps >= 1 regulatory control (via the Compliance Mapper),
  so the report can back the EU AI Act Article 15 dossier.

Inputs are duck-typed: anything with ``id / technique_id / title / severity /
status / confidence`` attributes works (pydantic ``Finding`` is the norm).
"""
import re
from datetime import datetime, timezone

from .compliance import REMEDIATION, UNMAPPED, map_findings, readiness_ratio

__all__ = ["lint_citations", "generate_report", "report_fidelity",
           "CLAIM_WORDS", "FINDING_ID_PATTERN"]

# Words that turn a line into an outcome claim; claims need a finding id.
CLAIM_WORDS = ("confirmed", "successful", "vulnerable", "exploited", "found")
FINDING_ID_PATTERN = r"RF-F-\d{4}"

_FINDING_ID = re.compile(FINDING_ID_PATTERN, re.IGNORECASE)
# Metadata label lines (Target/Campaign/Generated/Engagement) state facts about
# the report envelope, not outcome claims — a target literally named "vulnerable
# demo copilot" must not trip the lint. The claim-bearing sections still lint.
_METADATA_LINE = re.compile(r"^\s*[-*]?\s*\*\*(Target|Campaign|Generated|Engagement|Report)\b",
                            re.IGNORECASE)


def lint_citations(md_text: str) -> list[str]:
    """Return markdown lines that make an outcome claim without citing a
    finding id (``RF-F-\\d{4}``, case-insensitive). Empty list == clean."""
    violations: list[str] = []
    for line in md_text.splitlines():
        if _METADATA_LINE.match(line):
            continue
        low = line.lower()
        if any(word in low for word in CLAIM_WORDS) and not _FINDING_ID.search(line):
            violations.append(line)
    return violations


def _v(x) -> str:
    """Enum-safe string (works for FindingStatus/Severity and plain strings)."""
    return getattr(x, "value", str(x))


def report_fidelity(findings, scorecard: dict | None = None) -> dict:
    """Small fidelity stats shared by the generator and the tests."""
    confirmed = sum(1 for f in findings if _v(f.status) == "Confirmed")
    criticals = sum(1 for f in findings if _v(f.severity) == "Critical")
    return {"total": len(findings), "confirmed": confirmed, "criticals": criticals}


def generate_report(findings: list, verdicts: list | None, scorecard: dict,
                    campaign_id: str, target_name: str = "target") -> dict:
    """Build the full assessment report (structured dict + markdown).

    ``verdicts`` is accepted for interface stability (reserved for
    judge-confidence cross-checks); ``scorecard`` is any
    :func:`redforge.catalog.compute_score`-shaped dict. Raises
    ``RuntimeError("citation lint failed", violations)`` if the generated
    markdown trips the citation linter.
    """
    del verdicts  # reserved: judge-confidence cross-check lands post-M5b
    mappings = map_findings(findings)
    stats = report_fidelity(findings, scorecard)
    ratio = readiness_ratio(findings)
    mapped = sum(1 for m in mappings if UNMAPPED not in m["controls"])

    confirmed_ids = [f.id for f in findings if _v(f.status) == "Confirmed"]
    critical_ids = [f.id for f in findings if _v(f.severity) == "Critical"]

    contributions = dict(scorecard.get("contributions") or {})
    band = str(scorecard.get("band", "n/a"))
    maturity = str(scorecard.get("maturity", "n/a"))
    total_score = scorecard.get("total", 0)

    # ---- structured sections ------------------------------------------------
    rows: list[dict] = []
    packs_controls: dict[str, list[str]] = {}
    for f, m in zip(findings, mappings):
        rows.append({
            "id": f.id,
            "technique_id": f.technique_id,
            "pack": m["pack"],
            "title": f.title,
            "severity": _v(f.severity),
            "status": _v(f.status),
            "confidence": f.confidence,
            "controls": list(m["controls"]),
        })
        pc = packs_controls.setdefault(m["pack"], [])
        pc.extend(c for c in m["controls"] if c not in pc)

    # ---- executive summary (each claim line cites finding ids) --------------
    id_range = (f"({sorted(f.id for f in findings)[0]}..{sorted(f.id for f in findings)[-1]})"
                if findings else "(none)")
    sentences = [
        f"This assessment recorded {stats['total']} findings {id_range} against target "
        f"{target_name} under campaign {campaign_id}.",
    ]
    if confirmed_ids:
        sentences.append(f"Of these, {len(confirmed_ids)} are confirmed "
                         f"({', '.join(confirmed_ids)}).")
    else:
        sentences.append("None have passed Verifier reproduction yet.")
    if critical_ids:
        sentences.append(f"{len(critical_ids)} carry critical severity "
                         f"({', '.join(critical_ids)}).")
    else:
        sentences.append("No critical-severity findings were recorded.")
    sentences.append(f"The composite scorecard total is {total_score} "
                     f"(band {band}; maturity {maturity}).")
    sentences.append("Per-pack remediation guidance follows the findings and "
                     "compliance mapping below.")

    # ---- markdown ------------------------------------------------------------
    generated = datetime.now(timezone.utc).isoformat()
    lines: list[str] = [
        "# AI-RedForge Security Assessment",
        "",
        f"- **Campaign:** {campaign_id}",
        f"- **Target:** {target_name}",
        f"- **Generated:** {generated}",
        "",
        "## Executive Summary",
        "",
        *sentences,
        "",
        "## Scorecard",
        "",
        "| Dimension | Weighted |",
        "| --- | --- |",
    ]
    for dim, weighted in contributions.items():
        lines.append(f"| {dim} | {weighted} |")
    lines.append(f"| **Total** | **{total_score} — {band}** |")
    lines += [
        "",
        "## Findings",
        "",
        "| ID | Technique | Severity | Status | Confidence | Controls |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append(f"| {r['id']} | {r['technique_id']} | {r['severity']} | "
                     f"{r['status']} | {r['confidence']:.2f} | "
                     f"{'; '.join(r['controls'])} |")
    lines += [
        "",
        "## Compliance Mapping",
        "",
        f"Control-mapping readiness: {mapped}/{stats['total']} findings map to "
        f"at least one known regulatory control (ratio {ratio:.2f}).",
        "",
    ]
    for pack, controls in packs_controls.items():
        lines.append(f"- **{pack}** — {', '.join(controls)}")
    lines += ["", "## Remediation", ""]
    for pack in packs_controls:
        if pack in REMEDIATION:
            lines.append(f"- **{pack}:** {REMEDIATION[pack]}")
    lines += [
        "",
        "## Disclaimer",
        "",
        "This report was generated automatically by AI-RedForge for the "
        "campaign and target identified above. It is supporting evidence for "
        "the EU AI Act Article 15 dossier and internal ISO 42001 audits, not "
        "a substitute for either. Severity, status and confidence reflect the "
        "dual-mode judging pipeline at generation time, and every outcome "
        "claim above cites a finding id. All items require human review "
        "before external release.",
    ]
    markdown = "\n".join(lines) + "\n"

    # ---- HARD GATE: citation lint --------------------------------------------
    violations = lint_citations(markdown)
    if violations:
        raise RuntimeError("citation lint failed", violations)

    return {
        "meta": {"campaign_id": campaign_id, "target": target_name,
                 "generated": generated},
        "executive": " ".join(sentences),
        "scorecard": {"contributions": contributions, "total": total_score,
                      "band": band, "maturity": maturity},
        "findings": rows,
        "compliance": {"readiness": ratio, "mapped": mapped,
                       "total": stats["total"], "packs": packs_controls},
        "remediation": {pack: REMEDIATION[pack] for pack in packs_controls
                        if pack in REMEDIATION},
        "markdown": markdown,
    }
