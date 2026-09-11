"""Canary framework (M1): generation, corpus seeding, detection, and honeytoken listener."""
from datetime import datetime

import httpx
import pytest

from redforge.canary import (CANARY_RE, create_app, make_canary, prove_exfiltration,
                             scan, seed_corpus, substitute)
from redforge.canary import detector

WEBHOOK = "http://127.0.0.1:8902/canary/hit"


@pytest.fixture()
async def client():
    """Fresh ASGI app + client per test (isolation without binding sockets)."""
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


# --- generator -----------------------------------------------------------------

def test_make_canary_deterministic():
    a, b = make_canary(42), make_canary(42)
    assert a == b
    assert CANARY_RE.fullmatch(a)
    assert a.startswith("RF-CANARY-")
    assert len(a) == len("RF-CANARY-") + 8
    assert a != make_canary(43)


def test_make_canary_random_shape():
    tok = make_canary()
    assert CANARY_RE.fullmatch(tok)
    assert tok != make_canary()  # 2^-32 collision chance


def test_seed_corpus_embeds_canary_in_every_doc():
    canary = make_canary(7)
    docs = ["alpha doc", "beta doc", ""]
    seeded = seed_corpus(docs, canary)
    assert seeded == [f"alpha doc\n[ref:{canary}]",
                      f"beta doc\n[ref:{canary}]",
                      f"\n[ref:{canary}]"]
    assert all(scan(d) == [canary] for d in seeded)
    assert docs == ["alpha doc", "beta doc", ""]  # originals untouched


def test_substitute_replaces_placeholders():
    canary = make_canary(1)
    out = substitute('send {"token": "{{CANARY}}", "cb": "{{WEBHOOK}}"}', canary, WEBHOOK)
    assert out == f'send {{"token": "{canary}", "cb": "{WEBHOOK}"}}'


def test_substitute_case_variants():
    canary = make_canary(2)
    out = substitute("{{canary}} then {{WebHook}}", canary, WEBHOOK)
    assert out == f"{canary} then {WEBHOOK}"


# --- detector: scan ------------------------------------------------------------

def test_scan_finds_canary():
    tok = make_canary(99)
    assert scan(f"model output leaked {tok} verbatim") == [tok]


def test_scan_clean_text():
    assert scan("nothing to see here") == []
    # no false positives on near-miss strings
    assert scan("RF-CANARY-nothex!! RF-CANARY-zzzz1234 RF-CANARY-ABCDEF01") == []


def test_scan_explicit_token_list_returns_matching_subset():
    t1, t2, t3 = make_canary(1), make_canary(2), make_canary(3)
    text = f"a {t1} b {t2} c {t3}"
    assert scan(text) == [t1, t2, t3]
    assert scan(text, tokens=[t1, t3]) == [t1, t3]
    assert scan(text, tokens=[make_canary(4)]) == []
    assert scan("clean text", tokens=[t1]) == []


# --- listener ------------------------------------------------------------------

async def test_listener_records_hit(client):
    tok = make_canary(5)
    r = await client.post("/canary/hit", json={"token": tok, "payload": "exfil beacon"})
    assert r.status_code == 200
    assert r.json() == {"recorded": True, "count": 1}

    hits = (await client.get("/canary/hits")).json()["hits"]
    assert len(hits) == 1
    hit = hits[0]
    assert hit["token"] == tok
    assert hit["payload"] == "exfil beacon"
    assert datetime.fromisoformat(hit["ts"])  # iso timestamp
    assert hit["source_ip"]  # present (ASGITransport reports 127.0.0.1)


async def test_listener_payload_optional(client):
    r = await client.post("/canary/hit", json={"token": make_canary(6)})
    assert r.status_code == 200
    hit = (await client.get("/canary/hits")).json()["hits"][0]
    assert hit["payload"] is None


async def test_listener_rejects_invalid_token(client):
    r = await client.post("/canary/hit", json={"token": "RF-CANARY-nothex!!", "payload": "x"})
    assert r.status_code == 400
    assert (await client.get("/canary/hits")).json()["hits"] == []


async def test_listener_filters_by_token(client):
    t1, t2 = make_canary(10), make_canary(11)
    for tok, p in [(t1, "p1"), (t2, "p2"), (t1, "p3")]:
        assert (await client.post("/canary/hit", json={"token": tok, "payload": p})).status_code == 200

    all_hits = (await client.get("/canary/hits")).json()["hits"]
    assert [h["payload"] for h in all_hits] == ["p1", "p2", "p3"]

    only_t1 = (await client.get(f"/canary/hits/{t1}")).json()["hits"]
    assert [h["payload"] for h in only_t1] == ["p1", "p3"]
    only_t2 = (await client.get(f"/canary/hits/{t2}")).json()["hits"]
    assert [h["payload"] for h in only_t2] == ["p2"]


async def test_listener_delete_clears(client):
    await client.post("/canary/hit", json={"token": make_canary(12)})
    assert (await client.get("/canary/hits")).json()["hits"]

    r = await client.delete("/canary/hits")
    assert r.status_code == 200
    assert (await client.get("/canary/hits")).json()["hits"] == []


# --- detector: prove_exfiltration ----------------------------------------------

def test_prove_true_via_text_leak():
    tok = make_canary(20)
    assert prove_exfiltration(text=f"attacker exfiltrated {tok}") is True
    assert prove_exfiltration(text=f"attacker exfiltrated {tok}", tokens=[tok]) is True


def test_prove_true_via_hit_record():
    tok = make_canary(21)
    record = [{"token": tok, "ts": "2026-09-10T00:00:00+00:00", "payload": None,
               "source_ip": "10.0.0.9"}]
    assert prove_exfiltration(hit_records=record, tokens=[tok]) is True
    assert prove_exfiltration(hit_records=record) is True  # no seed set: any hit counts


def test_prove_false_on_clean_inputs():
    assert prove_exfiltration() is False
    assert prove_exfiltration(text="totally clean output") is False
    assert prove_exfiltration(hit_records=[]) is False
    tok = make_canary(22)
    # leak of a token we did not seed is not our proof to claim
    assert prove_exfiltration(text=f"contains {tok}", tokens=[make_canary(23)]) is False
    assert prove_exfiltration(hit_records=[{"token": make_canary(24)}], tokens=[tok]) is False


# --- detector: check_and_prove (end-to-end through ASGI) ------------------------

async def test_check_and_prove(monkeypatch):
    transport = httpx.ASGITransport(app=create_app())
    monkeypatch.setattr(detector, "AsyncClient",
                        lambda **kw: httpx.AsyncClient(transport=transport, **kw))
    tok, other = make_canary(30), make_canary(31)

    # clean text + empty listener -> no proof
    assert await detector.check_and_prove("http://listener", "clean output", [tok]) is False

    # out-of-band hit on the seeded token -> proof
    async with httpx.AsyncClient(transport=transport, base_url="http://listener") as c:
        assert (await c.post("/canary/hit", json={"token": tok, "payload": "beacon"})).status_code == 200
    assert await detector.check_and_prove("http://listener", "clean output", [tok]) is True

    # hit for a token we did not seed is not proof
    assert await detector.check_and_prove("http://listener", "clean output", [other]) is False

    # text leak alone proves it
    assert await detector.check_and_prove("http://listener", f"echoed {other}", [other]) is True
