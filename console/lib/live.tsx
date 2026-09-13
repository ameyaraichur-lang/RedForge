'use client';

// ---------------------------------------------------------------------------
// RedForge live campaign client (M6b): one context owns the SSE stream, the
// status poll, campaign control and HUD/voice prefs. Every screen reads this;
// when the API is unreachable the console silently falls back to fixtures.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type LiveEvent = { seq: number; ts: string; type: string } & Record<string, unknown>;

export type LiveScorecard = {
  total: number;
  band: string;
  maturity?: string;
  contributions?: Record<string, number>;
  actuals?: Record<string, number>;
};

export type LiveStatus = {
  running: boolean;
  campaign_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  stopped_reason: string | null;
  error: string | null;
  events: number;
  attempts: number;
  attempts_per_pack: Record<string, number>;
  verdicts: number;
  successes: number;
  findings_total: number;
  findings_confirmed: number;
  findings_voided: number;
  confirmed_packs: string[];
  scorecard: LiveScorecard | null;
  budget: { attempts: number; tokens: number; cost_usd: number } | null;
  rounds_executed: number | null;
  briefings: number;
};

export type LiveFinding = {
  id: string;
  campaign_id: string;
  technique_id: string;
  target_id: string;
  title: string;
  narrative: string;
  severity: string;
  status: string;
  confidence: number;
  human_confirmed: boolean;
  evidence: { kind: string; uri: string }[];
};

export type LiveGate = {
  id: string;
  kind: string;
  technique_ids: string[];
  justification: string;
  approvals: string[];
  decided: boolean;
};

export type NodeState = 'pending' | 'active' | 'complete' | 'blocked';

type LiveContextValue = {
  connected: boolean;
  connecting: boolean;
  status: LiveStatus | null;
  events: LiveEvent[];
  briefings: { text: string; ts: string }[];
  lastBriefing: { text: string; ts: string } | null;
  hudMode: boolean;
  voiceOn: boolean;
  setHudMode: (v: boolean) => void;
  setVoiceOn: (v: boolean) => void;
  start: (packs: string[] | null, rounds: number) => Promise<void>;
  abort: () => Promise<void>;
  signGate: (gateId: string, signer: string) => Promise<void>;
  refreshFindings: () => Promise<LiveFinding[]>;
  refreshGates: () => Promise<LiveGate[]>;
};

const LiveContext = createContext<LiveContextValue | null>(null);

const MAX_EVENTS = 4000;

