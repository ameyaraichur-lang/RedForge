"""Does a real target actually support the campaign contract?

Everything else in ``tests/`` is hermetic — it runs against the bundled
fixture, needs no network, and is safe in CI and in the release gates. This
file is the opposite by design: it attacks an endpoint someone else operates,
so it is excluded from ``pytest`` by the ``conformance`` marker and only runs
when explicitly pointed at a target.

    RF_CONFORMANCE_BASE_URL=https://staging.acme.example/v1 \
    RF_CONFORMANCE_TARGET_ID=TGT-04 \
    RF_TARGET_CRED_CONFORMANCE=sk-... \
    RF_TARGET_URL_ALLOWLIST=staging.acme.example \
    RF_TARGET_AUTHORIZATIONS=/path/authorizations.json \
    RF_LLM_PROVIDER=demo \
    pytest -m conformance tests/conformance -v

The point is not to find vulnerabilities — that is what a campaign is for.
It is to answer, before anyone trusts a scorecard, two questions:

  1. Does this endpoint speak the protocol the adapter assumes?
  2. Which oracles does it expose, and therefore how much of a campaign
     against it can mean anything at all?

A target that fails the second question can still be scanned; the scorecard
will just report most of it as unobservable (see ``redforge.judge.oracles``).
These tests make that visible up front instead of at the end of a report.
"""
from __future__ import annotations

import os

import pytest

from redforge.judge.oracles import PACK_ORACLES, available_oracles, is_conclusive
from redforge.targets.adapter import OpenAICompatibleTarget

pytestmark = [pytest.mark.conformance, pytest.mark.asyncio]

BASE_URL = os.environ.get("RF_CONFORMANCE_BASE_URL", "")
TARGET_ID = os.environ.get("RF_CONFORMANCE_TARGET_ID", "TGT-CONFORMANCE")
API_KEY = os.environ.get("RF_TARGET_CRED_CONFORMANCE", "")

requires_target = pytest.mark.skipif(
    not BASE_URL,
    reason="set RF_CONFORMANCE_BASE_URL to the target you are authorised to test")


@pytest.fixture
def target() -> OpenAICompatibleTarget:
    return OpenAICompatibleTarget(BASE_URL.rstrip("/"), api_key=API_KEY)


# ------------------------------------------------------------ protocol

@requires_target
async def test_target_answers_a_benign_chat_turn(target):
    """The smallest possible probe: no attack payload, just the protocol."""
    reply = await target.call_chat(
        [{"role": "user", "content": "Reply with the single word: ready."}])
    assert reply.content, "target returned an empty completion"


@requires_target
async def test_target_keeps_a_session(target):
    """Multi-turn packs (MEM, chained PIN) assume conversation state."""
    first = await target.call_chat(
        [{"role": "user", "content": "Remember the word ORANGE."}],
        session_id="rf-conformance-session")
    second = await target.call_chat(
        [{"role": "user", "content": "Remember the word ORANGE."},
         {"role": "assistant", "content": first.content},
         {"role": "user", "content": "What word did I ask you to remember?"}],
        session_id="rf-conformance-session")
    assert second.content
    if "orange" not in second.content.lower():
        pytest.skip("target does not carry context; MEM results will be "
                    "inconclusive rather than wrong")


# ------------------------------------------------------------- oracles

@requires_target
async def test_report_which_oracles_this_target_exposes(target, capsys):
    """Not an assertion about security — a coverage inventory.

    Emits the per-pack conclusiveness this target permits, which is exactly
    what the scorecard's ``coverage`` will report for it.
    """
    reply = await target.call_chat(
        [{"role": "user", "content": "Reply with the single word: ready."}])

    try:
        tools = await target.list_tools()
        tool_visibility = bool(tools)
    except Exception:
        tool_visibility = False

    context = {
        "fixture_markers_valid": False,   # not our fixture
        "canary": "RF-CANARY-conformance",
        "tool_visibility": tool_visibility,
    }

    lines: list[str] = []
    unprovable: list[str] = []
    for pack in sorted(PACK_ORACLES):
        tech = f"{pack}-001"
        found = available_oracles(
            tech, payload="plant RF-CANARY-conformance", tokens_used=reply.tokens_used,
            context=context)
        ok = is_conclusive(tech, found)
        if not ok:
            unprovable.append(pack)
        lines.append(f"  {pack}: {'provable' if ok else 'UNPROVABLE'} "
                     f"(oracles: {', '.join(sorted(found)) or 'none'})")

    with capsys.disabled():
        print(f"\nOracle inventory for {TARGET_ID} at {BASE_URL}")
        print("\n".join(lines))
        if unprovable:
            print(f"  -> {len(unprovable)} pack(s) will report as inconclusive: "
                  f"{', '.join(unprovable)}")
        print(f"  -> token usage reported: {reply.tokens_used > 0}")
        print(f"  -> tool registry visible: {tool_visibility}")

    # The inventory is the deliverable. The only hard failure is a target that
    # can prove nothing at all, because a campaign against it cannot mean
    # anything and a scorecard for it would be theatre.
    assert len(unprovable) < len(PACK_ORACLES), (
        "this target exposes no oracle for any pack: no canary echo, no tool "
        "visibility, no usage metering. A campaign would be entirely "
        "inconclusive — instrument the target before scanning it.")


@requires_target
async def test_usage_metering_is_present_for_cost_packs(target):
    reply = await target.call_chat(
        [{"role": "user", "content": "Reply with the single word: ready."}])
    if reply.tokens_used <= 0:
        pytest.skip("target reports no token usage; CON results will be "
                    "inconclusive (see redforge.judge.oracles)")
    assert reply.tokens_used > 0
