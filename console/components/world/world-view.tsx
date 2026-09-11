'use client';

// The World View (D8 + D9) — the screen IS the world. Boot is a ritual
// (D9/WV2): the Orchestrator head assembles from ~12k molecules → asks if the
// operator is ready (voice or YES) → summons the agent planets around him →
// instruments materialize → mission goes live. Repeat visits fast-path; a
// running/completed campaign skips straight to live; ?boot=skip serves E2E.
// Offline, a scripted demo loop keeps the world alive. Ops mode stays intact.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, Stars } from '@react-three/drei';
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Scanline,
  Noise,
  Vignette,
} from '@react-three/postprocessing';
import * as THREE from 'three';
import { nodeStatesFromEvents, useLive } from '@/lib/live';
import { worldBus } from '@/lib/world-bus';
import { useWorldDemo } from '@/lib/world-demo';
import {
  WORLD_NODES,
  WORLD_THEMES,
  readThemeName,
  writeThemeName,
  type WorldThemeName,
} from '@/lib/world-theme';
import { CoreOrb } from '@/components/world/core-orb';
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
import { CommandEcho, WorldCaptions } from '@/components/world/captions';
import { NodeHologram } from '@/components/world/node-hologram';
import { ReadinessPrompt } from '@/components/world/readiness-prompt';

function WorldTicker() {
  useFrame((_, dt) => worldBus.tick(Math.min(dt, 0.1)));
  return null;
}

type BootPhase = 'assembling' | 'readyPrompt' | 'bloom' | 'live';

