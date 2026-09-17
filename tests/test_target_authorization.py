"""Authorisation to test, and criticality that actually limits the run.

The allowlist in ``targets/egress.py`` answers "can this deployment reach that
host". These tests cover the other question — "did anyone approve attacking
it" — plus the two catalogue fields (``asset_criticality``,
``prod_safety_notes``) that used to be documentation nothing read.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from redforge.catalog.targets import resolve_target_spec
from redforge.schemas import BudgetCaps
from redforge.schemas.campaign import TargetRequest
from redforge.targets import get_target_adapter
from redforge.targets.authorization import (AuthorizationError, EngagementAuthorization,
                                            assert_authorized, load_authorizations)
from redforge.targets.safety import (caps_for_target, ceiling_for, clamped_fields,
                                     safety_briefing)

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
HUGE = BudgetCaps(max_attempts=600, max_tokens=50_000_000, max_cost_usd=100.0,
                  deadline_minutes=600)


def _record(**over) -> dict:
    base = {
        "target_id": "TGT-05",
        "owner": "platform-team@acme.example",
        "approver": "ciso@acme.example",
        "reference": "CHG-11821",
        "scope": ["api.acme.example"],
        "not_before": (NOW - timedelta(days=1)).isoformat(),
        "not_after": (NOW + timedelta(days=1)).isoformat(),
    }
    base.update(over)
    return base


def _file(tmp_path, *records) -> str:
    path = tmp_path / "authorizations.json"
    path.write_text(json.dumps(list(records)), encoding="utf-8")
    return str(path)


# ------------------------------------------------------- default-deny

def test_no_file_means_no_third_party_target_is_authorised():
    with pytest.raises(AuthorizationError) as err:
        assert_authorized("TGT-05", "https://api.acme.example/v1", path="", now=NOW)
    assert "RF_TARGET_AUTHORIZATIONS" in str(err.value)


@pytest.mark.parametrize("env_name", ["RF_TARGET_AUTHORIZATIONS",
                                      "RF_TARGET_AUTHORIZATIONS_PATH"])
def test_the_env_var_we_tell_operators_to_set_actually_loads(env_name, tmp_path,
                                                             monkeypatch):
    """Every other test monkeypatches the setting directly, which cannot catch
    the field name and the documented env var drifting apart. An operator who
    follows the deny message must get a configured path, not silent default-deny."""
    from redforge.config import Settings

    path = _file(tmp_path, _record())
    monkeypatch.delenv("RF_TARGET_AUTHORIZATIONS", raising=False)
    monkeypatch.delenv("RF_TARGET_AUTHORIZATIONS_PATH", raising=False)
    monkeypatch.setenv(env_name, path)
    assert Settings(_env_file=None).target_authorizations_path == path


def test_the_bundled_fixture_needs_no_approval():
    """It ships with the repo and is what the release gates attack."""
    assert assert_authorized("TGT-DEMO", "http://127.0.0.1:8901/v1",
                             path="", now=NOW) is None


def test_missing_file_is_an_error_not_an_empty_allowance():
    with pytest.raises(AuthorizationError) as err:
        assert_authorized("TGT-05", "https://api.acme.example/v1",
                          path="/nonexistent/authz.json", now=NOW)
    assert "not a file" in str(err.value)


# ------------------------------------------------------- scope + window

def test_a_covering_record_authorises_the_test(tmp_path):
    granted = assert_authorized("TGT-05", "https://api.acme.example/v1",
                                path=_file(tmp_path, _record()), now=NOW)
    assert granted is not None
    assert granted.owner == "platform-team@acme.example"
    assert granted.reference == "CHG-11821"


def test_approval_for_one_asset_does_not_cover_another(tmp_path):
    with pytest.raises(AuthorizationError) as err:
        assert_authorized("TGT-04", "https://api.acme.example/v1",
                          path=_file(tmp_path, _record()), now=NOW)
    assert "TGT-04" in str(err.value)


def test_host_outside_the_approved_scope_is_refused(tmp_path):
    with pytest.raises(AuthorizationError) as err:
        assert_authorized("TGT-05", "https://other.acme.example/v1",
                          path=_file(tmp_path, _record()), now=NOW)
    assert "outside the authorised scope" in str(err.value)


def test_wildcard_scope_covers_subdomains(tmp_path):
    path = _file(tmp_path, _record(scope=["*.acme.example"]))
    assert assert_authorized("TGT-05", "https://api.acme.example/v1",
                             path=path, now=NOW)


def test_expired_approval_is_refused(tmp_path):
    path = _file(tmp_path, _record(
        not_before=(NOW - timedelta(days=10)).isoformat(),
        not_after=(NOW - timedelta(days=1)).isoformat()))
    with pytest.raises(AuthorizationError) as err:
        assert_authorized("TGT-05", "https://api.acme.example/v1",
                          path=path, now=NOW)
    assert "not valid at" in str(err.value)


def test_approval_not_yet_in_force_is_refused(tmp_path):
    path = _file(tmp_path, _record(
        not_before=(NOW + timedelta(days=1)).isoformat(),
        not_after=(NOW + timedelta(days=5)).isoformat()))
    with pytest.raises(AuthorizationError):
        assert_authorized("TGT-05", "https://api.acme.example/v1",
                          path=path, now=NOW)


def test_naive_timestamps_are_read_as_utc():
    """A missing zone must not widen the window by the server's offset."""
    record = EngagementAuthorization(**_record(not_before="2026-09-15T00:00:00",
                                         not_after="2026-09-17T00:00:00"))
    assert record.not_before.tzinfo is not None
    assert record.window_contains(NOW)


