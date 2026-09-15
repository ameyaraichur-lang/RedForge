"""Per-campaign target selection: the contract, the registry, and the guardrails.

Phase 1/2 of the target plan. Before this, every campaign attacked the bundled
fixture and ``get_target_adapter()`` was a two-branch if/else with no interface
to implement against. These tests pin the three properties that make selection
safe to expose:

* an explicitly requested target never silently degrades to the fixture,
* Astra can never be reached through any target path,
* credentials are passed by env-var *name*, so no key is ever echoed into a
  campaign event or archived into an evidence bundle.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

from redforge.catalog.targets import all_targets, demo_target, resolve_target_spec
from redforge.config import settings
from redforge.schemas.campaign import TargetRequest, TargetSpec
from redforge.targets import (
    DEMO_BASE_URL,
    OpenAICompatibleTarget,
    TargetAdapter,
    TargetEndpoint,
    TargetResolutionError,
    canonical_provider,
    demo_adapter,
    providers,
    register,
    resolve_endpoint,
)
from redforge.targets.registry import build

# ------------------------------------------------------------------ contract


def test_both_builtin_adapters_satisfy_the_protocol():
    assert isinstance(demo_adapter(), TargetAdapter)
    assert isinstance(OpenAICompatibleTarget("http://example.invalid/v1"), TargetAdapter)


def test_registry_exposes_exactly_the_builtin_providers():
    assert providers() == ["demo", "openai-compatible"]


def test_legacy_real_alias_maps_to_the_named_provider():
    assert canonical_provider("real") == "openai-compatible"
    assert canonical_provider("REAL") == "openai-compatible"
    assert canonical_provider("demo") == "demo"


# ------------------------------------------------------------------ registry


def test_registering_astra_as_a_target_is_refused():
    with pytest.raises(TargetResolutionError, match="judge-only"):
        register("astra", kind="astra")(lambda endpoint: demo_adapter())


def test_duplicate_provider_registration_is_refused():
    with pytest.raises(TargetResolutionError, match="duplicate"):
        register("demo", kind="demo")(lambda endpoint: demo_adapter())


def test_unknown_provider_names_the_registered_ones():
    with pytest.raises(TargetResolutionError, match="openai-compatible"):
        build(TargetEndpoint(provider="wishful-thinking"))


def test_building_astra_is_refused_even_by_direct_registry_call():
    with pytest.raises(TargetResolutionError, match="judge-only"):
        build(TargetEndpoint(provider="astra", base_url="https://x/v1", api_key="k"))


def test_openai_compatible_requires_a_base_url():
    with pytest.raises(TargetResolutionError, match="base_url"):
        build(TargetEndpoint(provider="openai-compatible", api_key="k"))


def test_openai_compatible_rejects_the_in_process_fixture_address():
    """http://demo.local/v1 only resolves through an ASGI transport."""
    with pytest.raises(TargetResolutionError, match="in-process fixture"):
        build(TargetEndpoint(provider="openai-compatible",
                             base_url=DEMO_BASE_URL, api_key="k"))


# ---------------------------------------------------------------- resolution


def test_default_resolution_is_the_demo_fixture():
    assert resolve_endpoint().provider == "demo"


def test_env_configured_real_without_a_key_falls_back(monkeypatch):
    """Legacy contract: an unconfigured checkout still runs."""
    monkeypatch.setattr(settings, "target_provider", "real")
    monkeypatch.setattr(settings, "target_api_key", "")
    assert resolve_endpoint().provider == "demo"


def test_explicitly_requested_target_never_degrades_to_the_fixture(monkeypatch):
    """The important one: asking for a real target and getting the fixture
    would produce a scorecard for an asset that was never attacked."""
    monkeypatch.setattr(settings, "target_api_key", "")
    with pytest.raises(TargetResolutionError, match="needs a credential"):
        resolve_endpoint(TargetRequest(provider="openai-compatible",
                                       base_url="https://target.invalid/v1"))


def test_api_key_is_read_from_the_named_env_var(monkeypatch):
    monkeypatch.setenv("RF_TEST_TARGET_KEY", "secret-from-env")
    endpoint = resolve_endpoint(TargetRequest(provider="openai-compatible",
                                              base_url="https://target.invalid/v1",
                                              api_key_env="RF_TEST_TARGET_KEY"))
    assert endpoint.api_key == "secret-from-env"


def test_missing_named_env_var_is_an_error_not_an_empty_key(monkeypatch):
    monkeypatch.delenv("RF_ABSENT_TARGET_KEY", raising=False)
    with pytest.raises(TargetResolutionError, match="unset or empty"):
        resolve_endpoint(TargetRequest(provider="openai-compatible",
                                       base_url="https://target.invalid/v1",
                                       api_key_env="RF_ABSENT_TARGET_KEY"))


