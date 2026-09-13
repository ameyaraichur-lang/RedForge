#!/usr/bin/env python3
"""Minimal live E2E: demo target + Astra LLM judge via API campaign."""
from __future__ import annotations

import json
import sys
import time

import httpx

API = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"


def main() -> int:
    h = httpx.get(f"{API}/api/health", timeout=15)
    print(f"health: HTTP {h.status_code} {json.dumps(h.json())}")
    if h.status_code != 200 or not h.json().get("ok"):
        return 1

    health = h.json()
    if health.get("target_provider") == "astra" or health.get("target_adapter") == "astra":
        print("FAIL: Astra must not be the campaign target")
        return 1
    if health.get("judge_provider") != "astra" or health.get("judge_mode") != "astra":
        print("FAIL: expected Astra LLM judge to be active")
        return 1

    start = httpx.post(f"{API}/api/campaign/start",
                       json={"packs": ["PIN"], "rounds": 1}, timeout=30)
    print(f"start: HTTP {start.status_code} {json.dumps(start.json())}")
    if start.status_code != 200:
        return 1

    start_body = start.json()
    if start_body.get("target_id") != "TGT-DEMO" or start_body.get("target_provider") != "demo":
        print("FAIL: campaign must attack demo target, not Astra")
        return 1
    if start_body.get("judge_provider") != "astra":
        print("FAIL: campaign must use Astra judge")
        return 1

    cid = start_body["campaign_id"]
    seen_types: list[str] = []

    with httpx.stream("GET", f"{API}/api/events/stream", timeout=300) as stream:
        for line in stream.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            seen_types.append(event.get("type", "?"))
            if event.get("type") == "campaign_start":
                if event.get("target_provider") != "demo":
                    print("FAIL: campaign_start event has non-demo target")
                    return 1
            if event.get("type") == "campaign_end":
                break

    events = httpx.get(f"{API}/api/events?since=0", timeout=30).json()
    st = httpx.get(f"{API}/api/campaign/status", timeout=30).json()
    print(f"status: {json.dumps({k: st[k] for k in ('campaign_id','running','stopped_reason','attempts','verdicts','error')})}")

    verdict_events = [e for e in events if e.get("type") == "verdict"]
    start_events = [e for e in events if e.get("type") == "campaign_start"
                    and e.get("campaign_id") == cid]
    astra_judge_verdicts = [e for e in verdict_events if e.get("llm_judge") == "astra"]
    api_verdicts = httpx.get(f"{API}/api/verdicts", timeout=30).json()

    summary = {
        "campaign_id": cid,
        "target_provider": start_body.get("target_provider"),
        "target_id": start_body.get("target_id"),
        "judge_provider": start_body.get("judge_provider"),
        "health": health,
        "attempts": st.get("attempts"),
        "verdicts": st.get("verdicts"),
        "astra_judge_verdicts": len(astra_judge_verdicts),
        "stopped_reason": st.get("stopped_reason"),
        "stream_tail": seen_types[-8:],
        "sample_verdicts": verdict_events[:3],
        "api_verdicts_sample": api_verdicts[:3],
    }
    print("summary:", json.dumps(summary, indent=2))

    if st.get("error"):
        print(f"FAIL: campaign error {st['error']}")
        return 1
    if st.get("stopped_reason") not in ("completed", "budget_exhausted"):
        print(f"FAIL: unexpected stop {st.get('stopped_reason')}")
        return 1
    if st.get("attempts", 0) < 1:
        print("FAIL: no attempts recorded")
        return 1
    if not start_events or start_events[-1].get("target_provider") != "demo":
        print("FAIL: campaign did not start with demo target")
        return 1
    if len(astra_judge_verdicts) < 1:
        print("FAIL: no verdicts recorded with llm_judge=astra")
        return 1

    print("PASS: demo target + Astra judge campaign completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