def test_owner_and_approver_are_mandatory():
    for field in ("owner", "approver"):
        with pytest.raises(Exception):
            EngagementAuthorization(**_record(**{field: ""}))


def test_malformed_record_fails_loudly(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps([{"target_id": "TGT-05"}]), encoding="utf-8")
    with pytest.raises(AuthorizationError):
        load_authorizations(str(path))


def test_wrapped_object_form_is_accepted(tmp_path):
    path = tmp_path / "wrapped.json"
    path.write_text(json.dumps({"authorizations": [_record()]}), encoding="utf-8")
    assert len(load_authorizations(str(path))) == 1


# --------------------------------------------------- enforced at the factory

# An IP literal from the documentation range: allowlisted exactly, so these
# tests exercise the authorisation layer without depending on DNS.
HOST = "203.0.113.7"
URL = f"https://{HOST}/v1"


def _request() -> TargetRequest:
    return TargetRequest(target_id="TGT-05", provider="openai-compatible",
                         base_url=URL, api_key_env="RF_TARGET_CRED_ACME")


def test_building_an_unauthorised_adapter_is_refused(monkeypatch):
    """The check belongs where a client capable of attacking is created."""
    from redforge.config import settings

    monkeypatch.setattr(settings, "target_url_allowlist", HOST)
    monkeypatch.setattr(settings, "target_authorizations_path", "")
    monkeypatch.setenv("RF_TARGET_CRED_ACME", "sk-test-key")

    with pytest.raises(AuthorizationError):
        get_target_adapter(_request(), resolve_target_spec("TGT-05"))


def test_authorised_adapter_builds(monkeypatch, tmp_path):
    from redforge.config import settings

    now = datetime.now(timezone.utc)
    record = _record(scope=[HOST],
                     not_before=(now - timedelta(days=1)).isoformat(),
                     not_after=(now + timedelta(days=1)).isoformat())
    monkeypatch.setattr(settings, "target_url_allowlist", HOST)
    monkeypatch.setattr(settings, "target_authorizations_path",
                        _file(tmp_path, record))
    monkeypatch.setenv("RF_TARGET_CRED_ACME", "sk-test-key")

    adapter = get_target_adapter(_request(), resolve_target_spec("TGT-05"))
    assert adapter.base_url == URL


def test_an_expired_approval_blocks_a_reachable_allowlisted_host(monkeypatch, tmp_path):
    """Egress and authorisation are independent layers: passing the allowlist
    must not imply anyone approved the test."""
    from redforge.config import settings

    now = datetime.now(timezone.utc)
    record = _record(scope=[HOST],
                     not_before=(now - timedelta(days=30)).isoformat(),
                     not_after=(now - timedelta(days=2)).isoformat())
    monkeypatch.setattr(settings, "target_url_allowlist", HOST)
    monkeypatch.setattr(settings, "target_authorizations_path",
                        _file(tmp_path, record))
    monkeypatch.setenv("RF_TARGET_CRED_ACME", "sk-test-key")

    with pytest.raises(AuthorizationError) as err:
        get_target_adapter(_request(), resolve_target_spec("TGT-05"))
    assert "not valid at" in str(err.value)


def test_the_fixture_still_builds_with_no_authorisation_configured():
    """Release gates run unattended; the demo path must not need a file."""
    assert get_target_adapter() is not None


# --------------------------------------------- criticality -> budget caps

def test_criticality_lowers_the_ceiling():
    low = caps_for_target(resolve_target_spec("TGT-06"), HUGE)     # crit 3
    high = caps_for_target(resolve_target_spec("TGT-05"), HUGE)    # crit 5
    assert high.max_attempts < low.max_attempts
    assert high.max_tokens < low.max_tokens
    assert high.max_cost_usd < low.max_cost_usd
    assert high.deadline_minutes < low.deadline_minutes


def test_caps_are_clamped_never_raised():
    modest = BudgetCaps(max_attempts=5, max_tokens=1_000, max_cost_usd=0.5,
                        deadline_minutes=2)
    applied = caps_for_target(resolve_target_spec("TGT-01"), modest)
    assert applied.model_dump() == modest.model_dump()


def test_every_catalogue_target_is_bounded():
    for tid in [f"TGT-{n:02d}" for n in range(1, 11)] + ["TGT-DEMO"]:
        spec = resolve_target_spec(tid)
        applied = caps_for_target(spec, HUGE)
        limit = ceiling_for(spec.asset_criticality)
        assert applied.max_attempts <= limit.max_attempts
        assert applied.max_attempts < HUGE.max_attempts, tid


def test_clamping_is_reported_for_the_audit_trail():
    changed = clamped_fields(resolve_target_spec("TGT-05"), HUGE)
    assert changed["max_attempts"] == (600, 60)
    assert set(changed) == {"max_attempts", "max_tokens", "max_cost_usd",
                            "deadline_minutes"}


def test_out_of_range_criticality_is_clamped_into_the_table():
    assert ceiling_for(0) == ceiling_for(1)
    assert ceiling_for(99) == ceiling_for(5)


# --------------------------------------- prod_safety_notes becomes visible

def test_safety_notes_reach_the_briefing():
    briefing = safety_briefing(resolve_target_spec("TGT-10"))
    assert "Shadow tenant" in briefing
    assert "criticality 5/5" in briefing


def test_every_catalogue_target_briefs_its_constraint():
    for tid in [f"TGT-{n:02d}" for n in range(1, 11)]:
        spec = resolve_target_spec(tid)
        assert spec.prod_safety_notes.strip(), f"{tid} has no safety notes"
        assert spec.prod_safety_notes[:20] in safety_briefing(spec)