export function WorldView() {
  const live = useLive();
  const { connected, status, events, start, abort } = live;
  const [themeName, setThemeName] = useState<WorldThemeName>('violet');
  const [selected, setSelected] = useState<string | null>(null);
  const [replayPos, setReplayPos] = useState<number | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const ingested = useRef(0);

  // ---------------------------------------------------------- boot ritual
  const [phase, setPhase] = useState<BootPhase>('assembling');
  const [headPreFormed, setHeadPreFormed] = useState(false);
  const [bloomStart, setBloomStart] = useState<number | null>(null);
  const bootedOnce = useRef(false);
  const skipBoot = useRef(false);

  useEffect(() => {
    setThemeName(readThemeName());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    try {
      const c = document.createElement('canvas');
      if (!c.getContext('webgl2') && !c.getContext('webgl')) setWebglOk(false);
    } catch {
      setWebglOk(false);
    }
    // boot routing: ?boot=skip serves E2E; repeat visitors fast-path; a
    // campaign in progress or finished joins straight to live
    const params = new URLSearchParams(window.location.search);
    const prevRun = window.sessionStorage.getItem('rf-world-booted') === '1';
    if (params.get('boot') === 'skip') {
      skipBoot.current = true;
      bootedOnce.current = true;
      setHeadPreFormed(true);
      setPhase('live');
      setBloomStart(performance.now() - 10000);
      return;
    }
    if (prevRun) {
      setHeadPreFormed(true);
      setPhase('readyPrompt');
    }
  }, []);

  // join live only when a campaign is in progress (operator joins mid-fight);
  // a completed campaign still greets with the ritual (prompt every idle load)
  useEffect(() => {
    if (skipBoot.current || phase === 'live' || phase === 'bloom') return;
    if (status?.running) {
      bootedOnce.current = true;
      window.sessionStorage.setItem('rf-world-booted', '1');
      setHeadPreFormed(true);
      setBloomStart(performance.now() - 10000);
      setPhase('live');
    }
  }, [status, phase]);

  const onHeadAssembled = useCallback(() => {
    setPhase((p) => (p === 'assembling' ? 'readyPrompt' : p));
  }, []);

  const onReady = useCallback(() => {
    window.sessionStorage.setItem('rf-world-booted', '1');
    setPhase('bloom');
    setBloomStart(performance.now());
    window.setTimeout(() => setPhase('live'), 5200);
  }, []);

  const liveNow = phase === 'live';

  // --------------------------------------------------------- data wiring
  const demoEvents = useWorldDemo(!connected);
  const source = connected ? events : demoEvents;
  const effective = useMemo(
    () => (replayPos === null ? source : source.slice(0, replayPos)),
    [source, replayPos],
  );
  const states = useMemo(() => nodeStatesFromEvents(effective), [effective]);
  const running = connected ? (status?.running ?? false) : effective.length > 0;

  // event → physics bridge (replay re-ingests a prefix from a clean bus)
  useEffect(() => {
    if (source.length < ingested.current || replayPos !== null) {
      worldBus.reset();
      ingested.current = 0;
    }
    const fresh = effective.slice(ingested.current);
    for (const e of fresh) worldBus.ingest(e);
    ingested.current = effective.length;
  }, [effective, source.length, replayPos]);

  const onStart = useCallback(() => {
    worldBus.reset();
    ingested.current = 0;
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'run full campaign' }));
    void start(null, 3);
  }, [start]);
  const onAbort = useCallback(() => {
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'abort' }));
    void abort();
  }, [abort]);

  // keyboard: tab cycles nodes, escape zooms out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'Tab' && liveNow) {
        e.preventDefault();
        const idx = WORLD_NODES.findIndex((n) => n.id === selected);
        setSelected(WORLD_NODES[(idx + 1) % WORLD_NODES.length].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, liveNow]);

  const theme = WORLD_THEMES[themeName];
  const snap = useBusSnapshot(4);
  const toggleTheme = useCallback(() => {
    const next: WorldThemeName = themeName === 'violet' ? 'navy' : 'violet';
    setThemeName(next);
    writeThemeName(next);
  }, [themeName]);

  if (!webglOk) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-ink" aria-label="RedForge world view">
        <p className="font-mono text-[13px] uppercase tracking-[0.22em] text-warn">
          world view requires webgl
        </p>
        <a href="/mission" className="rounded border border-acc/60 bg-acc/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-acc">
          continue in ops mode
        </a>
      </main>
    );
  }

  const revealCls = liveNow ? 'world-reveal' : 'world-hidden';

  return (
    <main
      aria-label="RedForge world view"
      data-world-theme={themeName}
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
      <Canvas
        camera={{ position: [0, 5.5, 27], fov: 50 }}
        dpr={[1, typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.75) : 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => liveNow && setSelected(null)}
      >
        <color attach="background" args={[theme.bg0]} />
        <fog attach="fog" args={[theme.bg0, 34, 92]} />
        <ambientLight intensity={0.6} />
        <WorldTicker />
        <CameraRig
          focusId={liveNow ? selected : null}
          reducedMotion={reducedMotion}
          mode={liveNow || phase === 'bloom' ? 'world' : 'head'}
        />
        {/* the Orchestrator — protagonist of the ritual and of the mission */}
        <group position={[0, 0.9, 0]}>
          <OrchestratorHead
            theme={theme}
            assembled={headPreFormed}
            onAssembled={onHeadAssembled}
            reducedMotion={reducedMotion}
          />
        </group>
        {/* the arc-core lives on as the orchestrator's chest reactor */}
        <group position={[0, -2.9, 0]} scale={0.5}>
          <CoreOrb theme={theme} />
        </group>
        <SwarmConstellation
          states={states}
          selected={selected}
          onSelect={setSelected}
          theme={theme}
          bloomStart={bloomStart}
        />
        <SkyTraffic theme={theme} reducedMotion={reducedMotion} />
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
        {!reducedMotion && <Stars radius={90} depth={45} count={2400} factor={3.2} saturation={0} fade speed={0.5} />}
        {/* clarity-first post stack: bloom kept (it's glow, not blur); grain,
            scanlines and chromatic fringing dialed down to near-subliminal so
            high-dpi detail stays razor sharp */}
        <EffectComposer multisampling={4}>
          <Bloom intensity={1.0} luminanceThreshold={0.18} luminanceSmoothing={0.8} mipmapBlur />
          <ChromaticAberration offset={new THREE.Vector2(0.00032, 0.00022)} radialModulation={false} modulationOffset={0} />
          <Scanline density={1.4} opacity={0.026} />
          <Noise opacity={0.018} />
          <Vignette eskil={false} offset={0.3} darkness={0.62} />
        </EffectComposer>
      </Canvas>

      {/* diegetic DOM layer — instruments materialize after the summon */}
      <WorldStatusBar themeName={themeName} onToggleTheme={toggleTheme} />
      {phase === 'readyPrompt' && <ReadinessPrompt onYes={onReady} />}
      <div className={revealCls} style={{ animationDelay: '0.2s' }}>
        <ReactorGauges snap={snap} />
      </div>
      <div className={revealCls} style={{ animationDelay: '0.9s' }}>
        <FleetRadar snap={snap} theme={theme} />
      </div>
      <div className={revealCls} style={{ animationDelay: '1.3s' }}>
        <AudioField />
      </div>
      <div className={revealCls} style={{ animationDelay: '1.7s' }}>
        <Diagnostics connected={connected} />
      </div>
      <div className={revealCls} style={{ animationDelay: '0.5s' }}>
        <TerminalFeed events={effective} running={running} />
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
        </>
      )}
    </main>
  );
}