// Same-origin SSE via the runtime API route handler (streams without buffering).
const SSE_URL = '/api/events/stream';

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [briefings, setBriefings] = useState<{ text: string; ts: string }[]>([]);
  const [hudMode, setHudModeState] = useState(false);
  const [voiceOn, setVoiceOnState] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const briefCountRef = useRef(0);
  // SSE bursts (replay + ~15 events/s during a campaign) would re-render the
  // whole tree — including the 3D world labels — per event. Buffer and flush
  // at 4 Hz: one state update per tick regardless of event rate.
  const pendingEvents = useRef<LiveEvent[]>([]);

  // ------------------------------------------------------------- prefs
  useEffect(() => {
    setHudModeState(window.localStorage.getItem('rf-hud') === '1');
    setVoiceOnState(window.localStorage.getItem('rf-voice') === '1');
  }, []);
  const setHudMode = useCallback((v: boolean) => {
    setHudModeState(v);
    window.localStorage.setItem('rf-hud', v ? '1' : '0');
  }, []);
  const setVoiceOn = useCallback((v: boolean) => {
    setVoiceOnState(v);
    window.localStorage.setItem('rf-voice', v ? '1' : '0');
  }, []);

  // ------------------------------------------------------- health probe
  useEffect(() => {
    let alive = true;
    let timer: number;
    const probe = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        if (j?.ok) {
          setConnected(true);
          setConnecting(false);
          return; // stop probing once up
        }
      } catch {
        /* down */
      }
      if (alive) timer = window.setTimeout(probe, 4000);
    };
    probe();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  // ------------------------------------------------------ status polling
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/campaign/status', { cache: 'no-store' });
        const s: LiveStatus = await r.json();
        if (!alive) return;
        setStatus(s);
        // briefing feed (voice + toasts)
        const br = await (await fetch('/api/briefings', { cache: 'no-store' })).json();
        if (Array.isArray(br) && br.length > briefCountRef.current) {
          const fresh = br.slice(briefCountRef.current);
          briefCountRef.current = br.length;
          setBriefings((prev) => [...prev, ...fresh].slice(-40));
        }
      } catch {
        if (alive) setConnected(false);
      }
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [connected]);

  // ---------------------------------------------------------- SSE stream
  useEffect(() => {
    if (!connected) return;
    const es = new EventSource(SSE_URL);
    esRef.current = es;
    es.onmessage = (m) => {
      try {
        const ev: LiveEvent = JSON.parse(m.data);
        pendingEvents.current.push(ev);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; health poll catches a dead server */
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [connected]);

  // buffered flush — bounds re-render rate under event bursts
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pendingEvents.current.length === 0) return;
      const batch = pendingEvents.current;
      pendingEvents.current = [];
      setEvents((prev) => {
        const next = [...prev, ...batch];
        return next.length >= MAX_EVENTS ? next.slice(-MAX_EVENTS + 200) : next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // ------------------------------------------------------------ control
  const start = useCallback(async (packs: string[] | null, rounds: number) => {
    briefCountRef.current = 0;
    pendingEvents.current = [];
    setEvents([]);
    setBriefings([]);
    await fetch('/api/campaign/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packs, rounds }),
    });
  }, []);

  const abort = useCallback(async () => {
    await fetch('/api/campaign/abort', { method: 'POST' });
  }, []);

  const signGate = useCallback(async (gateId: string, signer: string) => {
    await fetch(`/api/gates/${gateId}/sign?signer=${encodeURIComponent(signer)}`, {
      method: 'POST',
    });
  }, []);

  const refreshFindings = useCallback(async () => {
    try {
      const r = await fetch('/api/findings', { cache: 'no-store' });
      return (await r.json()) as LiveFinding[];
    } catch {
      return [];
    }
  }, []);

  const refreshGates = useCallback(async () => {
    try {
      const r = await fetch('/api/gates', { cache: 'no-store' });
      return (await r.json()) as LiveGate[];
    } catch {
      return [];
    }
  }, []);

  const value = useMemo<LiveContextValue>(
    () => ({
      connected,
      connecting,
      status,
      events,
      briefings,
      lastBriefing: briefings.length ? briefings[briefings.length - 1] : null,
      hudMode,
      voiceOn,
      setHudMode,
      setVoiceOn,
      start,
      abort,
      signGate,
      refreshFindings,
      refreshGates,
    }),
    [connected, connecting, status, events, briefings, hudMode, voiceOn, setHudMode, setVoiceOn, start, abort, signGate, refreshFindings, refreshGates],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside <LiveProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Derivations shared by the schematic DAG, HUD constellation and scrubber
// ---------------------------------------------------------------------------

export const LIVE_NODE_ORDER = [
  'N0_mission_control',
  'N1_recon',
  'N2_attack_strategist',
  'N3_red_operators',
  'N4_judge',
  'N5_mutator',
  'G1_gatekeeper',
  'N6_chain_builder',
  'N7_verifier',
  'N8_scorer',
  'G2_release',
] as const;

/** Derive node states from the live event list (or a prefix of it, for replay). */
export function nodeStatesFromEvents(evts: LiveEvent[]): Record<string, NodeState> {
  const states: Record<string, NodeState> = {};
  for (const n of LIVE_NODE_ORDER) states[n] = 'pending';
  let anyActive = false;
  for (const e of evts) {
    if (e.type === 'node_start' && typeof e.node === 'string') {
      states[e.node] = 'active';
      anyActive = true;
    } else if (e.type === 'node_end' && typeof e.node === 'string') {
      states[e.node] = 'complete';
    } else if (e.type === 'gate_approved') {
      if (e.gate_level === 'G2') states['G2_release'] = 'complete';
      else states['G1_gatekeeper'] = 'complete';
    } else if (e.type === 'gate_denied') {
      states['G1_gatekeeper'] = 'blocked';
    } else if (e.type === 'campaign_end') {
      if (states['G2_release'] !== 'complete') states['G2_release'] = 'active';
    }
  }
  if (!anyActive && evts.some((e) => e.type === 'verdict')) states['N3_red_operators'] = 'complete';
  return states;
}

/** Format a live event as a transcript line for the Mission feed. */
export function eventToLine(e: LiveEvent): { who: string; text: string; level: string; t: string } {
  const t = (e.ts || '').slice(11, 19);
  switch (e.type) {
    case 'campaign_start':
      return { who: 'SYS', text: `campaign ${e.campaign_id} started · packs ${(e.packs as string[])?.join(', ')}`, level: 'sys', t };
    case 'mission_plan':
      return { who: 'SYS', text: `mission plan: packs ${(e.packs as string[])?.join(', ')}`, level: 'sys', t };
    case 'recon':
      return { who: 'SYS', text: `recon: shadow tools ${(e.shadow_tools as string[])?.join(', ')}`, level: 'warn', t };
    case 'plan':
      return { who: 'SYS', text: `attack plan: ${e.attempts_planned} attempts seeded`, level: 'sys', t };
    case 'attempt':
      return { who: 'RED1', text: `[R${e.round}] ${e.tech_id} → payload dispatched (${e.attempt_id})`, level: '', t };
    case 'verdict':
      return {
        who: 'JUDGE',
        text: `${e.tech_id} ${e.combined}${e.escalated ? ' · escalated to human' : ''} (${e.attempt_id})`,
        level: e.combined === 'Success' ? 'crit' : e.combined === 'Close' ? 'warn' : 'ok',
        t,
      };
    case 'gate_approved':
      return { who: 'GATE', text: `G1 approved ${e.technique_id} (${e.gate_level})`, level: 'warn', t };
    case 'gate_denied':
      return { who: 'GATE', text: `G1 denied ${e.technique_id} — sandbox only`, level: 'ok', t };
    case 'chain':
      return { who: 'SYS', text: `kill chain: ${(e.techniques as string[])?.join(' → ')}`, level: 'crit', t };
    case 'mutation_stop':
      return { who: 'SYS', text: `mutation stop at round ${e.round} (marginal gain ${e.gain ?? 0})`, level: 'ok', t };
    case 'budget_exhausted':
      return { who: 'SYS', text: 'budget cap reached — campaign halted', level: 'warn', t };
    case 'scorecard':
      return { who: 'SYS', text: `scorecard: ${((e.scorecard as LiveScorecard)?.total as number) ?? '?'} (${((e.scorecard as LiveScorecard)?.band as string) ?? '?'})`, level: 'sys', t };
    case 'report_ready':
      return { who: 'SYS', text: `report + dossier ready (${e.pdf_bytes} bytes PDF)`, level: 'ok', t };
    case 'campaign_end':
      return { who: 'SYS', text: `campaign end · ${e.stopped_reason} · ${e.attempts} attempts · ${e.findings} findings`, level: 'sys', t };
    default:
      return { who: 'SYS', text: `${e.type}`, level: '', t };
  }
}
