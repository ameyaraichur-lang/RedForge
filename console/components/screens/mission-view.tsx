'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Meter } from '@/components/ui/meter';
import { StatusChip } from '@/components/ui/status-chip';
import { Icon } from '@/components/icon';
import { cn, fmtCompact } from '@/lib/utils';
import {
  BUDGET,
  CAMPAIGN,
  GATE_SIZE,
  MISSION_EDGES,
  MISSION_NODES,
  NODE_H,
  NODE_W,
  ROUNDS,
  TRANSCRIPT,
  type MissionNode,
  type NodeState,
  type TranscriptLine,
} from '@/lib/fixtures';
import {
  eventToLine,
  nodeStatesFromEvents,
  useLive,
} from '@/lib/live';
import { Constellation } from '@/components/hud/constellation';
import { ReplayScrubber } from '@/components/hud/replay-scrubber';

// ---------------------------------------------------------------------------
// Shared: schematic DAG renderer (works for fixture nodes AND live nodes)
// ---------------------------------------------------------------------------

const CANVAS_W = 1120;
const CANVAS_H = 560;

const NODE_STYLES: Record<string, { box: string; label: string; sub: string }> = {
  complete: { box: 'border-ok/50 bg-panel hover:border-ok/80', label: 'text-ok', sub: 'text-dim' },
  active: { box: 'border-acc bg-acc/10 shadow-glow hover:border-acc/80', label: 'text-acc', sub: 'text-mut' },
  pending: { box: 'border-line bg-ink-2 hover:border-line-2', label: 'text-dim', sub: 'text-dim/80' },
  blocked: { box: 'border-warn/60 bg-warn/10 shadow-glow-warn', label: 'text-warn', sub: 'text-mut' },
};

function center(node: MissionNode): [number, number] {
  if (node.gate) return [node.x + GATE_SIZE / 2, node.y + GATE_SIZE / 2];
  return [node.x + NODE_W / 2, node.y + NODE_H / 2];
}

function anchor(node: MissionNode, side: 'left' | 'right' | 'top' | 'bottom'): [number, number] {
  const [cx, cy] = center(node);
  if (node.gate) {
    if (side === 'left') return [node.x, cy];
    if (side === 'right') return [node.x + GATE_SIZE, cy];
    if (side === 'top') return [cx, node.y];
    return [cx, node.y + GATE_SIZE];
  }
  if (side === 'left') return [node.x, cy];
  if (side === 'right') return [node.x + NODE_W, cy];
  if (side === 'top') return [cx, node.y];
  return [cx, node.y + NODE_H];
}

function edgePath(from: MissionNode, to: MissionNode): string {
  const [fx, fy] = center(from);
  const [tx, ty] = center(to);
  const dx = tx - fx;
  const dy = ty - fy;
  let p1: [number, number];
  let p2: [number, number];
  if (Math.abs(dx) * 1.2 >= Math.abs(dy) && Math.abs(dx) > 8) {
    p1 = anchor(from, dx > 0 ? 'right' : 'left');
    p2 = anchor(to, dx > 0 ? 'left' : 'right');
    const mx = p1[0] + (p2[0] - p1[0]) / 2;
    return `M${p1[0]},${p1[1]} C${mx},${p1[1]} ${mx},${p2[1]} ${p2[0]},${p2[1]}`;
  }
  p1 = anchor(from, dy > 0 ? 'bottom' : 'top');
  p2 = anchor(to, dy > 0 ? 'top' : 'bottom');
  const my = p1[1] + (p2[1] - p1[1]) / 2;
  return `M${p1[0]},${p1[1]} C${p1[0]},${my} ${p2[0]},${my} ${p2[0]},${p2[1]}`;
}

