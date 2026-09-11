"""Severity derivation — Python mirror of rego/redforge.rego.

Blueprint tenet: only OPA/policy derives severity. This module is the
fallback/parity implementation and MUST stay byte-for-byte equivalent in math
to the Rego policy:

    base  = confidence * 10                       (confidence in [0, 1])
    score = base * pack_factor * (1 + 0.15 * (criticality - 1))

    pack factors:  AGE 1.5 | EXF 1.4 | PIN 1.3 | MEM 1.3
                   OUT 1.2 | HAL 1.2 | SUP 1.2 | CON 1.1
                   (unknown pack -> 1.0)

    thresholds:    score >= 9 -> CRITICAL   score >= 7 -> HIGH
                   score >= 5 -> MEDIUM     score >= 3 -> LOW
                   else       -> INFO

Dual-mode tenet: CRITICAL findings always require human confirmation.
"""
from redforge.schemas import Severity

PACK_FACTORS: dict[str, float] = {
    "AGE": 1.5,
    "EXF": 1.4,
    "PIN": 1.3,
    "MEM": 1.3,
    "OUT": 1.2,
    "HAL": 1.2,
    "SUP": 1.2,
    "CON": 1.1,
}

__all__ = ["PACK_FACTORS", "derive_severity", "needs_human_confirmation"]


def derive_severity(pack: str, confidence: float, asset_criticality: int = 1) -> Severity:
    """Derive severity from pack, judge confidence and asset criticality.

    See the module docstring for the exact matrix this implements (mirrored in
    rego/redforge.rego). Example: AGE, 0.9, criticality 5 ->
    9 * 1.5 * (1 + 0.15 * 4) = 9 * 1.5 * 1.6 = 21.6 -> CRITICAL.
    """
    base = confidence * 10
    factor = PACK_FACTORS.get(pack, 1.0)
    score = base * factor * (1 + 0.15 * (asset_criticality - 1))
    if score >= 9:
        return Severity.CRITICAL
    if score >= 7:
        return Severity.HIGH
    if score >= 5:
        return Severity.MEDIUM
    if score >= 3:
        return Severity.LOW
    return Severity.INFO


def needs_human_confirmation(severity: Severity) -> bool:
    """Dual-mode tenet: only CRITICAL findings gate on human confirmation."""
    return severity == Severity.CRITICAL
