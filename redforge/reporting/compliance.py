"""Compliance Mapper: findings -> regulatory control mappings.

Tenets:
- every finding maps to >= 1 control (hard rule — findings whose technique is
  not in the catalog map to the sentinel ``UNMAPPED`` instead of an empty
  list, so downstream dossier tooling never sees an unmapped-and-empty row);
- the mapping feeds the EU AI Act Article 15 dossier, so control ids are
  stable, citation-grade identifiers (EU AI Act Art 15.2 / ISO 42001 Annex A /
  NIST AI RMF).
"""
from redforge.catalog import technique

__all__ = ["CONTROLS", "REMEDIATION", "UNMAPPED", "map_finding",
           "map_findings", "readiness_ratio"]

UNMAPPED = "UNMAPPED"

# pack -> regulatory control ids (citation-grade; feeds the Art 15 dossier).
CONTROLS: dict[str, tuple[str, ...]] = {
    "PIN": ("EU-AI-Act-Art-15.2-Robustness", "ISO-42001-A.10.2", "NIST-AI-RMF-MEASURE-2.3"),
    "EXF": ("EU-AI-Act-Art-15.2-Confidentiality", "ISO-42001-A.10.3", "NIST-AI-RMF-MAP-1.5"),
    "OUT": ("EU-AI-Act-Art-15.2-Output-Integrity", "ISO-42001-A.10.5"),
    "AGE": ("ISO-42001-A.10.4", "NIST-AI-RMF-GOVERN-2.2", "OWASP-Agentic-Top10"),
    "MEM": ("ISO-42001-A.10.4", "OWASP-Agentic-Top10"),
    "CON": ("EU-AI-Act-Art-15.2-Availability", "NIST-AI-RMF-MEASURE-2.5"),
    "HAL": ("EU-AI-Act-Art-15.2-Accuracy", "NIST-AI-RMF-MEASURE-2.4"),
    "SUP": ("ISO-42001-A.10.6", "NIST-AI-RMF-GOVERN-4.1"),
}

# pack -> one-line remediation guidance (dossier-friendly, action-first).
REMEDIATION: dict[str, str] = {
    "PIN": "Harden the system prompt and tune injection guardrails: delimit untrusted content, "
           "re-state instructions after retrieved data, and add override-resistance tests to CI.",
    "EXF": "Apply RAG sanitation: enforce tenant-scope retrieval filters, strip secrets and canary "
           "strings from context, and redact PII before responses leave the system.",
    "OUT": "Validate and encode model output before rendering or execution: sanitize markdown/HTML, "
           "sandbox generated code, and verify outbound links against an allowlist.",
    "AGE": "Tighten tool ACLs: grant least-privilege scopes per task, require human confirmation "
           "for destructive actions, and cap autonomous step counts per session.",
    "MEM": "Scope agent memory per user and per session; quarantine long-term writes for review "
           "before they can influence later turns or other principals.",
    "CON": "Enforce budget caps: per-request token ceilings, tool-call and step limits, rate "
           "limiting with circuit breakers, and cost alarms per campaign.",
    "HAL": "Ground answers in retrieved sources and validate citations before release; route "
           "low-evidence regulatory answers to human review with visible uncertainty.",
    "SUP": "Verify tool signatures and schemas against a pinned registry: diff the live tool "
           "surface for undocumented endpoints and reject unsigned schema changes.",
}


def map_finding(f) -> dict:
    """Map one finding to its regulatory controls via its technique's pack.

    Unknown technique (or pack missing from the registry) -> ``["UNMAPPED"]``:
    the controls list is never empty (hard rule).
    """
    try:
        pack = technique(f.technique_id).pack
    except KeyError:
        return {"finding_id": f.id, "pack": "UNKNOWN", "controls": [UNMAPPED]}
    controls = list(CONTROLS.get(pack, ()))
    if not controls:
        controls = [UNMAPPED]
    return {"finding_id": f.id, "pack": pack, "controls": controls}


def map_findings(findings) -> list[dict]:
    """Map every finding; each mapping carries >= 1 control (hard rule)."""
    mappings = [map_finding(f) for f in findings]
    for m in mappings:
        if not m["controls"]:  # belt-and-braces: never emit an empty list
            m["controls"] = [UNMAPPED]
    return mappings


def readiness_ratio(findings) -> float:
    """Fraction of findings whose controls are known (non-``UNMAPPED``).

    An empty findings list is vacuously ready (nothing is unmapped) -> 1.0.
    """
    if not findings:
        return 1.0
    mapped = sum(1 for m in map_findings(findings) if UNMAPPED not in m["controls"])
    return mapped / len(findings)
