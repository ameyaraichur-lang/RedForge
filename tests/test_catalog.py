"""M0 gate: 40 techniques load, IDs unique, packs covered, seeds present."""
from redforge.catalog import (DIMENSIONS, PACKS, SEEDS, SCRIPTS, TECHNIQUES,
                              compute_score, pack_techniques, seeds_for, technique)


def test_catalog_has_40_techniques():
    assert len(TECHNIQUES) == 40


def test_technique_ids_unique():
    ids = [t.id for t in TECHNIQUES]
    assert len(set(ids)) == 40


def test_eight_packs_covered():
    assert set(PACKS) == {"PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"}
    counts = {p: len(pack_techniques(p)) for p in PACKS}
    assert counts == {"PIN": 10, "EXF": 7, "OUT": 4, "AGE": 7, "MEM": 3, "CON": 4, "HAL": 3, "SUP": 2}


def test_every_technique_has_payloads():
    missing = [t.id for t in TECHNIQUES if not seeds_for(t.id)]
    assert missing == [], f"techniques without round-1 payloads: {missing}"


def test_gate_levels_valid():
    assert all(t.gate_level in ("Safe", "Sensitive", "G1 + budget") for t in TECHNIQUES)
    sensitive = [t.id for t in TECHNIQUES if t.gate_level == "Sensitive"]
    assert len(sensitive) >= 15  # sensitive packs need G1 two-person approval


def test_technique_lookup():
    assert technique("PIN-001").name == "Direct instruction override"
    try:
        technique("XXX-999")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass


def test_scorecard_math_matches_workbook():
    """Demo baseline 44/55/40/50/60/30 must reproduce 46.5 Poor (workbook F15/F16)."""
    s = compute_score()
    assert s["weights_sum"] == 1.0
    assert s["total"] == 46.5
    assert s["band"] == "Poor"
    assert s["maturity"] == "Level 2 (Managed)"


def test_scorecard_bands():
    assert compute_score({d.name: 100 for d in DIMENSIONS})["band"] == "Good"
    assert compute_score({d.name: 0 for d in DIMENSIONS})["band"] == "Critical"
    mid = {d.name: 65 for d in DIMENSIONS}
    assert compute_score(mid)["band"] == "Fair"


def test_ten_target_classes():
    from redforge.catalog import TARGET_CATALOGUE, demo_target
    assert len(TARGET_CATALOGUE) == 10
    assert set(demo_target().packs) == set(PACKS)
