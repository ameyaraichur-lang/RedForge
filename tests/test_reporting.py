"""M5b gate: Compliance Mapper (controls hard rule), Scribe citation lint +
report generation (hard gate), PDF rendering."""
import pytest

from redforge.catalog import PACKS, compute_score
from redforge.reporting import (CONTROLS, REMEDIATION, generate_report,
                                lint_citations, map_findings,
                                readiness_ratio, render_pdf, report_fidelity)
from redforge.schemas import Finding, FindingStatus, Severity


def _finding(fid: str, tech_id: str,
             status: FindingStatus = FindingStatus.CANDIDATE,
             severity: Severity = Severity.MEDIUM,
             confidence: float = 0.8,
             human_confirmed: bool = False) -> Finding:
    return Finding(
        id=fid, campaign_id="RF-C-0001", technique_id=tech_id,
        target_id="demo-01", title=f"synthetic finding {fid}",
        confidence=confidence, severity=severity, status=status,
        human_confirmed=human_confirmed,
    )


def make_findings() -> list[Finding]:
    """6 findings across 6 different packs; mixed statuses; one critical."""
    return [
        _finding("RF-F-0001", "PIN-001", FindingStatus.CONFIRMED, Severity.CRITICAL, 0.95, True),
        _finding("RF-F-0002", "EXF-001", FindingStatus.CONFIRMED, Severity.HIGH, 0.90),
        _finding("RF-F-0003", "OUT-001", FindingStatus.CANDIDATE, Severity.MEDIUM, 0.70),
        _finding("RF-F-0004", "AGE-001", FindingStatus.CONFIRMED, Severity.HIGH, 0.88),
        _finding("RF-F-0005", "CON-001", FindingStatus.CANDIDATE, Severity.LOW, 0.60),
        _finding("RF-F-0006", "HAL-001", FindingStatus.VOIDED, Severity.MEDIUM, 0.40),
    ]


# ------------------------------------------------------------- compliance mapper


def test_controls_registry_covers_every_pack():
    assert set(CONTROLS) == set(PACKS)
    assert all(controls for controls in CONTROLS.values())  # never empty
    assert CONTROLS["PIN"] == ("EU-AI-Act-Art-15.2-Robustness",
                               "ISO-42001-A.10.2", "NIST-AI-RMF-MEASURE-2.3")
    assert set(REMEDIATION) == set(PACKS)
    assert all(REMEDIATION[p] for p in PACKS)


def test_map_findings_every_finding_has_at_least_one_control():
    mappings = map_findings(make_findings())
    assert len(mappings) == 6
    assert all(len(m["controls"]) >= 1 for m in mappings)  # hard rule
    assert {m["pack"] for m in mappings} == {"PIN", "EXF", "OUT", "AGE", "CON", "HAL"}
    by_id = {m["finding_id"]: m for m in mappings}
    assert by_id["RF-F-0001"]["controls"] == list(CONTROLS["PIN"])


def test_unknown_technique_maps_to_unmapped_and_lowers_readiness():
    findings = make_findings() + [_finding("RF-F-0007", "XXX-1")]
    assert readiness_ratio(make_findings()) == 1.0
    assert readiness_ratio(findings) < 1.0
    assert readiness_ratio(findings) == pytest.approx(6 / 7)
    unknown = map_findings(findings)[-1]
    assert unknown["finding_id"] == "RF-F-0007"
    assert unknown["pack"] == "UNKNOWN"
    assert unknown["controls"] == ["UNMAPPED"]  # never empty


# ---------------------------------------------------------------- citation lint


def test_lint_citations_basic_rules():
    assert lint_citations("We confirmed the attack RF-F-0001 worked") == []
    assert lint_citations("We confirmed the attack worked") == \
        ["We confirmed the attack worked"]
    assert lint_citations("Scorecard total is 46.5") == []


def test_lint_citations_catches_claim_without_finding_id():
    bad = ("## Executive Summary\n"
           "The target is vulnerable to prompt injection.\n"
           "Mitigated per RF-F-0001.")
    assert lint_citations(bad) == ["The target is vulnerable to prompt injection."]


# ------------------------------------------------------------ report generation


def test_generate_report_markdown_and_structure():
    findings = make_findings()
    sc = compute_score()
    report = generate_report(findings, None, sc, "RF-C-0001",
                             target_name="demo-target")
    assert set(report) == {"meta", "executive", "scorecard", "findings",
                           "compliance", "remediation", "markdown"}
    assert report["meta"]["campaign_id"] == "RF-C-0001"
    assert report["meta"]["target"] == "demo-target"

    md = report["markdown"]
    for f in findings:  # every finding id present (citation lint backbone)
        assert f.id in md
    assert lint_citations(md) == []  # hard gate passes by construction
    assert sc["band"] in report["executive"]  # executive mentions band
    assert sc["band"] in md
    assert "EU-AI-Act-Art-15.2-Robustness" in md  # controls rendered
    assert "| ID | Technique | Severity | Status | Confidence | Controls |" in md
    assert "| Dimension | Weighted |" in md
    assert "## Remediation" in md and "## Disclaimer" in md

    # structured findings: every row keeps >= 1 control; voided still listed.
    assert all(r["controls"] for r in report["findings"])
    statuses = {r["id"]: r["status"] for r in report["findings"]}
    assert statuses["RF-F-0006"] == "Voided"
    assert "| RF-F-0006 | HAL-001 | Medium | Voided" in md

    assert set(report["remediation"]) == {"PIN", "EXF", "OUT", "AGE", "CON", "HAL"}
    assert report["remediation"]["PIN"] == REMEDIATION["PIN"]
    assert report["compliance"]["readiness"] == 1.0


def test_generate_report_tolerates_unmapped_and_still_passes_lint():
    findings = make_findings() + [_finding("RF-F-0007", "XXX-1")]
    report = generate_report(findings, None, compute_score(), "RF-C-0002")
    md = report["markdown"]
    assert "UNMAPPED" in md
    assert "RF-F-0007" in md
    assert lint_citations(md) == []
    assert report["compliance"]["readiness"] == pytest.approx(6 / 7)


def test_report_fidelity():
    stats = report_fidelity(make_findings(), compute_score())
    assert stats == {"total": 6, "confirmed": 3, "criticals": 1}


# -------------------------------------------------------------------- pdf


def test_render_pdf(tmp_path):
    report = generate_report(make_findings(), None, compute_score(), "RF-C-0001",
                             target_name="demo-target")
    out = str(tmp_path / "r.pdf")
    assert render_pdf(report, out) == out
    p = tmp_path / "r.pdf"
    assert p.exists()
    assert p.stat().st_size > 1500


def test_render_pdf_requires_all_sections(tmp_path):
    with pytest.raises(ValueError):
        render_pdf({"meta": {}, "executive": "x"}, str(tmp_path / "bad.pdf"))
