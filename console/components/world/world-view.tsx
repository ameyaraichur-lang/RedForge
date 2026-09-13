'use client';

declare global {
  interface Window {
    __RF_RESET_SUMMON_CAPTURE__?: () => void;
    /** Evidence capture — hold greeting in speaking until released. */
    __RF_CAPTURE_SPEAKING_HOLD__?: boolean;
    __RF_RELEASE_SPEAKING_HOLD__?: () => void;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { nodeStatesFromEvents, useLive } from '@/lib/live';
import { worldBus } from '@/lib/world-bus';
import { useWorldDemo } from '@/lib/world-demo';
import { WORLD_THEMES, readThemeName, writeThemeName, type WorldThemeName } from '@/lib/world-theme';
import { fetchWorldManifest, type WorldManifest } from '@/lib/world-manifest';
import {
  type EntryPhase,
  isHeadCloseUp,
  isHeroPhase,
  isMissionControlLive,
  markEntryComplete,
  resolveInitialEntry,
  transitionEntry,
  type EntryContext,
} from '@/lib/entry-fsm';
import { readCaptureMode } from '@/lib/entry-capture';
import type { GpuAssemblyState } from '@/lib/assembly-convergence';
import { setMissionControlLive } from '@/lib/mission-control-gate';
import {
  SUMMON_DURATION_MS,
  SUMMON_DURATION_S,
  clearSummonAnchor,
  getSummonDiagnostics,
  getSummonProgress,
  installSummonCaptureHooks,
  isSummonComplete,
  publishSummonDiagnostics,
  resetSummonAnchor,
  setSummonHold,
} from '@/lib/summon-anchor';
import {
  SUMMON_HUD_START_T,
  summonAmbientReveal,
  summonHeadFade,
  summonHudReveal,
  summonPlanetReveal,
} from '@/lib/summon-easing';
import { OrchestratorHead } from '@/components/world/orchestrator-head';
import { SkyTraffic } from '@/components/world/sky-traffic';
import { CameraRig, SwarmConstellation } from '@/components/world/swarm';
import {
  AudioField,
  Diagnostics,
  FleetRadar,
  ObjectiveBanner,
  ReactorGauges,
  TerminalFeed,
  WorldReplay,
  WorldStatusBar,
  useBusSnapshot,
} from '@/components/world/instruments';
import { WorldCaptions, CommandEcho } from '@/components/world/captions';
import { NodeHologram } from '@/components/world/node-hologram';
import { ReadinessPrompt } from '@/components/world/readiness-prompt';
import { OperatorDock } from '@/components/world/operator-dock';
import { NoWebGLFallback } from '@/components/world/no-webgl-fallback';
import { HeroEntryChrome } from '@/components/world/hero-entry-chrome';
import { EntryAuthPanel } from '@/components/world/entry-auth-panel';
import { useOperator } from '@/lib/operator-context';
import { onVoiceEnergy, speakViaGateway } from '@/lib/voice';

type QualityTier = 'high' | 'medium' | 'low';

function readQualityTier(): QualityTier {
  if (typeof window === 'undefined') return 'high';
  const stored = window.localStorage.getItem('rf-quality');
  if (stored === 'low' || stored === 'medium') return stored;
  return 'high';
}

function WorldTicker() {
  useFrame((_, dt) => worldBus.tick(Math.min(dt, 0.1)));
  return null;
}

export function WorldView() {
  const live = useLive();
  const operator = useOperator();
  const { connected, status, events, start, abort, voiceOn } = live;
  const { privacyMuted } = operator;
  const [themeName, setThemeName] = useState<WorldThemeName>('violet');
  const [selected, setSelected] = useState<string | null>(null);
  const [replayPos, setReplayPos] = useState<number | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [quality, setQuality] = useState<QualityTier>('high');
  const [sceneReady, setSceneReady] = useState(false);
  const [audioEnergy, setAudioEnergy] = useState(0);
  const [manifest, setManifest] = useState<WorldManifest | null>(null);
  const [phase, setPhase] = useState<EntryPhase>('initializing');
  const [headPreFormed, setHeadPreFormed] = useState(false);
  const [bloomStart, setBloomStart] = useState<number | null>(null);
  const [summonT, setSummonT] = useState(0);
  const buildCtxRef = useRef<EntryContext | null>(null);
  const [entryDecision, setEntryDecision] = useState<ReturnType<typeof resolveInitialEntry> | null>(null);
  const [heroCaption, setHeroCaption] = useState('RedForge systems initializing…');
  const [captureMode, setCaptureMode] = useState<ReturnType<typeof readCaptureMode> | null>(null);
  const [visualAssemblyProgress, setVisualAssemblyProgress] = useState(0);
  const [gpuState, setGpuState] = useState<GpuAssemblyState | null>(null);
  const ingested = useRef(0);
  const initDone = useRef(false);
  const greetDone = useRef(false);
  const phaseRef = useRef<EntryPhase>(phase);
  phaseRef.current = phase;
  const paramsRef = useRef<URLSearchParams>(new URLSearchParams());

  useEffect(() => {
    setThemeName(readThemeName());
    setQuality(readQualityTier());
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    installSummonCaptureHooks();
    void fetchWorldManifest().then(setManifest).catch(() => {});
    return onVoiceEnergy((s) => {
      setAudioEnergy(s.energy);
      operator.setSpeakingEnergy(s.energy);
    });
  }, [operator]);

  const buildCtx = useCallback((): EntryContext => {
    const params = paramsRef.current;
    return {
      repeatVisit: window.sessionStorage.getItem('rf-world-booted') === '1',
      campaignRunning: status?.running ?? false,
      bootSkip: params.get('boot') === 'skip',
      bootFast: params.get('boot') === 'fast',
      capturePhase: params.get('phase'),
      authRequired:
        operator.authConfig?.auth_mode === 'secure' && operator.authStatus !== 'authenticated',
      authReady: operator.authStatus === 'authenticated',
      reducedMotion,
      webglOk,
    };
  }, [status, operator.authStatus, operator.authConfig?.auth_mode, reducedMotion, webglOk]);

  useEffect(() => {
    buildCtxRef.current = buildCtx();
  });

  useEffect(() => {
    if (initDone.current || operator.authStatus === 'initializing' || !operator.authConfig) return;
    initDone.current = true;
    const params = new URLSearchParams(window.location.search);
    paramsRef.current = params;
    if (params.get('nowebgl') === '1') {
      setWebglOk(false);
    } else {
      try {
        const c = document.createElement('canvas');
        if (!c.getContext('webgl2') && !c.getContext('webgl')) setWebglOk(false);
      } catch {
        setWebglOk(false);
      }
    }
    const ctx = buildCtx();
    const cap = readCaptureMode(params);
    const decision = resolveInitialEntry(ctx);
    setCaptureMode(cap);
    setEntryDecision(decision);
    let initial = decision.phase === 'skipped' ? 'mission_control' : decision.phase;
    let preFormed = decision.headPreFormed;
    if (cap.assemblyProgress != null && cap.assemblyProgress < 1) {
      initial = 'assembling';
      preFormed = false;
    } else if (cap.assemblyProgress != null && cap.assemblyProgress >= 1 && !ctx.bootSkip) {
      preFormed = true;
      if (initial === 'initializing') initial = 'assembling';
    }
    if (cap.summonProgress != null) {
      initial = 'summoning';
      preFormed = true;
      setSummonT(cap.summonProgress);
      setBloomStart(performance.now() - cap.summonProgress * 5000);
    }
    if (cap.assemblyProgress != null) {
      setVisualAssemblyProgress(cap.assemblyProgress);
      if (cap.assemblyProgress >= 1) {
        setBloomStart(performance.now() - 8000);
        setHeadPreFormed(true);
      }
    }
    const capturePhase = params.get('phase');
    if (capturePhase === 'mission_control' || capturePhase === 'planets') {
      initial = 'mission_control';
      preFormed = true;
      setBloomStart(performance.now() - 8000);
    }
    setPhase(initial);
    setHeadPreFormed(preFormed);
    if (decision.showMissionControl && initial === 'mission_control') setBloomStart(performance.now() - 10000);
    setSceneReady(true);
  }, [operator.authStatus, operator.authConfig, buildCtx]);

  useEffect(() => {
    setMissionControlLive(isMissionControlLive(phase));
  }, [phase]);

  useEffect(() => {
    if (phase === 'speaking') operator.setMicEnabled(false);
  }, [phase, operator]);

  useEffect(() => {
    if (phase !== 'assembling') return;
    const root = document.querySelector<HTMLElement>('main[data-entry-phase]');
    if (!root) return;
    root.setAttribute('data-gpu-shell-progress', '0.000');
    root.setAttribute('data-gpu-core-progress', '0.000');
    root.setAttribute('data-gpu-convergence', '0.000');
    root.setAttribute('data-assembly-visual-progress', '0.000');
    root.setAttribute('data-assembly-elapsed-ms', '0');
  }, [phase]);

  useEffect(() => {
    if (operator.authStatus === 'initializing') return;
    const ctx = buildCtx();
    if (ctx.bootSkip && ctx.authRequired && !ctx.authReady && phase === 'awaiting_entry') {
      setPhase('authenticating');
    }
  }, [operator.authStatus, operator.authConfig?.auth_mode, phase, buildCtx]);

  useEffect(() => {
    if (operator.authStatus === 'initializing') return;
    if (phase === 'authenticating' && operator.authStatus === 'authenticated') {
      setPhase((p) => transitionEntry(p, 'auth_ready', buildCtx()));
    }
  }, [operator.authStatus, phase, buildCtx]);

  useEffect(() => {
    if (phase === 'assembling' && headPreFormed && entryDecision?.skipAssembly) {
      setPhase('awaiting_entry');
    }
  }, [phase, headPreFormed, entryDecision?.skipAssembly]);

  useEffect(() => {
    if (operator.authStatus === 'initializing' || !sceneReady) return;
    if (phase === 'initializing') {
      setPhase((p) => transitionEntry(p, 'scene_ready', buildCtx()));
    }
  }, [operator.authStatus, sceneReady, phase, buildCtx]);

  useEffect(() => {
    const entryLocked =
      phase === 'assembling' ||
      phase === 'greeting' ||
      phase === 'awaiting_entry' ||
      phase === 'listening' ||
      phase === 'speaking' ||
      phase === 'summoning' ||
      phase === 'authenticating';
    if (!isMissionControlLive(phase) && status?.running && !entryLocked) {
      markEntryComplete();
      setHeadPreFormed(true);
      setBloomStart(performance.now() - 10000);
      setPhase('mission_control');
    }
  }, [status, phase]);

  const onGpuState = useCallback((state: GpuAssemblyState) => {
    setGpuState(state);
    if (typeof window !== 'undefined') {
      window.__RF_ASSEMBLY_DIAG__ = {
        elapsedMs: state.assemblyElapsedMs,
        shell: state.shellProgress,
        convergence: state.convergence,
        progress: state.progress,
      };
    }
    const root = document.querySelector<HTMLElement>('main[data-entry-phase]');
    if (!root) return;
    root.setAttribute('data-gpu-shell-progress', state.shellProgress.toFixed(3));
    root.setAttribute('data-gpu-core-progress', state.coreProgress.toFixed(3));
    root.setAttribute('data-gpu-convergence', state.convergence.toFixed(3));
    root.setAttribute('data-gpu-listen', state.listen.toFixed(3));
    root.setAttribute('data-gpu-energy', state.energy.toFixed(3));
    root.setAttribute('data-gpu-fade', state.fade.toFixed(3));
    root.setAttribute('data-assembly-visual-progress', state.progress.toFixed(3));
    root.setAttribute('data-assembly-elapsed-ms', String(Math.round(state.assemblyElapsedMs)));
  }, []);

  const onHeadAssembled = useCallback(() => {
    setVisualAssemblyProgress(1);
    setHeadPreFormed(true);
    setPhase((p) => {
      if (p !== 'assembling') return p;
      const next = transitionEntry(p, 'assembly_complete', buildCtx());
      if (next !== 'greeting' || greetDone.current) return next;
      greetDone.current = true;
      const line = 'RedForge online. All systems nominal. Ready to enter Mission Control?';
      setHeroCaption(line);
      if (voiceOn && !privacyMuted) {
        const finishGreeting = () => {
          setPhase((cur) => transitionEntry(cur, 'greeting_done', buildCtx()));
        };
        if (typeof window !== 'undefined') {
          window.__RF_RELEASE_SPEAKING_HOLD__ = () => {
            window.__RF_CAPTURE_SPEAKING_HOLD__ = false;
            finishGreeting();
          };
        }
        void speakViaGateway(line).finally(() => {
          if (typeof window !== 'undefined' && window.__RF_CAPTURE_SPEAKING_HOLD__) return;
          finishGreeting();
        });
        return 'speaking';
      }
      window.setTimeout(() => setPhase((cur) => transitionEntry(cur, 'greeting_done', buildCtx())), 900);
      return 'greeting';
    });
  }, [buildCtx, voiceOn, privacyMuted]);

  const beginSummon = useCallback(() => {
    markEntryComplete();
    const now = performance.now();
    const preArm = typeof window !== 'undefined' && window.__RF_SUMMON_PRE_ARM__;
    if (preArm) {
      window.__RF_SUMMON_PRE_ARM__ = false;
      setSummonHold(true, now);
    }
    resetSummonAnchor(now, { preserveHold: preArm === true });
    setSummonT(0);
    setPhase('summoning');
    setBloomStart(now);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__RF_RESET_SUMMON_CAPTURE__ = () => {
        if (phaseRef.current !== 'summoning') return;
        resetSummonAnchor();
        setSummonT(0);
      };
    }
    if (phase !== 'summoning') return;
    if (typeof window !== 'undefined' && window.__RF_SUMMON_ANCHOR_MS__ == null) {
      resetSummonAnchor();
    }
    let raf = 0;
    const tick = () => {
      const t = getSummonProgress();
      setSummonT(t);
      const root = document.querySelector<HTMLElement>('main[data-entry-phase]');
      publishSummonDiagnostics(root, t, {
        'data-summon-hud': summonHudReveal(t).toFixed(3),
        'data-summon-planets': summonPlanetReveal(t).toFixed(3),
        'data-summon-ambient': summonAmbientReveal(t).toFixed(3),
        'data-summon-head-fade': summonHeadFade(t).toFixed(3),
      });
      if (typeof window !== 'undefined') {
        const diag = getSummonDiagnostics();
        window.__RF_SUMMON_DIAG__ = {
          ...diag,
          hud: summonHudReveal(t),
          planets: summonPlanetReveal(t),
        };
      }
      if (isSummonComplete()) {
        setSummonT(1);
        publishSummonDiagnostics(root, 1, {
          'data-summon-hud': '1.000',
          'data-summon-planets': '1.000',
          'data-summon-ambient': '1.000',
          'data-summon-head-fade': '0.000',
        });
        clearSummonAnchor();
        setPhase((p) => transitionEntry(p, 'summon_complete', buildCtxRef.current!));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const onSkipBoot = useCallback(() => {
    markEntryComplete();
    setHeadPreFormed(true);
    setBloomStart(performance.now() - 5000);
    setPhase('mission_control');
  }, []);

  const liveNow = isMissionControlLive(phase);
  const hero = isHeroPhase(phase);
  const headClose = isHeadCloseUp(phase);
  const demoEvents = useWorldDemo(!connected);
  const source = connected ? events : demoEvents;
  const effective = useMemo(
    () => (replayPos === null ? source : source.slice(0, replayPos)),
    [source, replayPos],
  );
  const states = useMemo(() => nodeStatesFromEvents(effective), [effective]);
  const running = connected ? (status?.running ?? false) : effective.length > 0;

  useEffect(() => {
    if (source.length < ingested.current || replayPos !== null) {
      worldBus.reset();
      ingested.current = 0;
    }
    for (const e of effective.slice(ingested.current)) worldBus.ingest(e);
    ingested.current = effective.length;
  }, [effective, source.length, replayPos]);

  const onStart = useCallback(() => {
    if (!liveNow) return;
    worldBus.reset();
    ingested.current = 0;
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'run full campaign' }));
    void start(null, 3);
  }, [start, liveNow]);

  const onAbort = useCallback(() => {
    if (!liveNow) return;
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'abort' }));
    void abort();
  }, [abort, liveNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'Tab' && liveNow && manifest) {
        e.preventDefault();
        const order = manifest.pipeline_order;
        const idx = order.findIndex((n) => n === selected);
        setSelected(order[(idx + 1) % order.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, liveNow, manifest]);

  const theme = WORLD_THEMES[themeName];
  const snap = useBusSnapshot(4);
  const toggleTheme = useCallback(() => {
    const next: WorldThemeName = themeName === 'violet' ? 'navy' : 'violet';
    setThemeName(next);
    writeThemeName(next);
  }, [themeName]);

  const setQualityTier = useCallback((q: QualityTier) => {
    setQuality(q);
    window.localStorage.setItem('rf-quality', q);
  }, []);

  const dprMax = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
  // Bloom is part of the hero grammar — the particle bust reads as glowing dust.
  const postFx = quality !== 'low' && !reducedMotion;
  const assemblyDurationMs = entryDecision?.assemblyDurationMs ?? 4000;
  const assemblyRate = 1000 / assemblyDurationMs;
  const assemblyActive = phase === 'assembling';
  const assemblyProgress = captureMode?.assemblyProgress ?? null;
  const displayAssemblyProgress = assemblyProgress ?? visualAssemblyProgress;
  /** Frozen when URL sets ?summon=; live summon uses wall-clock anchor + summonT. */
  const summonProgress =
    captureMode?.summonProgress ?? (phase === 'summoning' ? summonT : null);
  const interactionMode =
    phase === 'speaking' ? 'speaking' : phase === 'listening' ? 'listening' : 'idle';
  const headFade = phase === 'summoning' ? summonHeadFade(summonT) : 1;
  const planetReveal = phase === 'summoning' ? summonPlanetReveal(summonT) : liveNow ? 1 : 0;
  const ambientReveal = phase === 'summoning' ? summonAmbientReveal(summonT) : liveNow ? 1 : 0;
  const hudRevealLive = phase === 'summoning' ? summonHudReveal(summonT) : liveNow ? 1 : 0;
  const summonHudReady = phase === 'summoning' && summonT >= SUMMON_HUD_START_T;
  const mcHudReveal = liveNow ? 1 : summonHudReady ? hudRevealLive : 0;
  const cameraMode = liveNow || phase === 'summoning' ? 'world' : 'head';
  const showSwarm = (phase === 'summoning' && summonT >= 0.15) || liveNow;
  const summonHeroFadeStart = SUMMON_HUD_START_T - 0.1;
  const summonHeroFade =
    phase === 'summoning' && summonT >= SUMMON_HUD_START_T
      ? 0
      : phase === 'summoning' && summonT >= summonHeroFadeStart
        ? Math.max(0, 1 - (summonT - summonHeroFadeStart) / (SUMMON_HUD_START_T - summonHeroFadeStart))
        : phase === 'summoning'
          ? 1
          : 0;
  const summonHeroVisible = phase === 'summoning' && summonHeroFade > 0.02 && hudRevealLive <= 0;
  const showCoreOrb = liveNow;
  const hideChrome = hero || captureMode?.hideChrome || summonHeroVisible;
  const showAmbientScene = !headClose && (liveNow || (phase === 'summoning' && ambientReveal > 0.06));
  const summonDiag =
    phase === 'summoning' || phase === 'mission_control' ? getSummonDiagnostics() : null;
  const showMcInstruments = liveNow || summonHudReady;

  if (!webglOk) {
    return <NoWebGLFallback onEnter={() => setWebglOk(true)} />;
  }

  return (
    <main
      aria-label="RedForge world view"
      data-world-theme={themeName}
      data-entry-phase={phase}
      data-mission-control-live={liveNow ? '1' : '0'}
      data-assembly-visual-progress={displayAssemblyProgress.toFixed(3)}
      data-gpu-shell-progress={(gpuState?.shellProgress ?? 0).toFixed(3)}
      data-gpu-core-progress={(gpuState?.coreProgress ?? 0).toFixed(3)}
      data-gpu-convergence={(gpuState?.convergence ?? 0).toFixed(3)}
      data-gpu-listen={(gpuState?.listen ?? 0).toFixed(3)}
      data-gpu-energy={(gpuState?.energy ?? 0).toFixed(3)}
      data-gpu-fade={(gpuState?.fade ?? 1).toFixed(3)}
      data-summon-t={summonT.toFixed(3)}
      data-summon-hud={mcHudReveal.toFixed(3)}
      data-summon-planets={planetReveal.toFixed(3)}
      data-summon-ambient={ambientReveal.toFixed(3)}
      data-summon-duration-s={SUMMON_DURATION_S.toFixed(1)}
      data-summon-anchor-ms={
        summonDiag?.anchorMs != null ? String(Math.round(summonDiag.anchorMs)) : ''
      }
      data-summon-elapsed-ms={String(Math.round(summonDiag?.elapsedMs ?? 0))}
      data-summon-hold-ms={String(Math.round(summonDiag?.holdMs ?? 0))}
      data-head-formed={headPreFormed ? '1' : '0'}
      data-assembly-active={assemblyActive ? '1' : '0'}
      data-assembly-duration-ms={String(assemblyDurationMs)}
      data-assembly-elapsed-ms={String(Math.round(gpuState?.assemblyElapsedMs ?? 0))}
      data-quality-tier={quality}
      data-post-fx={postFx ? '1' : '0'}
      data-dpr-max={String(dprMax)}
      data-capture={captureMode?.active ? '1' : '0'}
      className="world-root fixed inset-0 overflow-hidden"
      style={
        {
          '--w-ok': theme.ok,
          '--w-warn': theme.warn,
          '--w-crit': theme.crit,
          '--w-dim': theme.dim,
          '--w-halo': theme.halo,
          '--w-radar': theme.radar,
          '--w-audio': theme.audio,
          '--w-text': theme.text,
        } as React.CSSProperties
      }
    >
      {sceneReady && (
        <Canvas
          frameloop="always"
          camera={{ position: [0, 5.5, 27], fov: 50 }}
          dpr={[1, typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, dprMax) : 1]}
          gl={{ antialias: quality !== 'low', powerPreference: quality === 'low' ? 'low-power' : 'high-performance' }}
          onPointerMissed={() => liveNow && setSelected(null)}
        >
          <color attach="background" args={[theme.bg0]} />
          <fog attach="fog" args={[theme.bg0, 34, 92]} />
          <ambientLight intensity={headClose ? 0.35 : 0.55} />
          <WorldTicker />
          <CameraRig
            focusId={liveNow ? selected : null}
            reducedMotion={reducedMotion}
            mode={cameraMode}
            manifest={manifest}
            summonProgress={summonProgress}
          />
          <group position={[0, 0.9, 0]} visible={!liveNow || phase === 'summoning'}>
            <OrchestratorHead
              theme={theme}
              formed={headPreFormed && !assemblyActive}
              onAssembled={onHeadAssembled}
              onProgressChange={setVisualAssemblyProgress}
              onGpuState={onGpuState}
              reducedMotion={reducedMotion}
              audioEnergy={audioEnergy}
              assemblyRate={assemblyRate}
              assemblyDurationMs={assemblyDurationMs}
              assemblyProgress={assemblyProgress}
              assemblyActive={assemblyActive}
              interactionMode={interactionMode}
              summonFade={headFade}
            />
          </group>
          {showCoreOrb && (
            <group position={[0, -2.9, 0]} scale={0.45}>
              {/* Core orb only in mission control — avoids central bloom during hero */}
            </group>
          )}
          {showSwarm && manifest && (
            <SwarmConstellation
              manifest={manifest}
              states={states}
              selected={selected}
              onSelect={setSelected}
              theme={theme}
              bloomStart={bloomStart}
              summonReveal={planetReveal}
            />
          )}
          {showAmbientScene && <SkyTraffic theme={theme} reducedMotion={reducedMotion} />}
          {showAmbientScene && (
            <Grid
              position={[0, -8.5, 0]}
              args={[90, 90]}
              cellSize={2}
              cellThickness={0.6}
              cellColor={theme.grid}
              sectionSize={10}
              sectionThickness={1.1}
              sectionColor={theme.gridSection}
              fadeDistance={80}
              fadeStrength={1.6}
              infiniteGrid
            />
          )}
          {showAmbientScene && !reducedMotion && quality !== 'low' && (
            <Stars radius={90} depth={45} count={quality === 'high' ? 1200 : 500} factor={2.2} saturation={0} fade speed={0.4} />
          )}
          {postFx && (
            <EffectComposer multisampling={quality === 'high' ? 2 : 0}>
              <Bloom
                // Raised threshold with strong intensity: the halo should come
                // from the bright ring cores only. Blooming the dim mid-tones
                // as well is what previously lifted red across the whole figure
                // and desaturated it. The source colours carry no red, so this
                // halo stays cyan instead of washing to white.
                intensity={0.78}
                luminanceThreshold={0.5}
                luminanceSmoothing={0.7}
                mipmapBlur
              />
              <Vignette eskil={false} offset={0.28} darkness={0.55} />
            </EffectComposer>
          )}
        </Canvas>
      )}
      {!sceneReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
          loading scene…
        </div>
      )}

      {!hideChrome && (
        <WorldStatusBar
          themeName={themeName}
          onToggleTheme={toggleTheme}
          quality={quality}
          onQualityChange={setQualityTier}
          entryLabel={liveNow ? 'mission control live' : undefined}
          showVoiceToggle={liveNow}
        />
      )}

      {hero && phase === 'authenticating' && (
        <HeroEntryChrome phase={phase} caption="Secure authentication required before entry.">
          <EntryAuthPanel onAuthenticated={() => setPhase((p) => transitionEntry(p, 'auth_ready', buildCtx()))} />
        </HeroEntryChrome>
      )}

      {hero && phase === 'assembling' && (
        <HeroEntryChrome phase={phase} caption="Telemetry converging into form…">
          {entryDecision?.showSkip && (
            <button type="button" className="world-ctl pointer-events-auto" onClick={onSkipBoot}>
              skip
            </button>
          )}
        </HeroEntryChrome>
      )}
      {hero && phase === 'greeting' && (
        <HeroEntryChrome phase={phase} caption={heroCaption} />
      )}
      {hero && phase === 'summoning' && summonHeroVisible && (
        <HeroEntryChrome
          phase="summoning"
          caption={
            summonT < 0.45
              ? 'Hold position — bust remains locked…'
              : 'Mission Control forming…'
          }
          summonFade={summonHeroFade}
        />
      )}
      {hero && (phase === 'awaiting_entry' || phase === 'listening' || phase === 'speaking') && (
        <HeroEntryChrome
          phase={phase}
          caption={
            phase === 'speaking'
              ? 'Systems ready for your command.'
              : phase === 'listening'
                ? 'Say “yes” to enter Mission Control.'
                : 'Say yes or press Enter to enter Mission Control.'
          }
        >
          <ReadinessPrompt
            phase={phase}
            onEnter={beginSummon}
            onSkip={onSkipBoot}
            showSkip={entryDecision?.showSkip}
            missionControlLive={false}
            allowVoice={operator.authStatus === 'authenticated'}
            onListeningStart={() =>
              setPhase((p) => transitionEntry(p, 'operator_listening', buildCtx()))
            }
            onListeningEnd={() =>
              setPhase((p) => transitionEntry(p, 'operator_idle', buildCtx()))
            }
          />
        </HeroEntryChrome>
      )}

      <div
        className={showMcInstruments ? 'world-reveal' : 'world-hidden'}
        style={{ opacity: mcHudReveal, pointerEvents: mcHudReveal > 0.5 ? 'auto' : 'none' }}
      >
        {showMcInstruments && <ReactorGauges snap={snap} />}
      </div>
      <div
        className={showMcInstruments ? 'world-reveal' : 'world-hidden'}
        style={{ opacity: mcHudReveal, pointerEvents: mcHudReveal > 0.5 ? 'auto' : 'none' }}
      >
        {showMcInstruments && <FleetRadar snap={snap} theme={theme} />}
      </div>
      <div
        className={showMcInstruments ? 'world-reveal' : 'world-hidden'}
        style={{ opacity: mcHudReveal, pointerEvents: mcHudReveal > 0.5 ? 'auto' : 'none' }}
      >
        {showMcInstruments && <AudioField />}
      </div>
      <div
        className={showMcInstruments ? 'world-reveal' : 'world-hidden'}
        style={{ opacity: mcHudReveal, pointerEvents: mcHudReveal > 0.5 ? 'auto' : 'none' }}
      >
        {showMcInstruments && <Diagnostics connected={connected} />}
      </div>
      <div
        className={showMcInstruments ? 'world-reveal' : 'world-hidden'}
        style={{ opacity: mcHudReveal, pointerEvents: mcHudReveal > 0.5 ? 'auto' : 'none' }}
      >
        {showMcInstruments && <TerminalFeed events={effective} running={running} />}
      </div>
      {liveNow && (
        <>
          <WorldCaptions events={effective} running={running} />
          <CommandEcho />
          {selected && (
            <NodeHologram
              nodeId={selected}
              state={states[selected] ?? 'pending'}
              events={effective}
              onClose={() => setSelected(null)}
            />
          )}
          <WorldReplay total={source.length} position={replayPos} onPosition={setReplayPos} />
          <ObjectiveBanner snap={snap} onStart={onStart} onAbort={onAbort} running={running} stopped={status?.stopped_reason} offline={!connected} />
          <OperatorDock visible missionControlLive />
        </>
      )}
    </main>
  );
}
