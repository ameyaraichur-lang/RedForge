"""M5b: Scribe + Compliance Mapper + report/PDF generation.

- compliance: findings -> regulatory control mappings (EU AI Act Art 15.2,
  ISO 42001 Annex A, NIST AI RMF) — every finding maps to >= 1 control;
- scribe: citation-linted report generation (the lint is a hard gate);
- pdf: reportlab rendering of the validated report dict.
"""
from .compliance import (CONTROLS, REMEDIATION, UNMAPPED, map_finding,
                         map_findings, readiness_ratio)
from .pdf import render_pdf
from .scribe import generate_report, lint_citations, report_fidelity

__all__ = [
    "CONTROLS", "REMEDIATION", "UNMAPPED",
    "map_finding", "map_findings", "readiness_ratio",
    "lint_citations", "generate_report", "report_fidelity",
    "render_pdf",
]
