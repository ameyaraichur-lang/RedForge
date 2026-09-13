// ---------------------------------------------------------------------------
// World bus (D8) — the event→physics bridge. Live SSE events are ingested once
// and reduced into frame-friendly mutable state (pulses, impacts, blips,
// counters). React never re-renders per frame: the 3D scene reads this object
// inside useFrame, the DOM instruments sample it at a few Hz.
// Replay resets the bus and re-ingests a prefix of the event list.
// ---------------------------------------------------------------------------

import { MANIFEST_EDGE_COUNT, PULSE_CHANNELS } from '@/lib/world-theme';
import type { LiveEvent } from '@/lib/live';

export type WorldPulse = { edge: number; t: number; speed: number; color: string };
export type WorldImpact = { node: string; t: number; color: string; strength: number };
export type WorldBlip = { a: number; r: number; born: number; hot: boolean };
/** One agent→agent handoff: node_end(A) followed by node_start(B). Fired ONCE. */
export type WorldHandoff = { from: string; to: string; t: number };

export type WorldCounters = {
  attempts: number;
  verdicts: number;
  successes: number;
  escalated: number;
  gatesApproved: number;
  gatesDenied: number;
  chains: number;
  uniqueTechs: Set<string>;
  uniqueHits: Set<string>;
  round: number;
  ended: boolean;
  stoppedReason: string | null;
  scoreTotal: number | null;
  scoreBand: string | null;
};

const TARGET_TECHNIQUES = 40; // full catalog size (blueprint)

class WorldBus {
  pulses: WorldPulse[] = [];
  impacts: WorldImpact[] = [];
  blips: WorldBlip[] = [];
  handoffs: WorldHandoff[] = [];
  private lastNodeEnd: string | null = null;
  coreEnergy = 0; // 0..1 — excites the orb, decays each frame
  alert = 0; // red rim flash (escalations)
  settle = 0; // campaign_end tableau
  nodeGlow: Record<string, number> = {};
  counters: WorldCounters = WorldBus.freshCounters();

  static freshCounters(): WorldCounters {
    return {
      attempts: 0, verdicts: 0, successes: 0, escalated: 0, gatesApproved: 0,
      gatesDenied: 0, chains: 0, uniqueTechs: new Set(), uniqueHits: new Set(),
      round: 0, ended: false, stoppedReason: null, scoreTotal: null, scoreBand: null,
    };
  }

  reset(): void {
    this.pulses = [];
    this.impacts = [];
    this.blips = [];
    this.handoffs = [];
    this.lastNodeEnd = null;
    this.coreEnergy = 0;
    this.alert = 0;
    this.settle = 0;
    this.nodeGlow = {};
    this.counters = WorldBus.freshCounters();
  }

  spawnPulse(edge: number, color: string, speed = 0.55): void {
    if (edge < 0 || edge >= MANIFEST_EDGE_COUNT) return;
    if (this.pulses.length > 48) this.pulses.shift();
    this.pulses.push({ edge, t: 0, speed, color });
  }

  private spawnImpact(node: string, color: string, strength = 1): void {
    if (this.impacts.length > 24) this.pulses.shift();
    this.impacts.push({ node, t: 0, color, strength });
  }

  private spawnBlip(tech: string, hot: boolean, now: number): void {
    // deterministic-ish bearing from tech id hash + pack override happens by caller
    let h = 0;
    for (let i = 0; i < tech.length; i++) h = (h * 31 + tech.charCodeAt(i)) >>> 0;
    const a = (h % 360) * (Math.PI / 180);
    const r = 0.3 + ((h >> 9) % 70) / 100;
    this.blips.push({ a, r, born: now, hot });
    if (this.blips.length > 26) this.blips.shift();
  }

