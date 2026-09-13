# RedForge Console — Ops Mode (M6a)

Dark ops-themed console UI for the RedForge agent red-teaming framework. Ten screens driven entirely by typed fixture data (`lib/fixtures.ts`) — no backend required.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 (Next picks the next free port if 3000 is taken).

Production build:

```bash
npm run build
npm run start
```

## Screens

| Route | Screen |
|---|---|
| `/` | Orchestrator World View — 9 runtime agents + G1/G2 gates (manifest-driven) |
| `/mission` | Mission Control — 9-agent pipeline DAG (+ G1/G2 gates), live transcript (fixture stream), rounds, kill switch |
| `/findings` | Findings Explorer — 24 findings, filter chips, detail drawer with judge verdict breakdown |
| `/scorecard` | Weighted 6-dimension scorecard (total 46.5 · Poor · Level 2), bars + radar |
| `/dossier` | Regulatory Dossier — pack → control matrix (EU AI Act / ISO 42001 / NIST AI RMF / OWASP) |
| `/gates` | Gatekeeper Console — G1 inbox with ROAI scope checks and two-signature approval |
| `/targets` | Target Registry — 10 blueprint target classes + active demo target |
| `/techniques` | Technique Library — 40 techniques grouped by pack, gate levels, seed payloads |
| `/sentinel` | Regression timeline, per-pack drift, CI quality gate |
| `/admin` | MCP server board, RBAC roles, budget caps form, audit trail |

## Stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS v3 (no component library; plain CSS/SVG charts)
- `clsx` only runtime helper

All data is static fixtures for M6a; exports, CI triggers and cap writes are visual stubs. JARVIS-level UI (3D/voice) is out of scope for this milestone.
