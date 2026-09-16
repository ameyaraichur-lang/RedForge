"""M2: Scoring Engine + Policy.

- engine: findings -> AI Security Scorecard (must reproduce the blueprint
  workbook math exactly; see redforge.catalog.scorecard).
- severity: Python mirror of the OPA severity policy (fallback path; the
  blueprint tenet is that only OPA/policy derives severity authoritatively).
- rego_runner: subprocess bridge to the OPA binary + silent Python fallback.
"""
from .engine import COVERAGE_THRESHOLD, regulatory_actual, scorecard_from_findings
from .severity import PACK_FACTORS, derive_severity, needs_human_confirmation
from .rego_runner import (SourcedSeverity, opa_available, opa_eval,
                          score_via_opa, severity_via_opa)

# Re-export the workbook-exact aggregation for convenience.
from redforge.catalog.scorecard import compute_score

__all__ = [
    "COVERAGE_THRESHOLD",
    "compute_score",
    "regulatory_actual",
    "scorecard_from_findings",
    "PACK_FACTORS",
    "derive_severity",
    "needs_human_confirmation",
    "SourcedSeverity",
    "opa_available",
    "opa_eval",
    "score_via_opa",
    "severity_via_opa",
]