  ingest(e: LiveEvent): void {
    const c = this.counters;
    switch (e.type) {
      case 'campaign_start':
      case 'mission_plan':
        this.coreEnergy = Math.min(1, this.coreEnergy + 0.5);
        this.spawnImpact('N0_mission_control', '#7fe7ff', 1);
        break;
      case 'recon':
        this.spawnImpact('N1_recon', '#f5b841', 1);
        break;
      case 'plan':
        this.spawnImpact('N2_attack_strategist', '#ff8c4d', 1);
        break;
      case 'node_start':
        if (typeof e.node === 'string') {
          // handoff: previous agent finished → this one triggers (once per pair)
          if (this.lastNodeEnd && this.lastNodeEnd !== e.node) {
            this.handoffs.push({ from: this.lastNodeEnd, to: e.node, t: 0 });
            if (this.handoffs.length > 6) this.handoffs.shift();
          }
          this.lastNodeEnd = null;
          this.spawnImpact(e.node, '#ffffff', 0.7);
          this.nodeGlow[e.node] = 1;
        }
        break;
      case 'node_end':
        if (typeof e.node === 'string') {
          this.lastNodeEnd = e.node;
          this.nodeGlow[e.node] = 0.4;
        }
        break;
      case 'attempt': {
        c.attempts += 1;
        if (typeof e.round === 'number') c.round = Math.max(c.round, e.round);
        if (typeof e.tech_id === 'string') c.uniqueTechs.add(e.tech_id);
        this.coreEnergy = Math.min(1, this.coreEnergy + 0.06);
        const ch = PULSE_CHANNELS.attempt[c.attempts % PULSE_CHANNELS.attempt.length];
        this.spawnPulse(ch, '#ff4d9d', 0.8);
        this.spawnImpact('N3_red_operators', '#ff4d9d', 0.5);
        this.spawnBlip(String(e.tech_id ?? ''), false, c.attempts);
        break;
      }
      case 'verdict': {
        c.verdicts += 1;
        const ok = e.combined === 'Success';
        const close = e.combined === 'Close';
        if (ok) {
          c.successes += 1;
          if (typeof e.tech_id === 'string') c.uniqueHits.add(e.tech_id);
        }
        if (e.escalated) {
          c.escalated += 1;
          this.alert = 1;
        }
        this.spawnImpact('N4_judge', ok ? '#3bff9e' : close ? '#f5b841' : '#5f7ba6', ok ? 1.2 : 0.7);
        if (ok) this.spawnBlip(String(e.tech_id ?? ''), true, c.verdicts);
        break;
      }
      case 'gate_approved': {
        c.gatesApproved += 1;
        const isG2 = e.gate_level === 'G2';
        this.spawnImpact(isG2 ? 'G2_release' : 'G1_gatekeeper', '#3bff9e', isG2 ? 1.6 : 1.4);
        for (const ch of (isG2 ? PULSE_CHANNELS.gate : [8])) this.spawnPulse(ch, isG2 ? '#8fd4ff' : '#3bff9e', isG2 ? 0.65 : 0.5);
        break;
      }
      case 'gate_denied':
        c.gatesDenied += 1;
        this.spawnImpact('G1_gatekeeper', '#ff4d6d', 1.2);
        break;
      case 'chain':
        c.chains += 1;
        this.coreEnergy = Math.min(1, this.coreEnergy + 0.25);
        for (const ch of PULSE_CHANNELS.chain) this.spawnPulse(ch, '#5ea0ff', 0.9);
        this.spawnImpact('N6_chain_builder', '#5ea0ff', 1);
        break;
      case 'mutation_stop':
        this.spawnImpact('N5_mutator', '#9d5cff', 0.8);
        break;
      case 'budget_exhausted':
        this.alert = 1;
        break;
      case 'scorecard': {
        const sc = e.scorecard as { total?: number; band?: string } | undefined;
        c.scoreTotal = typeof sc?.total === 'number' ? sc.total : c.scoreTotal;
        c.scoreBand = typeof sc?.band === 'string' ? sc.band : c.scoreBand;
        this.spawnImpact('N8_scorer', '#ffd166', 1.2);
        break;
      }
      case 'campaign_end':
        c.ended = true;
        c.stoppedReason = typeof e.stopped_reason === 'string' ? e.stopped_reason : null;
        this.settle = 1;
        this.coreEnergy = 0.35;
        break;
      default:
        break;
    }
  }

  /** Advance physics. dt in seconds. Returns nothing — mutate in place. */
  tick(dt: number): void {
    this.coreEnergy = Math.max(0, this.coreEnergy - dt * 0.12);
    this.alert = Math.max(0, this.alert - dt * 0.5);
    for (const p of this.pulses) p.t += dt * p.speed;
    this.pulses = this.pulses.filter((p) => p.t <= 1);
    for (const i of this.impacts) i.t += dt * 1.1;
    this.impacts = this.impacts.filter((i) => i.t <= 1);
    for (const h of this.handoffs) h.t += dt * 0.8; // ~1.25s handoff life
    this.handoffs = this.handoffs.filter((h) => h.t <= 1);
    for (const k of Object.keys(this.nodeGlow)) {
      this.nodeGlow[k] = Math.max(0, this.nodeGlow[k] - dt * 0.25);
    }
    // blips fade by age in seconds — DOM radar samples `born` against a wall clock
  }

  coverage(): { target: number; hit: number; gap: number } {
    const hit = this.counters.uniqueHits.size;
    return { target: TARGET_TECHNIQUES, hit, gap: Math.max(0, TARGET_TECHNIQUES - hit) };
  }
}

/** Module singleton — imported by the scene, the bridge and the instruments. */
export const worldBus = new WorldBus();
