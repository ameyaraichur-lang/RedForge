'use client';

// Text-only Mission Control — same entry/auth/readiness FSM as WebGL path.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLive, nodeStatesFromEvents } from '@/lib/live';
import { useOperator } from '@/lib/operator-context';
import { OperatorDock } from '@/components/world/operator-dock';
import {
  fetchWorldManifest,
  manifestNodeById,
  type WorldManifest,
} from '@/lib/world-manifest';
import {
  type EntryPhase,
  isMissionControlLive,
  markEntryComplete,
  resolveInitialEntry,
  transitionEntry,
  type EntryContext,
} from '@/lib/entry-fsm';
import { setMissionControlLive } from '@/lib/mission-control-gate';
import {
  clearSummonAnchor,
  getSummonProgress,
  isSummonComplete,
  resetSummonAnchor,
  setSummonHold,
} from '@/lib/summon-anchor';
import { EntryAuthPanel } from '@/components/world/entry-auth-panel';
import { ReadinessPrompt } from '@/components/world/readiness-prompt';
import { CampaignTargetPicker } from '@/components/ui/campaign-target-picker';
import { DEFAULT_TARGET_PICKER } from '@/lib/targets';
import { CampaignStartFeedback } from '@/components/ui/campaign-start-feedback';
import { buildTargetPayload, type TargetPickerState, validateApiKeyEnvName } from '@/lib/targets';
import { cn } from '@/lib/utils';

