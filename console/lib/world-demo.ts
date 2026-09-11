'use client';

// World demo timeline (D8) — when the live API is unreachable the world still
// lives: a scripted campaign loop (plan → recon → attempts/verdicts → gate →
// chain → score → end) is synthesized as the same LiveEvent shapes the SSE
// stream produces, so every instrument, physics effect and caption stays warm.

import { useEffect, useRef, useState } from 'react';
import type { LiveEvent } from '@/lib/live';

type DemoEvent = { type: string } & Record<string, unknown>;
type Step = DemoEvent | ((i: number) => DemoEvent);

const TECHS = [
  'PIN-001', 'PIN-003', 'EXF-002', 'OUT-001', 'AGE-003', 'MEM-002', 'CON-001',
  'HAL-002', 'SUP-001', 'PIN-006', 'EXF-005', 'OUT-003', 'AGE-005', 'MEM-001',
  'CON-004', 'HAL-001', 'SUP-002', 'PIN-009', 'EXF-007', 'AGE-001',
];

function buildScript(): Step[] {
  const s: Step[] = [
    { type: 'campaign_start', campaign_id: 'DEMO-WORLD', packs: ['PIN', 'EXF', 'OUT', 'AGE', 'MEM', 'CON', 'HAL', 'SUP'] },
    { type: 'mission_plan', packs: ['PIN', 'EXF', 'OUT', 'AGE', 'MEM', 'CON', 'HAL', 'SUP'] },
    { type: 'node_start', node: 'N0_mission_control' },
    { type: 'node_start', node: 'N1_recon' },
    { type: 'recon', shadow_tools: ['admin.export_all', 'internal.diagnose'] },
    { type: 'node_start', node: 'N2_attack_strategist' },
    { type: 'plan', attempts_planned: 40 },
    { type: 'node_start', node: 'N3_red_operators' },
  ];
  for (let i = 0; i < 18; i++) {
    const round = 1 + Math.floor(i / 6);
    const tech = TECHS[i % TECHS.length];
    const aid = `att-${String(i + 1).padStart(3, '0')}`;
    const seed = (i * 7) % 10;
    const combined = seed < 5 ? 'Success' : seed < 7 ? 'Close' : 'Fail';
    s.push({ type: 'attempt', attempt_id: aid, tech_id: tech, round, target_id: 'demo-copilot' });
    s.push({ type: 'verdict', attempt_id: aid, tech_id: tech, round, combined, escalated: seed === 4, rule: 'match', llm: 'agree' });
  }
  s.push(
    { type: 'node_start', node: 'N4_judge' },
    { type: 'node_end', node: 'N4_judge' },
    { type: 'gate_approved', gate_request_id: 'g1-demo', technique_id: 'EXF-005', gate_level: 'G1', approvals: ['operator', 'red-lead'] },
    { type: 'node_start', node: 'N5_mutator' },
    { type: 'mutation_stop', round: 3, gain: 0.02 },
    { type: 'node_start', node: 'N6_chain_builder' },
    { type: 'chain', techniques: ['PIN-001', 'MEM-002', 'EXF-002'], chain_id: 'kc-1' },
    { type: 'node_start', node: 'N7_verifier' },
    { type: 'node_start', node: 'N8_scorer' },
    { type: 'scorecard', scorecard: { total: 47.2, band: 'Poor' } },
    { type: 'report_ready', pdf_bytes: 7128 },
    { type: 'campaign_end', stopped_reason: 'completed', attempts: 18, findings: 9 },
  );
  return s;
}

export function useWorldDemo(active: boolean): LiveEvent[] {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!active) {
      setEvents([]);
      return;
    }
    const script = buildScript();
    let i = 0;
    let timer = 0;
    const step = () => {
      if (i >= script.length) {
        // end-tableau pause, then the world resets and runs again
        timer = window.setTimeout(() => {
          seq.current += 1;
          i = 0;
          setEvents([]);
          timer = window.setTimeout(step, 700);
        }, 6000);
        return;
      }
      const raw = typeof script[i] === 'function'
        ? (script[i] as (n: number) => DemoEvent)(i)
        : (script[i] as DemoEvent);
      seq.current += 1;
      const ev = { ...raw, seq: seq.current, ts: new Date().toISOString() } as LiveEvent;
      setEvents((prev) => [...prev.slice(-200), ev]);
      i += 1;
      timer = window.setTimeout(step, raw.type === 'attempt' || raw.type === 'verdict' ? 620 : 900);
    };
    timer = window.setTimeout(step, 400);
    return () => window.clearTimeout(timer);
  }, [active]);
  return events;
}
