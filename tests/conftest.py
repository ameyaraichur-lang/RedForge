"""Keep the demo-first test suite offline even when a local .env enables Astra."""
import os

import pytest

from redforge.config import settings


@pytest.fixture(autouse=True)
def _demo_mode_for_tests(request, monkeypatch):
    """CI and local pytest must never hit paid Astra or real targets."""
    if "live_astra" in request.keywords:
        return  # opt-in live contract tests read credentials from .env
    monkeypatch.setattr(settings, "llm_provider", "demo")
    monkeypatch.setattr(settings, "target_provider", "")
    monkeypatch.setattr(settings, "judge_provider", "")
    monkeypatch.setattr(settings, "astra_api_key", "")
    monkeypatch.setattr(settings, "target_api_key", "")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "optional_pyrit: requires the optional PyRIT package",
    )
    config.addinivalue_line(
        "markers",
        "optional_opa: requires the OPA binary at RF_OPA_PATH",
    )
    config.addinivalue_line(
        "markers",
        "live_astra: calls paid Azure Astra (opt-in via RF_LIVE_ASTRA=1 only)",
    )


def pytest_collection_modifyitems(config, items):
    if os.environ.get("RF_LIVE_ASTRA") == "1":
        return
    skip_live = pytest.mark.skip(
        reason="live Astra tests require RF_LIVE_ASTRA=1 (never in CI)",
    )
    for item in items:
        if "live_astra" in item.keywords:
            item.add_marker(skip_live)
