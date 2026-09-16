# RedForge — Agentic AI Red-Team Factory

**An autonomous red-team swarm that attacks LLM agent systems, adjudicates every attempt with a dual-mode judge, proves impact with canaries, and refuses to call an unobservable target secure — all from a cinematic "World View" console.**

![tests](https://img.shields.io/badge/pytest-357_passed-brightgreen) ![gates](https://img.shields.io/badge/milestone_gates-14%2F15-green) ![pass](https://img.shields.io/badge/pass_rate-99.7%25-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue) ![mode](https://img.shields.io/badge/provider-demo--first-orange)

![Live campaign in the World View](docs/screenshots/world-live-campaign.png)

## What this is

RedForge runs a **9-agent attack pipeline + 2 human gates** (11 runtime swarm nodes) against an LLM-driven target, end to end:

- **40 attack techniques** across 8 packs — `PIN` prompt injection, `EXF` exfiltration, `OUT` unsafe output, `AGE` agentic escalation, `MEM` memory poisoning, `CON` context manipulation, `HAL` hallucination, `SUP` shadow-tool abuse (OWASP LLM / MITRE ATLAS mapped)
- **Dual-mode judging** per attempt — deterministic rule detectors fused with an LLM judge, single-writer verdict combine, escalation to humans on disagreement
- **Canary-proven exfiltration** — seeded tokens + local webhook detector; a finding only says "exfiltrated" if a canary actually fired
- **Honest coverage, not flattering scores** — an attempt no oracle could observe is recorded as `Inconclusive` and removed from the scorecard denominator, so a target that reveals nothing scores as *unmeasured* rather than *secure* (see [Scoring honestly](#scoring-honestly))
- **Any OpenAI-compatible target** — pick a target per campaign from a 10-class catalogue, behind an egress allowlist, a credential-slot policy and a recorded authorisation to test (see [Attacking a real target](#attacking-a-real-target))
- **Bounded evolution** — ≤3 mutation rounds with marginal-gain cutoff, hard budget caps (attempts / tokens / USD) that tighten with the target's declared criticality
- **Human gates** — G1 (two-person rule before dangerous techniques) and G2 (release gate), countersigned in the UI
- **OPA-scored posture** — 6-dimension security scorecard computed by real Rego (Python fallback), weights per blueprint
- **Audit-grade reporting** — every report claim cites a finding id; citation lint, compliance mapping (EU AI Act / ISO 42001), markdown + PDF dossier
- **Evidence ledger** — SQLite store of findings/transcripts/verdicts with a FP-kill verifier

## The World View console

The console ships two experiences on one live SSE stream, and **every capability is reachable without WebGL**:

- **Ops Mode** (`/`) — dense, audit-grade: mission DAG, transcripts, findings explorer, gatekeeper console, scorecard, regulatory dossier, technique library, target registry (10 screens)
- **World View** (`/world`) — the screen *is* a 3D world: the **Orchestrator** (a humanoid bust assembled from ~12k molecules, featureless by design) asks if you're ready, then **summons his agents as distinct planets** — a banded gas giant for the operators, a tilted ice world for the judge, a golden star for the scorer. Campaigns play out as physics: pulses ride the links, verdicts ripple, gates flare, handoffs stream packets across blinking lines, while diegetic instruments (reactor gauges, fleet radar, audio waveform, MCP diagnostics, typewriter terminal, glass objective banner) float over the scene. Voice (keyless Web Speech) + ⌘K command core included.

The entry ritual — telemetry converging into form, the formed Orchestrator awaiting consent, then the summon:

![Assembling](docs/screenshots/entry-assembling.png) ![Orchestrator](docs/screenshots/entry-orchestrator.png) ![Summoning](docs/screenshots/entry-summoning.png)

Mission control on standby, and the same campaign controls in the text-only path:

![Mission control](docs/screenshots/world-mission-control.png)

![Text-only parity](docs/screenshots/text-only-parity.png)

Ops mode — the findings register and the gatekeeper console, every row carrying transcript + verdict evidence:

![Findings](docs/screenshots/ops-findings.png)

![Gatekeeper](docs/screenshots/ops-gatekeeper.png)

## Quickstart

Prerequisites: **Python 3.12+**, **Node 18+**, **[uv](https://docs.astral.sh/uv/)** (recommended). Optional: OPA binary for real Rego scoring (a Python fallback is built in). No LLM API keys needed — RedForge is **demo-first** (decision D3): it attacks a bundled *vulnerable demo copilot* and the LLM judge runs as a deterministic stub. Add real keys later via `.env` to unlock live-LLM judging.

Versioning: `release.toml` is the single source of truth (`0.8.0` + codename `m8-ritual` → Python `0.8.0+m8.ritual`, npm `0.8.0-m8-ritual`). Run `python scripts/verify_versions.py` to check drift.

```bash
# 1) engine (reproducible lock)
uv sync --group dev                # uses uv.lock; or: pip install -e ".[dev]"

# 2) Live API  (:8000)
RF_LLM_PROVIDER=demo python -m uvicorn redforge.api.server:app --host 127.0.0.1 --port 8000

# 3) console   (:3100)
cd console
npm ci                           # reproducible from package-lock.json
npm run build && npm run start -- -p 3100

# 4) open the world
#    http://localhost:3100/world        (ritual boot → YES → mission control)
#    http://localhost:3100/             (ops mode)
```

> Set `RF_LLM_PROVIDER=demo` unless you intend to spend money. With a real provider configured, the LLM judge is consulted on every attempt.

Headless verification of everything:

```bash
python -m pytest -q                     # 357 tests (7 optional skips; conformance deselected)
python scripts/verify_versions.py       # release.toml drift guard
python scripts/run_gates.py             # 15 milestone gates + pass rate
python scripts/run_e2e.py               # headless CLI end-to-end campaign
python scripts/e2e_console.py           # full campaign driven through the World View UI (Playwright)

# Opt-in live Astra judge smoke (paid Azure — never CI):
RF_LIVE_ASTRA=1 python -m pytest -m live_astra -v
```

The two browser-driven gates (`M6c`) launch several Next servers plus Chromium and are sensitive to machine load; on a CPU-saturated host they time out even though the flows pass when run individually.

## Attacking a real target

By default every campaign hits the bundled fixture. Pointing RedForge at a real system is deliberately gated, because the failure mode is attacking the wrong asset — or someone else's.

Select a target per campaign by catalogue id, and four independent layers must agree:

```bash
# 1) the deployment must be allowed to reach the host at all
export RF_TARGET_URL_ALLOWLIST="staging.acme.example"

# 2) credentials come from dedicated slots, never arbitrary server env
export RF_TARGET_CRED_ACME="sk-..."

# 3) someone must have approved the test, in writing, with an expiry
export RF_TARGET_AUTHORIZATIONS="/etc/redforge/authorizations.json"
```

```json
[
  {
    "target_id": "TGT-04",
    "owner": "platform-team@acme.example",
    "approver": "ciso@acme.example",
    "reference": "CHG-11821",
    "scope": ["staging.acme.example"],
    "not_before": "2026-09-01T00:00:00Z",
    "not_after":  "2026-09-30T00:00:00Z"
  }
]
```

```bash
curl -X POST localhost:8000/api/campaign/start \
  -H 'content-type: application/json' \
  -d '{"rounds":1,"target":{"target_id":"TGT-04",
        "provider":"openai-compatible",
        "base_url":"https://staging.acme.example/v1",
        "api_key_env":"RF_TARGET_CRED_ACME"}}'
```

What each layer refuses, independently:

| Layer | Refuses |
| --- | --- |
| Authentication | choosing a target without an operator session |
| Egress allowlist | hosts you did not list, and names resolving into private/loopback/link-local ranges |
| Credential slots | `api_key_env` naming anything outside `RF_TARGET_CRED_*`, so a campaign cannot read arbitrary server secrets |
| Authorisation | any non-fixture target with no recorded approval covering that host *and* that moment |

A request body never carries a secret — only the *name* of a slot — because the body is echoed into campaign events and archived in the evidence bundle, and the `EXF` pack exists precisely to make systems disclose the context they were handed.

The target's declared `asset_criticality` then clamps the run's budget caps (criticality 5 drops 600 attempts to 60), and the clamp is reported rather than applied silently. **Astra is judge-only** and is refused as a target in the config, the registry and the factory.

Before trusting any score, check what the target can even prove:

```bash
RF_CONFORMANCE_BASE_URL=https://staging.acme.example/v1 \
RF_TARGET_CRED_CONFORMANCE=sk-... \
python -m pytest -m conformance tests/conformance -v -s
```

This reports a per-pack oracle inventory — whether canaries echo, whether the tool registry is visible, whether token usage is metered. Conformance tests reach a third party, so they are excluded from `pytest` and from every gate by marker; `tests/test_gates_hermetic.py` pins that boundary.

## Scoring honestly

A dimension used to be scored `100 × (1 − successes / attempts)`, which quietly treats *every* attempt that produced no finding as an attack the target neutralised. Against the bundled fixture that inference is sound: every technique has a seeded flaw, so no signal really does mean the attack failed. Against someone else's agent it is false — "no signal" also covers "nothing here could tell us either way" — and it hands a high grade to any target that reveals nothing. A deliberately opaque target that refused every prompt and exposed no tool log or usage graded **93.0 "Good"**.

RedForge now names the proof sources ("oracles") each pack depends on and records which were actually available:

- the flaw contract's marker strings are the *bundled simulator's own text*, so they only count against the fixture
- a canary is an oracle only when the attempt actually planted it
- `AGE`/`SUP` need tool visibility, `CON` needs usage metering, `EXF`/`OUT` have target-independent patterns (PII, credential shapes, stack traces, payload echo)

An attempt with no oracle becomes `Inconclusive` — and an LLM cannot upgrade it, because a model inferring "looks refused" from evidence it cannot verify is an opinion, not an oracle. Those attempts leave the denominator and reappear as `coverage`, `unscored_dimensions`, a weight-renormalised `total_observed`, and a `band_caveat` printed where the grade is read. The Verifier also no longer voids a finding whose replay was unobservable, which had been quietly deleting real findings on opaque targets.

Because the fixture has a marker oracle for every pack, the demo run is unchanged: **48.9 Poor, 36/36 findings confirmed, 8/8 packs, coverage 1.0**.

`HAL` is the honest casualty: its only oracle is the fixture's own markers, because detecting hallucination needs ground truth about the world that no transcript signal supplies. Off the fixture, every `HAL` attempt reports inconclusive rather than passing silently.

## Repo layout

```
redforge/            the engine package
  schemas/           finding / transcript / verdict / campaign models
  contracts/         40 flaw specs + tool registries (documented vs shadow)
  catalog/           techniques + seeds, packs, targets, scorecard model
  targets/           vulnerable demo copilot + adapter plane
    protocol.py      TargetAdapter contract (what a campaign can attack)
    registry.py      provider-id registry; Astra refused here
    egress.py        URL allowlist, SSRF guard, credential-slot policy
    authorization.py authorisation-to-test records (owner/scope/window)
    safety.py        asset_criticality -> budget-cap ceilings
  judge/             rule detectors + LLM judge + verdict combine
    oracles.py       what could have proved or disproved an attempt
  scoring/           scorecard engine, severity matrix, OPA/Rego runner
  canary/            canary minting, webhook listener, proof
  evidence/          sqlite evidence store + verifier
  swarm/             9-agent campaign engine + G1/G2 gates + bounded mutator
  reporting/         compliance controls, citation lint, PDF renderer
  mcp_servers/       6 P0 MCP servers (target-adapter, pyrit, judge, canary, opa, evidence)
  api/               Live API: SSE event bus, gates, findings, report
console/             Next.js 15 console (ops mode + world view, react-three-fiber)
scripts/             gates runner, CLI e2e, console e2e, visual capture
tests/               357 tests incl. real-uvicorn SSE suite
  conformance/       opt-in: attacks a real external target
docs/                blueprint workbook, project memory, screenshots
```

## MCP-first surface

Six MCP servers expose the factory to agents and IDEs: `demo_chat` / `call_target_tool` (attack the target), seed corpora + PyRIT import, `judge_attempt`, canary mint/prove, OPA scorecard + severity, evidence store queries. Register them from `redforge/mcp_servers/README.md`.

## Deferred by design

- **Real LLM keys** — drop into `.env` and flip the provider to activate the LLM half of judging
- **Docker** — optional; SQLite/filesystem substitutions are built in (decision D4)
- **Hallucination oracles** — `HAL` needs an external ground-truth source to be provable off the fixture
- **Regulatory dimension** — the evidence-mapping hook returns `None` until M5 lands, so that dimension shows the workbook baseline and is excluded from `total_observed`

## License

MIT — see [LICENSE](LICENSE).