function SchematicDag({ nodes, edges }: { nodes: MissionNode[]; edges: { from: string; to: string }[] }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
      <p className="absolute left-[20px] top-[44px] font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
        phase i · recon &amp; planning
      </p>
      <p className="absolute left-[20px] top-[274px] font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
        phase ii · gated execution &amp; adjudication
      </p>
      <svg
        className="absolute inset-0"
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0  0 ${CANVAS_W} ${CANVAS_H}`}
        aria-hidden
      >
        {edges.map(({ from, to }) => {
          const f = byId.get(from);
          const t = byId.get(to);
          if (!f || !t) return null;
          const active = t.state === 'active' && f.state !== 'pending';
          const done = f.state === 'complete' && t.state === 'complete';
          return (
            <path
              key={`${from}-${to}`}
              d={edgePath(f, t)}
              fill="none"
              strokeWidth={1.4}
              className={active ? 'edge-flow' : undefined}
              stroke={active ? '#22d3ee' : done ? 'rgba(52, 211, 153, 0.4)' : 'rgba(148, 163, 184, 0.3)'}
            />
          );
        })}
      </svg>
      {nodes.map((node) => {
        if (node.gate) {
          const done = node.state === 'complete';
          return (
            <div
              key={node.id}
              className="absolute flex items-center justify-center"
              style={{ left: node.x, top: node.y, width: GATE_SIZE, height: GATE_SIZE }}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-[13px] rotate-45 rounded-sm border-2',
                  done ? 'border-ok/70 bg-ok/10' : node.state === 'blocked' ? 'border-crit/70 bg-crit/10' : 'border-warn/70 bg-warn/10 shadow-glow-warn',
                )}
              />
              <span className="relative z-10 text-center font-mono leading-tight">
                <span className={cn('block text-[13px] font-bold tracking-widest', done ? 'text-ok' : node.state === 'blocked' ? 'text-crit' : 'text-warn')}>
                  {node.label}
                </span>
                <span className="block text-[9px] uppercase tracking-[0.14em] text-dim">{node.sub}</span>
                <span className={cn('mt-0.5 block text-[8px] uppercase tracking-widest', done ? 'text-ok/70' : node.state === 'blocked' ? 'text-crit/70' : 'text-warn/70')}>
                  {done ? 'passed' : node.state === 'blocked' ? 'denied' : 'awaiting'}
                </span>
              </span>
            </div>
          );
        }
        const s = NODE_STYLES[node.state] ?? NODE_STYLES.pending;
        return (
          <div
            key={node.id}
            className={cn(
              'absolute rounded border px-2.5 py-2 transition-colors',
              s.box,
              node.state === 'active' && 'animate-pulse-dot',
            )}
            style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
          >
            <p className={cn('font-mono text-[11px] font-semibold leading-tight', s.label)}>{node.label}</p>
            <p className={cn('mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em]', s.sub)}>{node.sub}</p>
            <p className="sr-only">state: {node.state}</p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript renderer (fixture lines or live events)
// ---------------------------------------------------------------------------

const WHO_TONE: Record<string, string> = {
  SYS: 'text-acc border-acc/30 bg-acc/10',
  JUDGE: 'text-violet-300 border-violet-400/30 bg-violet-400/10',
  GATE: 'text-warn border-warn/30 bg-warn/10',
  RED1: 'text-rose-300 border-rose-400/30 bg-rose-400/10',
  TARGET: 'text-warn border-warn/30 bg-warn/10',
  CANARY: 'text-ok border-ok/30 bg-ok/10',
};

function TranscriptRow({ t, who, text, level }: { t: string; who: string; text: string; level?: string }) {
  const tone = WHO_TONE[who] ?? 'text-mut border-line bg-ink-2';
  const textTone =
    level === 'crit' ? 'text-crit' : level === 'warn' ? 'text-warn' : level === 'ok' ? 'text-ok' : level === 'sys' ? 'text-acc' : 'text-slate-300';
  return (
    <div className="flex items-baseline gap-3 px-4 py-1 hover:bg-acc/5">
      <span className="w-[76px] shrink-0 font-mono text-[10px] tabular-nums text-dim">{t}</span>
      <span className={cn('w-[70px] shrink-0 rounded border px-1 py-px text-center font-mono text-[9px] font-semibold tracking-wide', tone)}>{who}</span>
      <span className={cn('min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed', textTone)}>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIVE mission (M6b): real swarm events over SSE
// ---------------------------------------------------------------------------

const ALL_PACKS = ['PIN', 'EXF', 'OUT', 'AGE', 'MEM', 'CON', 'HAL', 'SUP'];

// Schematic positions for live nodes (same visual language as fixtures)
const LIVE_DAG_NODES: MissionNode[] = [
  { id: 'N0_mission_control', label: 'N0 mission', sub: 'plan · roai', x: 20, y: 90, state: 'pending' },
  { id: 'N1_recon', label: 'N1 recon', sub: 'surface map', x: 20, y: 190, state: 'pending' },
  { id: 'N2_attack_strategist', label: 'N2 strategist', sub: 'pack matrix', x: 20, y: 290, state: 'pending' },
  { id: 'N3_red_operators', label: 'N3 operators', sub: 'multi-instance', x: 300, y: 70, state: 'pending' },
  { id: 'N4_judge', label: 'N4 judge', sub: 'rule → llm', x: 300, y: 170, state: 'pending' },
  { id: 'N5_mutator', label: 'N5 mutator', sub: 'bounded ≤3', x: 300, y: 270, state: 'pending' },
  { id: 'G1_gatekeeper', label: 'G1', sub: 'two-person', gate: 'G1', x: 600, y: 140, state: 'pending' },
  { id: 'N6_chain_builder', label: 'N6 chains', sub: 'kill chains', x: 780, y: 70, state: 'pending' },
  { id: 'N7_verifier', label: 'N7 verifier', sub: 'fp-kill', x: 780, y: 190, state: 'pending' },
  { id: 'N8_scorer', label: 'N8 scorer', sub: 'opa policy', x: 960, y: 130, state: 'pending' },
  { id: 'G2_release', label: 'G2', sub: 'release', gate: 'G2', x: 1050, y: 300, state: 'pending' },
];

const LIVE_DAG_EDGES = [
  { from: 'N0_mission_control', to: 'N1_recon' },
  { from: 'N1_recon', to: 'N2_attack_strategist' },
  { from: 'N2_attack_strategist', to: 'N3_red_operators' },
  { from: 'N3_red_operators', to: 'N4_judge' },
  { from: 'N4_judge', to: 'N5_mutator' },
  { from: 'N5_mutator', to: 'N3_red_operators' },
  { from: 'N4_judge', to: 'G1_gatekeeper' },
  { from: 'N3_red_operators', to: 'G1_gatekeeper' },
  { from: 'G1_gatekeeper', to: 'N6_chain_builder' },
  { from: 'G1_gatekeeper', to: 'N7_verifier' },
  { from: 'N6_chain_builder', to: 'N8_scorer' },
  { from: 'N7_verifier', to: 'N8_scorer' },
  { from: 'N8_scorer', to: 'G2_release' },
];

function LiveMission() {
  const { status, events, start, abort, hudMode, connected } = useLive();
  const [packSel, setPackSel] = useState<string[]>(ALL_PACKS);
  const [rounds, setRounds] = useState(3);
  const [replayPos, setReplayPos] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = status?.running ?? false;
  const pauseCountRef = useRef(0);

  const liveEvents = useMemo(
    () => (replayPos === null ? events : events.slice(0, replayPos)),
    [events, replayPos],
  );
  const states = useMemo(() => nodeStatesFromEvents(liveEvents), [liveEvents]);
  const dagNodes = useMemo(
    () => LIVE_DAG_NODES.map((n) => ({ ...n, state: (states[n.id] ?? 'pending') as NodeState })),
    [states],
  );
  const lines = useMemo(() => liveEvents.map(eventToLine), [liveEvents]);
  const transcript = useMemo(() => (paused ? lines.slice(0, pauseCountRef.current) : lines), [lines, paused]);
  useEffect(() => {
    if (!paused) pauseCountRef.current = lines.length;
  }, [lines, paused]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !paused && replayPos === null) el.scrollTop = el.scrollHeight;
  }, [lines.length, paused, replayPos]);

  const verdictCount = liveEvents.filter((e) => e.type === 'verdict').length;
  const successCount = liveEvents.filter((e) => e.type === 'verdict' && e.combined === 'Success').length;
  const roundNow = Math.max(0, ...(liveEvents.filter((e) => e.type === 'attempt').map((e) => Number(e.round ?? 0) || 0) || [0]));

  const togglePack = (p: string) =>
    setPackSel((s) => (s.includes(p) ? (s.length > 1 ? s.filter((x) => x !== p) : s) : [...s, p]));

  return (
    <>
      <PageHeader
        title="Mission Control · LIVE"
        sub={`live swarm over SSE · ${status?.campaign_id ?? 'no campaign yet'} · demo target (d3) · ${events.length} events`}
        actions={
          running ? <StatusChip status="running" label={`R${roundNow || 1} executing`} />
          : status?.stopped_reason === 'completed' ? <StatusChip status="confirmed" label="campaign complete" />
          : status?.stopped_reason === 'aborted' ? <StatusChip status="killed" label="aborted" />
          : <StatusChip status="standby" label="idle" />
        }
      />

      <Panel title="Campaign Control" bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">packs</span>
            {ALL_PACKS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePack(p)}
                disabled={running}
                className={cn(
                  'rounded border px-2 py-0.5 font-mono text-[10px] tracking-wide transition-colors',
                  packSel.includes(p)
                    ? 'border-acc/60 bg-acc/10 text-acc'
                    : 'border-line bg-ink-2 text-dim hover:text-mut',
                  running && 'cursor-not-allowed opacity-50',
                )}
                aria-pressed={packSel.includes(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
            rounds
            <select
              value={rounds}
              disabled={running}
              onChange={(e) => setRounds(Number(e.target.value))}
              className="ops-select"
              aria-label="Mutation rounds"
            >
              {[1, 2, 3].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {running ? (
            <button
              type="button"
              onClick={() => void abort()}
              className="flex items-center gap-2 rounded border border-crit/60 bg-crit/10 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-crit transition-colors hover:bg-crit/20"
            >
              <Icon name="flame" className="h-3.5 w-3.5" /> abort campaign
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start(packSel.length === ALL_PACKS.length ? null : packSel, rounds)}
              className="flex items-center gap-2 rounded border border-acc/60 bg-acc/10 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-acc shadow-glow transition-colors hover:bg-acc/20"
            >
              <Icon name="play" className="h-3.5 w-3.5" /> start campaign
            </button>
          )}
          <div className="ml-auto flex items-center gap-4 font-mono text-[11px] tabular-nums text-mut">
            <span>attempts <span className="text-slate-200">{status?.attempts ?? 0}</span></span>
            <span>verdicts <span className="text-slate-200">{verdictCount}</span></span>
            <span>hits <span className="text-crit">{successCount}</span></span>
            <span>findings <span className="text-slate-200">{status?.findings_confirmed ?? 0}/{status?.findings_total ?? 0}</span></span>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {hudMode ? (
            <Panel title="Swarm Constellation · HUD Mode" bodyClassName="p-0">
              <Constellation events={liveEvents} />
            </Panel>
          ) : (
            <Panel title="Pipeline DAG · live" bodyClassName="p-2"
              actions={
                <div className="flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border border-ok/70 bg-ok/20" />complete</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border border-acc bg-acc/30" />active</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border border-line-2 bg-ink-2" />pending</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 border border-warn/70 bg-warn/20" />gate</span>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <SchematicDag nodes={dagNodes} edges={LIVE_DAG_EDGES} />
              </div>
            </Panel>
          )}

          <Panel
            title={`Live Transcript · ${status?.campaign_id ?? '—'}`}
            bodyClassName="p-0"
            actions={
              <div className="flex items-center gap-2">
                {replayPos !== null ? (
                  <StatusChip status="warning" label={`replay @${replayPos}`} />
                ) : (
                  <StatusChip status={running ? 'running' : connected ? 'standby' : 'killed'}
                    label={running ? 'streaming' : connected ? 'idle' : 'disconnected'} />
                )}
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mut hover:border-line-2 hover:text-slate-200"
                >
                  <Icon name={paused ? 'play' : 'pause'} className="h-3 w-3" />
                  {paused ? 'resume' : 'pause'}
                </button>
              </div>
            }
          >
            <div ref={scrollRef} className="h-[300px] overflow-y-auto">
              {transcript.length === 0 && (
                <p className="px-4 py-6 font-mono text-[11px] text-dim">
                  — awaiting events · press “start campaign” —
                </p>
              )}
              {transcript.map((l, i) => (
                <TranscriptRow key={`${l.t}-${i}`} t={l.t} who={l.who} text={l.text} level={l.level} />
              ))}
              {transcript.length > 0 && (
                <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
                  {running ? '— live sse stream —' : '— stream idle —'}
                </p>
              )}
            </div>
          </Panel>

          <ReplayScrubber position={replayPos} onPosition={setReplayPos} eventsCount={events.length} />
        </div>

        <div className="space-y-6">
          <Panel title="Rounds · live">
            <ol className="space-y-2">
              {[1, 2, 3].map((r) => {
                const isCurrent = running && r === roundNow;
                const isDone = (status?.rounds_executed ?? 0) >= r && !running;
                return (
                  <li key={r} className={cn('rounded border px-3 py-2.5',
                    isCurrent ? 'border-acc/50 bg-acc/10' : isDone ? 'border-line bg-ink-2' : 'border-line bg-ink-2 opacity-60')}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[13px] font-bold text-slate-100">R{r}</span>
                      <StatusChip status={isCurrent ? 'active' : isDone ? 'complete' : 'pending'} />
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-mut">
                      {liveEvents.filter((e) => e.type === 'attempt' && Number(e.round) === r).length} attempts ·{' '}
                      <span className="text-ok">
                        +{liveEvents.filter((e) => e.type === 'verdict' && e.combined === 'Success').length} hits total
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 border-t border-line pt-3 font-mono text-[10px] leading-relaxed text-dim">
              bounded mutation ≤ 3 rounds · marginal-gain cutoff enforced by engine (tenet t3).
            </p>
          </Panel>

          <Panel title="Budget · live">
            <div className="space-y-5">
              <Meter label="attempts" value={status?.attempts ?? 0} max={600} display={`${status?.attempts ?? 0} / 600`} />
              <Meter label="tokens" value={status?.budget?.tokens ?? 0} max={50_000_000}
                display={`${fmtCompact(status?.budget?.tokens ?? 0)} / ${fmtCompact(50_000_000)}`} />
              <Meter label="cost (usd)" value={status?.budget?.cost_usd ?? 0} max={100}
                display={`$${(status?.budget?.cost_usd ?? 0).toFixed(2)} / $100.00`} />
            </div>
          </Panel>

          <Panel title="Kill Switch">
            <div className="space-y-2.5">
              <p className="font-mono text-[11px] leading-relaxed text-mut">
                abort halts all operators, freezes budget, seals the evidence ledger. evidence is preserved.
              </p>
              <button
                type="button"
                onClick={() => void abort()}
                disabled={!running}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded border px-3 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors',
                  running
                    ? 'border-crit/60 bg-crit/10 text-crit hover:bg-crit/25'
                    : 'cursor-not-allowed border-line bg-ink-2 text-dim opacity-40',
                )}
              >
                <Icon name="flame" /> {running ? 'abort campaign' : 'no campaign running'}
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FIXTURE mission (M6a) — shown when the live API is unreachable
// ---------------------------------------------------------------------------

function FixtureTranscriptPane() {
  const [count, setCount] = useState(1);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setCount((c) => Math.min(c + 1, TRANSCRIPT.length)), 2000);
    return () => window.clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !paused) el.scrollTop = el.scrollHeight;
  }, [count, paused]);

  const done = count >= TRANSCRIPT.length;
  return (
    <Panel
      title="Live Transcript · DEMO-2026-09/R3"
      bodyClassName="p-0"
      actions={
        <div className="flex items-center gap-2">
          {done ? <StatusChip status="complete" label="feed exhausted" />
            : <StatusChip status={paused ? 'standby' : 'running'} label={paused ? 'paused' : 'streaming'} />}
          <button type="button" onClick={() => setPaused((p) => !p)} disabled={done}
            className={cn('inline-flex items-center gap-1.5 rounded border border-line bg-ink-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em]',
              done ? 'cursor-not-allowed opacity-40' : 'text-mut hover:text-slate-200')}>
            <Icon name={paused ? 'play' : 'pause'} className="h-3 w-3" /> {paused ? 'resume' : 'pause'}
          </button>
        </div>
      }
    >
      <div ref={scrollRef} className="h-[300px] overflow-y-auto">
        {TRANSCRIPT.slice(0, count).map((line, i) => (
          <TranscriptRow key={`${line.t}-${i}`} t={line.t} who={line.who} text={line.text} level={line.level} />
        ))}
        <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          {done ? '— end of fixture feed · r3 complete —' : '— streaming (2s cadence, fixture) —'}
        </p>
      </div>
    </Panel>
  );
}

function FixtureMission() {
  return (
    <>
      <PageHeader
        title="Mission Control"
        sub={`9-agent pipeline + G1/G2 gates · campaign ${CAMPAIGN.id} · target ${CAMPAIGN.target} · G1 passed, G2 release-ready on campaign end`}
        actions={<StatusChip status="running" label="r3 executing (fixture)" />}
      />
      <div className="rounded border border-warn/40 bg-warn/5 px-4 py-2.5 font-mono text-[11px] text-warn">
        live api unreachable — showing m6a fixture data. start the api with <span className="text-warn">python -m redforge.api</span> and reload.
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Pipeline DAG · static layout" bodyClassName="p-2">
            <div className="overflow-x-auto">
              <SchematicDag nodes={MISSION_NODES} edges={MISSION_EDGES} />
            </div>
          </Panel>
          <FixtureTranscriptPane />
        </div>
        <div className="space-y-6">
          <Panel title="Rounds · marginal gain">
            <ol className="space-y-2">
              {ROUNDS.map((r) => (
                <li key={r.round} className={cn('rounded border px-3 py-2.5',
                  r.status === 'active' ? 'border-acc/50 bg-acc/10' : r.status === 'complete' ? 'border-line bg-ink-2' : 'border-line bg-ink-2 opacity-60')}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[13px] font-bold text-slate-100">{r.round}</span>
                    <StatusChip status={r.status === 'active' ? 'active' : r.status === 'complete' ? 'complete' : 'pending'} />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px]">
                    <span className="text-mut">{r.findings} findings · <span className="text-ok">+{r.gain} gain</span></span>
                    <span className="text-dim">{r.window}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Budget">
            <div className="space-y-5">
              {BUDGET.map((b) => (
                <Meter key={b.label} label={b.label} value={b.used} max={b.cap}
                  display={b.unit === 'usd' ? `$${b.used.toFixed(2)} / $${b.cap.toFixed(2)}` : b.unit === 'tokens' ? `${fmtCompact(b.used)} / ${fmtCompact(b.cap)}` : `${b.used} / ${b.cap}`} />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MissionView() {
  const { connected } = useLive();
  return connected ? <LiveMission /> : <FixtureMission />;
}
