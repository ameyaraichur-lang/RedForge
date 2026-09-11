'use client';

// Diegetic instruments (D8 phase 4) — borderless floating readouts rendered as
// DOM over the 3D world, in the reel grammar: micro-caps mono labels, middle-
// dot separators, hairline rules, no card chrome. One glass element only: the
// PRIMARY OBJECTIVE banner. All heavy state is sampled from the world bus.

import { useEffect, useMemo, useRef, useState } from 'react';
import { worldBus, type WorldCounters } from '@/lib/world-bus';
import { eventToLine, useLive, type LiveEvent } from '@/lib/live';
import { MCP_SERVERS, PACK_BEARING, type WorldTheme } from '@/lib/world-theme';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// bus sampling hook (a few Hz — never per frame)
// ---------------------------------------------------------------------------

export type BusSnapshot = {
  counters: WorldCounters;
  blips: { a: number; r: number; age: number; hot: boolean }[];
  energy: number;
};

export function useBusSnapshot(hz = 4): BusSnapshot {
  const [snap, setSnap] = useState<BusSnapshot>(() => ({
    counters: { ...worldBus.counters, uniqueTechs: new Set(), uniqueHits: new Set() },
    blips: [],
    energy: 0,
  }));
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const now = (performance.now() - t0) / 1000;
      setSnap({
        counters: {
          ...worldBus.counters,
          uniqueTechs: new Set(worldBus.counters.uniqueTechs),
          uniqueHits: new Set(worldBus.counters.uniqueHits),
        },
        blips: worldBus.blips.map((b) => ({ ...b, age: Math.max(0, now - b.born) })),
        energy: worldBus.coreEnergy,
      });
    }, 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
  return snap;
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