export function NoWebGLFallback({ onEnter }: { onEnter?: () => void }) {
  const live = useLive();
  const op = useOperator();
  const { connected, status, events } = live;
  const [manifest, setManifest] = useState<WorldManifest | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<EntryPhase>('initializing');
  const [targetPick, setTargetPick] = useState<TargetPickerState>(DEFAULT_TARGET_PICKER);
  const [startError, setStartError] = useState<string | null>(null);
  const initDone = useRef(false);

  useEffect(() => {
    void fetchWorldManifest().then(setManifest).catch(() => {});
  }, []);

  const buildCtx = useCallback((): EntryContext => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    return {
      repeatVisit: window.sessionStorage.getItem('rf-world-booted') === '1',
      campaignRunning: status?.running ?? false,
      bootSkip: params.get('boot') === 'skip',
      bootFast: params.get('boot') === 'fast',
      capturePhase: params.get('phase'),
      authRequired: op.authConfig?.auth_mode === 'secure' && op.authStatus !== 'authenticated',
      authReady: op.authStatus === 'authenticated',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      webglOk: false,
    };
  }, [status, op.authStatus, op.authConfig?.auth_mode]);

  useEffect(() => {
    if (initDone.current || op.authStatus === 'initializing' || !op.authConfig) return;
    initDone.current = true;
    const decision = resolveInitialEntry(buildCtx());
    setPhase(decision.phase === 'skipped' ? 'mission_control' : decision.phase);
  }, [op.authStatus, buildCtx]);

  useEffect(() => {
    setMissionControlLive(isMissionControlLive(phase));
  }, [phase]);

  useEffect(() => {
    if (op.authStatus === 'initializing') return;
    if (phase === 'initializing') {
      setPhase((p) => transitionEntry(p, 'scene_ready', buildCtx()));
    }
    if (phase === 'authenticating' && op.authStatus === 'authenticated') {
      setPhase((p) => transitionEntry(p, 'auth_ready', buildCtx()));
    }
  }, [op.authStatus, phase, buildCtx]);

  useEffect(() => {
    if (phase === 'assembling') {
      const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : 2200;
      const id = window.setTimeout(
        () => setPhase((p) => transitionEntry(p, 'assembly_complete', buildCtx())),
        ms,
      );
      return () => window.clearTimeout(id);
    }
    if (phase === 'greeting') {
      const id = window.setTimeout(
        () => setPhase((p) => transitionEntry(p, 'greeting_done', buildCtx())),
        700,
      );
      return () => window.clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- phase edges only; buildCtx read at fire time
  }, [phase]);

  useEffect(() => {
    if (phase !== 'summoning') return;
    if (window.__RF_SUMMON_ANCHOR_MS__ == null) resetSummonAnchor();
    let raf = 0;
    const tick = () => {
      if (isSummonComplete()) {
        clearSummonAnchor();
        markEntryComplete();
        setPhase((p) => transitionEntry(p, 'summon_complete', buildCtx()));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, buildCtx]);

  const beginSummon = useCallback(() => {
    markEntryComplete();
    const now = performance.now();
    const preArm = window.__RF_SUMMON_PRE_ARM__;
    if (preArm) {
      window.__RF_SUMMON_PRE_ARM__ = false;
      setSummonHold(true, now);
    }
    resetSummonAnchor(now, { preserveHold: preArm === true });
    setPhase('summoning');
  }, []);

  const liveNow = isMissionControlLive(phase);
  const states = useMemo(() => nodeStatesFromEvents(events), [events]);
  const byId = manifest ? manifestNodeById(manifest) : {};
  const running = status?.running ?? false;

  const onStartCampaign = async () => {
    setStartError(null);
    const envErr = validateApiKeyEnvName(targetPick.apiKeyEnv);
    if (envErr) {
      setStartError(envErr);
      return;
    }
    const out = await live.start(null, 3, buildTargetPayload(targetPick));
    if (!out.ok && out.error) setStartError(out.error);
  };

  return (
    <main
      className="flex h-screen flex-col gap-4 overflow-auto bg-ink p-4"
      aria-label="RedForge mission control text mode"
      data-entry-phase={phase}
      data-mission-control-live={liveNow ? '1' : '0'}
    >
      <header className="border-b border-line/60 pb-3">
        <h1 className="font-mono text-[13px] uppercase tracking-[0.28em] text-acc">
          redforge · {liveNow ? 'mission control' : 'entry'}
        </h1>
        <p className="mt-1 font-mono text-[10px] text-dim">
          webgl unavailable — text operator with full entry parity
        </p>
        {onEnter && (
          <button type="button" className="world-btn mt-3 text-[10px]" onClick={onEnter}>
            retry webgl
          </button>
        )}
      </header>

      {phase === 'authenticating' && (
        <EntryAuthPanel onAuthenticated={() => setPhase((p) => transitionEntry(p, 'auth_ready', buildCtx()))} />
      )}

      {phase === 'assembling' && (
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-dim">assembling…</p>
      )}

      {phase === 'greeting' && (
        <p className="font-mono text-[10px] text-acc">RedForge online. Ready to enter Mission Control?</p>
      )}

      {(phase === 'awaiting_entry' || phase === 'listening' || phase === 'speaking') && (
        <ReadinessPrompt
          phase={phase}
          onEnter={beginSummon}
          missionControlLive={false}
          allowVoice={op.authStatus === 'authenticated'}
          onListeningStart={() => setPhase((p) => transitionEntry(p, 'operator_listening', buildCtx()))}
          onListeningEnd={() => setPhase((p) => transitionEntry(p, 'operator_idle', buildCtx()))}
        />
      )}

      {phase === 'summoning' && (
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-dim">summoning mission control…</p>
      )}

      {liveNow && manifest && (
        <section aria-label="Campaign agent manifest">
          <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-dim">
            runtime agents · {manifest.agent_count} · gates · {manifest.gate_count}
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {manifest.pipeline_order.map((id) => {
              const n = byId[id];
              if (!n) return null;
              const st = states[id] ?? 'pending';
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-world-node={id}
                    aria-pressed={selected === id}
                    onClick={() => setSelected(selected === id ? null : id)}
                    className={cn(
                      'w-full rounded border px-3 py-2 text-left font-mono text-[10px]',
                      selected === id ? 'border-acc/60 bg-acc/10' : 'border-line/40 bg-panel/40',
                    )}
                  >
                    <span className="text-acc">{n.name}</span>
                    <span className="ml-2 uppercase text-dim" data-state={st}>
                      {st}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {liveNow && selected && byId[selected] && (
        <section className="rounded border border-acc/30 bg-panel/50 p-3 font-mono text-[10px]" aria-label="Selected agent detail">
          <p className="text-acc">{byId[selected].name}</p>
          <p className="text-dim">role: {byId[selected].role}</p>
          <p className="text-dim">status: {states[selected] ?? 'pending'}</p>
        </section>
      )}

      {liveNow && (
        <>
          <section className="rounded border border-line/40 bg-panel/40 p-3" aria-label="Campaign control">
            <CampaignTargetPicker
              value={targetPick}
              onChange={setTargetPick}
              operatorRole={op.session?.role}
              running={running}
              variant="world"
            />
            <CampaignStartFeedback events={events} />
            {startError && (
              <p className="mt-2 font-mono text-[10px] text-crit" role="alert">
                {startError}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              {running ? (
                <button type="button" className="world-btn world-btn-crit text-[10px]" onClick={() => void live.abort()}>
                  abort campaign
                </button>
              ) : (
                <button type="button" className="world-btn text-[10px]" onClick={() => void onStartCampaign()}>
                  start campaign
                </button>
              )}
            </div>
          </section>
          <section className="font-mono text-[10px] text-dim">
            <p>connected: {connected ? 'yes' : 'offline demo'}</p>
            <p>operator: {op.authStatus}</p>
            <p>campaign: {running ? 'running' : status?.stopped_reason ?? 'standby'}</p>
          </section>
          <OperatorDock visible missionControlLive />
        </>
      )}

      {liveNow && (
        <a href="/command" className="world-ctl self-start">
          continue in ops mode
        </a>
      )}
    </main>
  );
}
