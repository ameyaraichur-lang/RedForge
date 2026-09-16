"""The release suite must not depend on anything outside this checkout.

Once a target can be named per campaign, it becomes easy to leave a real
endpoint configured and have the gates quietly start attacking it — the run
would still be green, and it would no longer be measuring this release. These
tests pin the boundary: the default suite is hermetic, and the tests that
reach a third party are opt-in.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from redforge.judge.oracles import PACK_ORACLES
from redforge.targets import resolve_endpoint
from redforge.targets.authorization import EXEMPT_TARGET_IDS

ROOT = Path(__file__).resolve().parent.parent
CONFORMANCE_DIR = ROOT / "tests" / "conformance"


@pytest.fixture(scope="module")
def pytest_config() -> dict:
    with (ROOT / "pyproject.toml").open("rb") as fh:
        return tomllib.load(fh)["tool"]["pytest"]["ini_options"]


def test_conformance_tests_are_excluded_by_default(pytest_config):
    """A plain `pytest` (and therefore every gate) must skip them."""
    assert "not conformance" in pytest_config.get("addopts", "")


def test_conformance_marker_is_registered(pytest_config):
    markers = " ".join(pytest_config.get("markers", []))
    assert "conformance:" in markers


def test_every_conformance_test_is_marked():
    """An unmarked test in that directory would run in the default suite."""
    for path in CONFORMANCE_DIR.glob("test_*.py"):
        source = path.read_text(encoding="utf-8")
        assert "pytest.mark.conformance" in source, f"{path.name} is unmarked"


def test_conformance_tests_need_an_explicit_target():
    """Even when opted in, they must not invent an endpoint."""
    for path in CONFORMANCE_DIR.glob("test_*.py"):
        source = path.read_text(encoding="utf-8")
        assert "RF_CONFORMANCE_BASE_URL" in source
        assert "skipif" in source


def test_the_default_target_is_the_local_fixture():
    """With no RF_TARGET_* configured, campaigns hit the in-process fixture."""
    endpoint = resolve_endpoint()
    assert endpoint.provider == "demo"
    assert not endpoint.api_key


def test_only_the_bundled_fixture_skips_authorization():
    """An exemption list that grew would let gates attack a real asset."""
    assert EXEMPT_TARGET_IDS == frozenset({"TGT-DEMO"})


def test_fixture_markers_keep_every_pack_provable():
    """Why the gates can still score absence as a pass: against the bundled
    fixture every pack has a marker oracle, so nothing is inconclusive."""
    for pack in PACK_ORACLES:
        assert "fixture_markers" in PACK_ORACLES[pack], pack