export function MicroCaps({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('font-mono text-[9px] uppercase tracking-[0.28em]', className)}>
      {children}
    </p>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'dim' | 'crit'; children: React.ReactNode }) {
  const color =
    tone === 'ok' ? 'var(--w-ok)' : tone === 'warn' ? 'var(--w-warn)' : tone === 'crit' ? 'var(--w-crit)' : 'var(--w-dim)';
  return (
    <span className="world-pill" style={{ color }}>
      <span className="world-pill-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// status bar — brand, pills, session, mode, clock (the only top chrome)
// ---------------------------------------------------------------------------

function Clock() {
  const [now, setNow] = useState('--:--:--');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setNow(`${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="world-clock font-mono tabular-nums">{now}</span>;
}

export function WorldStatusBar({ themeName, onToggleTheme }: { themeName: string; onToggleTheme: () => void }) {
  const { connected, status, voiceOn, setVoiceOn } = useLive();
  const running = status?.running ?? false;
  const mode = running
    ? `executing · r${Math.max(1, worldBus.counters.round)}`
    : status?.stopped_reason === 'completed'
      ? 'complete'
      : status?.stopped_reason === 'aborted'
        ? 'aborted'
        : 'standby';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-6 py-4">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="world-brand font-mono font-bold">REDFORGE</span>
          <MicroCaps className="text-[8px]" >agentic red-team factory</MicroCaps>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Pill tone={connected ? 'ok' : 'crit'}>{connected ? 'online' : 'offline'}</Pill>
          <Pill tone="ok">secure</Pill>
          <Pill tone="warn">demo-mode</Pill>
          <Pill tone="dim">session {status?.campaign_id?.slice(0, 12) ?? '——'}</Pill>
        </div>
      </div>
      <div className="pointer-events-auto flex items-center gap-5">
        <MicroCaps>
          mode <span className="world-mode">{mode}</span>
        </MicroCaps>
        <Clock />
        <button type="button" onClick={onToggleTheme} className="world-ctl" aria-label="Toggle world theme">
          theme · {themeName}
        </button>
        <button
          type="button"
          onClick={() => setVoiceOn(!voiceOn)}
          className="world-ctl"
          aria-pressed={voiceOn}
          aria-label="Toggle voice"
        >
          voice {voiceOn ? 'on' : 'off'}
        </button>
        <a href="/mission" className="world-ctl" aria-label="Return to ops mode">
          ops mode ↗
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// reactor — vertical gauges for coverage and budget
// ---------------------------------------------------------------------------

export function ReactorGauges({ snap }: { snap: BusSnapshot }) {
  const coverage = worldBus.coverage();
  const covPct = Math.min(100, (snap.counters.uniqueTechs.size / coverage.target) * 100);
  const hitPct = Math.min(100, (snap.counters.uniqueHits.size / coverage.target) * 100);
  const budgetPct = Math.min(100, (snap.counters.attempts / 600) * 100);
  return (
    <div className="pointer-events-none absolute left-6 top-[136px] z-10 w-[190px] space-y-4">
      <MicroCaps className="world-dim">reactor</MicroCaps>
      <div className="space-y-3">
        <Gauge label="coverage" value={covPct} readout={`${snap.counters.uniqueTechs.size}/40`} color="var(--w-halo)" />
        <Gauge label="confirmed" value={hitPct} readout={`${snap.counters.uniqueHits.size}/40`} color="var(--w-ok)" />
        <Gauge label="budget" value={budgetPct} readout={`${snap.counters.attempts}/600`} color={budgetPct > 85 ? 'var(--w-crit)' : 'var(--w-warn)'} />
      </div>
      <div className="world-rule" />
      <div className="space-y-1.5">
        <MicroCaps className="world-dim">swarm telemetry</MicroCaps>
        <MicroCaps>
          verdicts <span className="world-val">{snap.counters.verdicts}</span> · hits{' '}
          <span className="world-val world-ok">{snap.counters.successes}</span>
        </MicroCaps>
        <MicroCaps>
          escalations <span className="world-val world-crit">{snap.counters.escalated}</span> · chains{' '}
          <span className="world-val">{snap.counters.chains}</span>
        </MicroCaps>
        <MicroCaps>
          gates <span className="world-val world-ok">{snap.counters.gatesApproved}</span> ok ·{' '}
          <span className="world-val world-crit">{snap.counters.gatesDenied}</span> denied
        </MicroCaps>
      </div>
    </div>
  );
}

function Gauge({ label, value, readout, color }: { label: string; value: number; readout: string; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <MicroCaps className="world-dim">{label}</MicroCaps>
        <span className="font-mono text-[10px] tabular-nums" style={{ color }}>{readout}</span>
      </div>
      <div className="world-gauge-track">
        <div className="world-gauge-fill" style={{ width: `${value}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// fleet radar — sweep + per-technique blips
// ---------------------------------------------------------------------------

export function FleetRadar({ snap, theme }: { snap: BusSnapshot; theme: WorldTheme }) {
  const sweep = useRef<SVGGElement>(null);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      if (sweep.current) {
        sweep.current.setAttribute('transform', `rotate(${((performance.now() - t0) / 1000) * 42})`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const R = 78;
  return (
    <div className="pointer-events-none absolute right-6 top-[120px] z-10 w-[186px]">
      <MicroCaps className="world-dim">fleet radar · attack surface</MicroCaps>
      <svg viewBox="-90 -90 180 180" className="mt-1.5 w-full" role="img" aria-label="Fleet radar">
        <circle r={R} fill="none" stroke="var(--w-radar)" strokeOpacity="0.35" strokeWidth="1" />
        <circle r={R * 0.66} fill="none" stroke="var(--w-radar)" strokeOpacity="0.2" strokeWidth="0.7" />
        <circle r={R * 0.33} fill="none" stroke="var(--w-radar)" strokeOpacity="0.2" strokeWidth="0.7" />
        <line x1={-R} y1="0" x2={R} y2="0" stroke="var(--w-radar)" strokeOpacity="0.18" strokeWidth="0.7" />
        <line x1="0" y1={-R} x2="0" y2={R} stroke="var(--w-radar)" strokeOpacity="0.18" strokeWidth="0.7" />
        <g ref={sweep}>
          <line x1="0" y1="0" x2="0" y2={-R} stroke="var(--w-radar)" strokeWidth="1.4" strokeOpacity="0.85" />
          <path d={`M 0 0 L ${6 * Math.sin(0.5)} ${-R} L ${6 * Math.sin(-0.5)} ${-R} Z`} fill="var(--w-radar)" opacity="0.12" />
        </g>
        {snap.blips.map((b, i) => {
          const age = Math.min(1, b.age / 14);
          const x = Math.cos(b.a) * b.r * R;
          const y = Math.sin(b.a) * b.r * R;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={b.hot ? 3 : 2}
              fill={b.hot ? 'var(--w-crit)' : theme.radar}
              opacity={(1 - age) * (b.hot ? 1 : 0.75)}
            />
          );
        })}
        {/* pack bearing ticks */}
        {Object.entries(PACK_BEARING).map(([p, deg]) => {
          const a = (deg * Math.PI) / 180;
          return (
            <text
              key={p}
              x={Math.cos(a) * (R + 9)}
              y={Math.sin(a) * (R + 9) + 2}
              textAnchor="middle"
              fontSize="6.5"
              fill="var(--w-dim)"
              fontFamily="var(--font-mono)"
              letterSpacing="1"
            >
              {p}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// audio field — waveform that reacts to core energy and TTS
// ---------------------------------------------------------------------------

export function AudioField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { voiceOn } = useLive();
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) {
          const w = c.width;
          const h = c.height;
          ctx.clearRect(0, 0, w, h);
          const t = performance.now() / 1000;
          const speaking = voiceOn && typeof window !== 'undefined' && window.speechSynthesis?.speaking;
          const amp = 0.1 + worldBus.coreEnergy * 0.5 + (speaking ? 0.4 : 0);
          ctx.strokeStyle = 'var(--w-audio, #ff8c1a)';
          ctx.strokeStyle = getComputedStyle(c).getPropertyValue('--w-audio') || '#ff8c1a';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 2) {
            const k = x / w;
            const env = Math.sin(k * Math.PI); // envelope
            const y =
              h / 2 +
              Math.sin(k * 26 + t * 9) * env * amp * h * 0.42 +
              Math.sin(k * 61 + t * 14) * env * amp * h * 0.18;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [voiceOn]);
  return (
    <div className="pointer-events-none absolute right-6 top-[356px] z-10 w-[186px]">
      <MicroCaps className="world-dim">audio field</MicroCaps>
      <canvas ref={canvas} width={186} height={44} className="mt-1 w-full" aria-hidden />
    </div>
  );
}

// ---------------------------------------------------------------------------
// diagnostics — api + mcp fleet health
// ---------------------------------------------------------------------------

export function Diagnostics({ connected }: { connected: boolean }) {
  return (
    <div className="pointer-events-none absolute right-6 top-[436px] z-10 w-[186px] space-y-1.5">
      <MicroCaps className="world-dim">diagnostics · services</MicroCaps>
      <DiagnosticRow ok={connected} label="api · :8000" value={connected ? 'online' : 'down'} />
      <DiagnosticRow ok label="engine · swarm" value="ready" />
      {MCP_SERVERS.map((s) => (
        <DiagnosticRow key={s} ok label={`mcp · ${s.replace('redforge-', '')}`} value="reg" />
      ))}
    </div>
  );
}

function DiagnosticRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  const color = ok ? 'var(--w-ok)' : 'var(--w-crit)';
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn('h-1 w-1 rounded-full', ok && 'animate-blink')}
        style={{ background: color, boxShadow: `0 0 5px ${color}` }}
        aria-hidden
      />
      <MicroCaps className="flex-1 truncate">{label}</MicroCaps>
      <span className="font-mono text-[8px] uppercase" style={{ color }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// terminal — typewriter event stream, newest line hot
// ---------------------------------------------------------------------------

function useTypewriter(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(enabled ? '' : text);
  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }
    setShown('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [text, enabled]);
  return shown;
}

export function TerminalFeed({ events, running }: { events: LiveEvent[]; running: boolean }) {
  const lines = useMemo(() => events.map(eventToLine).slice(-9), [events]);
  const last = lines[lines.length - 1];
  const typed = useTypewriter(last?.text ?? '', running && lines.length > 0);
  return (
    <div className="pointer-events-none absolute bottom-[118px] left-6 z-10 w-[340px]">
      <MicroCaps className="world-dim mb-1.5">
        terminal · event stream {running ? '· live' : ''}
      </MicroCaps>
      <div className="space-y-[3px]">
        {lines.slice(0, -1).map((l, i) => (
          <p key={i} className="world-term-line world-term-old font-mono">
            <span className="world-term-t">{l.t}</span> <span className="world-term-who">{l.who}</span> {l.text}
          </p>
        ))}
        {last && (
          <p className="world-term-line world-term-hot font-mono">
            <span className="world-term-t">{last.t}</span> <span className="world-term-who">{last.who}</span>{' '}
            {typed}
            <span className="world-cursor" aria-hidden />
          </p>
        )}
        {lines.length === 0 && (
          <p className="world-term-line world-term-old font-mono">— awaiting events · initialize campaign —</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// primary objective — the single glass element (mission framing + control)
// ---------------------------------------------------------------------------

export function ObjectiveBanner({ snap, onStart, onAbort, running, stopped, offline }: {
  snap: BusSnapshot;
  onStart: () => void;
  onAbort: () => void;
  running: boolean;
  stopped: string | null | undefined;
  offline?: boolean;
}) {
  const cov = worldBus.coverage();
  const score = snap.counters.scoreTotal;
  const band = snap.counters.scoreBand;
  const pct = Math.min(100, (cov.hit / cov.target) * 100);
  const finished = stopped === 'completed' || snap.counters.ended;
  const badge = running ? '● live' : finished ? '✓ complete' : stopped === 'aborted' ? '✕ aborted' : '● standby';
  return (
    <div className="absolute bottom-6 left-1/2 z-20 w-[560px] -translate-x-1/2">
      <div className="world-glass pointer-events-auto rounded-sm px-5 py-3.5">
        <div className="flex items-center justify-between">
          <MicroCaps className="world-dim">primary objective · full catalog coverage</MicroCaps>
          <span className={cn('world-live-badge font-mono', running ? 'world-live-hot' : '')} aria-label={running ? 'live' : 'standby'}>
            {badge}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-5 font-mono tabular-nums">
          <span className="world-stat"><span className="world-stat-label">target</span>{cov.target}</span>
          <span className="world-stat"><span className="world-stat-label">confirmed</span>{cov.hit}</span>
          <span className="world-stat"><span className="world-stat-label">gap</span>{cov.gap}</span>
          <span className="ml-auto world-stat">
            <span className="world-stat-label">score</span>
            {score !== null ? `${score} · ${band}` : '——'}
          </span>
        </div>
        <div className="world-obj-track mt-2.5">
          <div
            className="world-obj-fill"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--w-halo), var(--w-ok))' }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <MicroCaps className="world-dim">⌘k command core · click a node to inspect · esc to zoom out</MicroCaps>
          {offline ? (
            <span className="world-ctl cursor-default">api offline · demo loop</span>
          ) : running ? (
            <button type="button" onClick={onAbort} className="world-btn world-btn-crit" aria-label="Abort campaign">
              abort campaign
            </button>
          ) : (
            <button type="button" onClick={onStart} className="world-btn" aria-label="Initialize campaign">
              initialize campaign
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// replay timeline — thin time-travel scrubber (appears once events exist)
// ---------------------------------------------------------------------------

export function WorldReplay({
  total,
  position,
  onPosition,
}: {
  total: number;
  position: number | null;
  onPosition: (p: number | null) => void;
}) {
  if (total < 8) return null;
  const val = position ?? total;
  return (
    <div className="pointer-events-auto absolute bottom-[76px] left-1/2 z-20 flex w-[560px] -translate-x-1/2 items-center gap-3">
      <MicroCaps className="world-dim whitespace-nowrap">
        {position !== null ? `replay @${position}` : 'timeline'}
      </MicroCaps>
      <input
        type="range"
        min={0}
        max={total}
        value={val}
        onChange={(e) => onPosition(Number(e.target.value))}
        className="world-scrub h-1 flex-1"
        aria-label="World timeline scrubber"
      />
      {position !== null && (
        <button type="button" onClick={() => onPosition(null)} className="world-ctl whitespace-nowrap">
          return live
        </button>
      )}
    </div>
  );
}