def test_target_request_carries_no_secret_field():
    """A literal key would be archived into the evidence bundle."""
    fields = set(TargetRequest.model_fields)
    assert "api_key" not in fields
    assert "api_key_env" in fields


def test_base_url_precedence_request_then_spec_then_env(monkeypatch):
    monkeypatch.setattr(settings, "target_api_key", "k")
    monkeypatch.setattr(settings, "target_base_url", "http://from-env/v1")
    spec = TargetSpec(id="T", name="t", target_class=demo_target().target_class,
                      base_url="http://from-spec/v1")

    req = TargetRequest(provider="openai-compatible", base_url="http://from-request/v1")
    assert resolve_endpoint(req, spec).base_url == "http://from-request/v1"

    req = TargetRequest(provider="openai-compatible")
    assert resolve_endpoint(req, spec).base_url == "http://from-spec/v1"

    assert resolve_endpoint(TargetRequest(provider="openai-compatible")).base_url \
        == "http://from-env/v1"


def test_requesting_astra_as_a_target_is_refused():
    with pytest.raises(TargetResolutionError, match="judge-only"):
        resolve_endpoint(TargetRequest(provider="astra"))


# ----------------------------------------------------------------- catalogue


def test_catalogue_lookup_is_case_insensitive():
    assert resolve_target_spec("tgt-04").id == "TGT-04"
    assert resolve_target_spec("TGT-04").packs == ["PIN", "AGE", "CON"]


def test_no_target_id_selects_the_fixture():
    assert resolve_target_spec(None).id == "TGT-DEMO"


def test_unknown_target_id_raises_rather_than_defaulting():
    with pytest.raises(KeyError, match="unknown target id"):
        resolve_target_spec("TGT-99")


def test_every_catalogue_target_is_selectable():
    for spec in all_targets():
        assert resolve_target_spec(spec.id).id == spec.id


# --------------------------------------------------------------- API surface


@pytest.fixture(scope="module")
def api():
    port = allocate_port()
    with uvicorn_server(port=port) as base:
        yield base


def _wait_idle(api: str, timeout_s: float = 180) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        st = httpx.get(f"{api}/api/campaign/status", timeout=10).json()
        if not st["running"]:
            return st
        time.sleep(0.5)
    raise AssertionError("campaign did not finish")


def test_start_without_a_target_keeps_the_fixture(api):
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target_id"] == "TGT-DEMO"
    assert body["target_provider"] == "demo"
    _wait_idle(api)


def test_start_with_unknown_target_id_is_rejected(api):
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1,
                         "target": {"target_id": "TGT-99"}}, timeout=30)
    assert r.status_code == 400
    assert "unknown target id" in r.json()["error"]


def test_selected_target_scopes_the_packs_that_run(api):
    """TGT-04 allows PIN/AGE/CON, so an EXF request must not reach the target.

    Pack intersection existed in the runner but was unreachable while every
    campaign used TGT-DEMO, which allows all eight packs.
    """
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["PIN", "EXF"], "rounds": 1,
                         "target": {"target_id": "TGT-04"}}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["target_id"] == "TGT-04"
    st = _wait_idle(api)
    assert "PIN" in st["attempts_per_pack"], st["attempts_per_pack"]
    assert "EXF" not in st["attempts_per_pack"], (
        "EXF is not allowed on TGT-04 but attempts were made")


def test_api_rejects_an_astra_target_request(api):
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1,
                         "target": {"provider": "astra"}}, timeout=30)
    assert r.status_code == 400
    assert "judge-only" in r.json()["error"]


def test_bad_target_request_leaves_prior_results_intact(api):
    """Resolution happens before state reset, so a typo cannot wipe a report."""
    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1}, timeout=30)
    assert r.status_code == 200
    good = _wait_idle(api)
    assert good["attempts"] > 0

    r = httpx.post(f"{api}/api/campaign/start",
                   json={"packs": ["MEM"], "rounds": 1,
                         "target": {"target_id": "NOPE"}}, timeout=30)
    assert r.status_code == 400
    after = httpx.get(f"{api}/api/campaign/status", timeout=10).json()
    assert after["campaign_id"] == good["campaign_id"]
    assert after["attempts"] == good["attempts"]


# ------------------------------------------------------- confirmation binding


def test_confirmation_token_is_bound_to_the_selected_target():
    """A confirmation approved for the fixture must not start a campaign
    against a different target. The target lives in action params, so the
    action fingerprint already covers it -- this locks that in."""
    from redforge.operator.schemas import ActionKind, OperatorAction

    fixture = OperatorAction(kind=ActionKind.START_CAMPAIGN,
                             params={"rounds": 1, "target": {"target_id": "TGT-DEMO"}})
    live_asset = OperatorAction(kind=ActionKind.START_CAMPAIGN,
                                params={"rounds": 1, "target": {"target_id": "TGT-04"}})
    assert fixture.fingerprint() != live_asset.fingerprint()
