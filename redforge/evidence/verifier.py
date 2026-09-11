"""Verifier (M5a): the single writer for finding status transitions.

Only the Verifier confirms or voids a finding (single-writer rule); every
transition is written back to the Evidence Store so the audit trail stays
canonical. Critical findings additionally require human confirmation.
"""
from __future__ import annotations

from redforge.evidence.store import EvidenceStore
from redforge.schemas import Finding, FindingStatus, Severity


def verify_finding(store: EvidenceStore, finding: Finding, rerun_outcome: str) -> Finding:
    """Replay verification: rerun reproduced the attack ('Success') -> CONFIRMED,
    anything else -> VOIDED. The updated finding is written back and returned."""
    if rerun_outcome == "Success":
        updated = finding.model_copy(
            update={"status": FindingStatus.CONFIRMED, "reproduced": True}
        )
    else:
        updated = finding.model_copy(
            update={"status": FindingStatus.VOIDED, "reproduced": False}
        )
    store.record_finding(updated)
    return updated


def confirm_human(store: EvidenceStore, finding_id: str) -> Finding:
    """Mark a finding human-confirmed (required for Critical findings)."""
    finding = store.get_finding(finding_id)
    if finding is None:
        raise KeyError(f"unknown finding id: {finding_id}")
    updated = finding.model_copy(update={"human_confirmed": True})
    store.record_finding(updated)
    return updated


def fp_rate(findings: list[Finding]) -> float:
    """Voided findings / total findings; 0.0 when there is nothing to measure."""
    if not findings:
        return 0.0
    voided = sum(1 for f in findings if f.status == FindingStatus.VOIDED)
    return voided / len(findings)


def summary(findings: list[Finding]) -> dict[str, int]:
    """Aggregated verification stats, including the dual-mode tenet check:
    critical findings that are confirmed AND human-confirmed."""
    return {
        "total": len(findings),
        "confirmed": sum(1 for f in findings if f.status == FindingStatus.CONFIRMED),
        "voided": sum(1 for f in findings if f.status == FindingStatus.VOIDED),
        "candidates": sum(1 for f in findings if f.status == FindingStatus.CANDIDATE),
        "critical_confirmed_and_human": sum(
            1
            for f in findings
            if f.severity == Severity.CRITICAL
            and f.status == FindingStatus.CONFIRMED
            and f.human_confirmed
        ),
    }
