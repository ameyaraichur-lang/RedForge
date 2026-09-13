"""M6b gate: Live API over a REAL uvicorn server (SSE stream included).
The in-process ASGITransport hangs on our streaming endpoint — the browser path
(EventSource → uvicorn) is the real contract, so we test exactly that."""
import json
import time

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server  # noqa: E402

PACKS = ["PIN", "EXF", "AGE"]  # fast subset; full 8-pack run is the E2E script


@pytest.fixture(scope="module")
def server():
    port = allocate_port()
    with uvicorn_server(port=port) as base:
        yield base


def test_health_and_catalog(server):
    h = httpx.get(f"{server}/api/health", timeout=10)
    assert h.status_code == 200 and h.json()["ok"] is True
    assert len(httpx.get(f"{server}/api/targets", timeout=30).json()) == 11
    assert len(httpx.get(f"{server}/api/techniques", timeout=30).json()) == 40


def test_sse_live_campaign_end_to_end(server):
    r = httpx.post(f"{server}/api/campaign/start",
                   json={"packs": PACKS, "rounds": 2}, timeout=30)
    assert r.status_code == 200
    cid = r.json()["campaign_id"]

    seen: list[str] = []
    scorecard = None
    with httpx.stream("GET", f"{server}/api/events/stream", timeout=300) as s:
        for line in s.iter_lines():
            if not line.startswith("data: "):
                continue
            e = json.loads(line[6:])
            seen.append(e["type"])
            if e["type"] == "scorecard":
                scorecard = e["scorecard"]
            if e["type"] == "campaign_end":
                break

    assert "campaign_start" in seen
    assert "node_start" in seen and "attempt" in seen and "verdict" in seen
    assert scorecard is not None and "total" in scorecard

    st = httpx.get(f"{server}/api/campaign/status", timeout=30).json()
    assert st["campaign_id"] == cid
    assert st["running"] is False
    assert st["stopped_reason"] == "completed"
    assert st["attempts"] > 0 and st["findings_confirmed"] >= 3
    assert {"PIN", "EXF", "AGE"} <= set(st["confirmed_packs"])

    f = httpx.get(f"{server}/api/findings", timeout=30).json()
    assert len(f) == st["findings_total"]
    assert all(x["evidence"] for x in f)

    g = httpx.get(f"{server}/api/gates", timeout=30).json()
    assert len(g) >= 1
    sig = httpx.post(f"{server}/api/gates/{g[0]['id']}/sign?signer=test-lead", timeout=30)
    assert sig.status_code == 200

    b = httpx.get(f"{server}/api/briefings", timeout=30).json()
    assert any("verdict" in x["text"].lower() or "complete" in x["text"].lower() for x in b)

    rep = httpx.get(f"{server}/api/report", timeout=60).json()
    assert rep["ready"] is True and "RF-F-" in rep["markdown"]

    ev = httpx.get(f"{server}/api/events?since=0", timeout=30).json()
    assert len(ev) >= st["events"] - 2  # replay endpoint mirrors the stream


def test_sse_subscriber_survives_campaign_restart(server):
    """Regression (M7): start() used to __init__() the LiveCampaign, wiping the
    subscriber queue set AND resetting seq to 1 — any SSE client connected
    BEFORE clicking start went silent (its stream gate drops e.seq <= sent,
    and a client that replayed history has sent >> 1). Subscribers must stay
    attached across a campaign restart, with seq monotonic."""
    # prime history so the replay path (sent > 0) is exercised too
    r0 = httpx.post(f"{server}/api/campaign/start",
                    json={"packs": ["MEM"], "rounds": 1}, timeout=30)
    assert r0.status_code == 200
    deadline = time.time() + 120
    while time.time() < deadline:
        st0 = httpx.get(f"{server}/api/campaign/status", timeout=10).json()
        if not st0["running"]:
            break
        time.sleep(0.5)

    seen: list[str] = []
    seqs: list[int] = []
    # everything with seq <= replay_max is replayed backlog; the new campaign
    # must deliver events with seq strictly above it on the SAME connection
    replay_max = max((e["seq"] for e in
                     httpx.get(f"{server}/api/events?since=0", timeout=30).json()), default=0)
    with httpx.stream("GET", f"{server}/api/events/stream", timeout=300) as s:
        # start a new campaign on the SAME open connection — exactly the
        # browser click-start path
        r = httpx.post(f"{server}/api/campaign/start",
                       json={"packs": ["MEM"], "rounds": 1}, timeout=30)
        assert r.status_code == 200
        for line in s.iter_lines():
            if not line.startswith("data: "):
                continue
            e = json.loads(line[6:])
            seen.append(e["type"])
            seqs.append(e["seq"])
            if e["type"] == "campaign_end" and e["seq"] > replay_max:
                break
    live_events = [t for t, s_ in zip(seen, seqs) if s_ > replay_max]
    assert live_events, "no live-published events arrived on the open stream (Q-12/Q-13 regression)"
    assert "campaign_start" in live_events, "subscriber dropped on restart (Q-12 regression)"
    assert "attempt" in live_events and "verdict" in live_events
    assert "campaign_end" in live_events
    assert all(b > a for a, b in zip(seqs, seqs[1:])), "seq must stay monotonic"


def test_abort_and_restart(server):
    a = httpx.post(f"{server}/api/campaign/abort", timeout=30).json()
    assert a["aborting"] is False  # idle
    # full 8-pack, 3 rounds — long enough to still be running at abort time
    r = httpx.post(f"{server}/api/campaign/start",
                   json={"packs": None, "rounds": 3}, timeout=30)
    assert r.status_code == 200
    a = httpx.post(f"{server}/api/campaign/abort", timeout=30).json()
    assert a["aborting"] is True
    deadline = time.time() + 15
    while time.time() < deadline:
        if not httpx.get(f"{server}/api/campaign/status", timeout=10).json()["running"]:
            break
        time.sleep(0.3)
    st = httpx.get(f"{server}/api/campaign/status", timeout=10).json()
    assert st["running"] is False and st["stopped_reason"] == "aborted"
    # restart allowed after abort
    r2 = httpx.post(f"{server}/api/campaign/start",
                    json={"packs": ["PIN"], "rounds": 1}, timeout=30)
    assert r2.status_code == 200
    deadline = time.time() + 120
    while time.time() < deadline:
        if not httpx.get(f"{server}/api/campaign/status", timeout=10).json()["running"]:
            break
        time.sleep(1)
    st = httpx.get(f"{server}/api/campaign/status", timeout=10).json()
    assert st["running"] is False and st["stopped_reason"] == "completed"
