'use client';

declare global {
  interface Window {
    __RF_ASSEMBLY_HOLD__?: boolean;
    __RF_SUMMON_HOLD__?: boolean;
    __RF_ASSEMBLY_DIAG__?: {
      elapsedMs: number;
      shell: number;
      convergence: number;
      progress: number;
    };
    /** Evidence capture — hold uProgress at 0 until armed after Canvas mount. */
    __RF_DELAY_ASSEMBLY_UNTIL_ARM__?: boolean;
    __RF_ASSEMBLY_CAPTURE_ARMED__?: boolean;
    __RF_RESET_ASSEMBLY_CAPTURE__?: () => void;
    __RF_ASSEMBLY_HOLD_AT__?: number;
    __RF_ASSEMBLY_PAUSED_TOTAL__?: number;
    __RF_SUMMON_HOLD_AT__?: number;
    __RF_SUMMON_PAUSED_TOTAL__?: number;
  }
}

// Particle bust built to the reference grammar:
//  · fine additive dust streaming in along a sweeping ribbon
//  · closely spaced horizontal ridge rings over an anatomical cranium
//  · a bright saturated rim stroke tracing the silhouette
//  · the SAME ridge rings tinted warm across the mid-face (not a separate disc)
//  · a wavy hot core patch, branching amber neck filaments, sternum spark
//  · concave-up concentric chest arcs fanning out to the deltoids
//  · an upward crown plume of escaping dust

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { assemblyConvergence, type GpuAssemblyState } from '@/lib/assembly-convergence';
import {
  CHEST_BOTTOM,
  CHIN_Y,
  CROWN_Y,
  HEAD_H,
  HEAD_RX,
  MIN_SLICE_RADIUS,
  NECK_BOTTOM,
  frontHalfWidth,
  frontSurfaceZ,
  isCrownSlice,
  rimWeightFromNormal,
  sliceMaxRadius,
  surfacePointAt,
} from '@/lib/orchestrator-sdf';
import type { WorldTheme } from '@/lib/world-theme';
import { SignalRings } from '@/components/world/signal-rings';

type Pt = {
  x: number;
  y: number;
  z: number;
  zone: 'shell' | 'core' | 'face';
  /** Silhouette emphasis 0..1 — drives rim colour and grain size. */
  rim: number;
  /** Warm tint weight 0..1 — cool → amber → hot. */
  warm: number;
  size: number;
  band: number;
  priority: number;
  /** 0 hot face patch · 1 neck filament · 2 sternum spark */
  channel: number;
  delay: number;
};

const RIM_FADE_HEIGHT = 0.25;

/** Broad amber wash — semi-axes 0.67 × 0.60 centred (0, 0.09). */
function warmWeight(x: number, y: number): number {
  const u = x / 0.67;
  const v = (y - 0.09) / 0.6;
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  return Math.pow(1 - d, 1.05);
}

/** Modest hot core — semi-axes 0.42 × 0.28 with wavy offset. */
function hotCoreWeight(x: number, y: number): number {
  const wave = Math.sin(x * 8.5 + y * 10.2) * 0.06;
  const u = x / 0.42;
  const v = (y - 0.09 + wave) / 0.28;
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  return Math.pow(1 - d, 1.35);
}

function rnd(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function sampleBust(): Pt[] {
  const pts: Pt[] = [];
  let band = 0;

  // A. Ridge rings — horizontal slices rooted on the SDF zero level set.
  const SLICES = 58;
  for (let i = 0; i <= SLICES; i++) {
    // Ridge rings on head + neck only — torso structure comes from chest arcs.
    const y = NECK_BOTTOM - 0.04 + ((i + 0.5) / (SLICES + 1)) * (CROWN_Y - NECK_BOTTOM + 0.04);
    const bound = sliceMaxRadius(y);
    if (isCrownSlice(y) || bound < MIN_SLICE_RADIUS || frontHalfWidth(y) < MIN_SLICE_RADIUS) continue;
    const count = Math.max(36, Math.round(200 * (bound / HEAD_RX) + 28));
    const pri = y > 0.3 ? 0.02 + (CROWN_Y - y) * 0.05 : 0.12 + (0.3 - y) * 0.16;
    for (let k = 0; k < count; k++) {
      const theta = (k / count) * Math.PI * 2 + rnd(i * 31.7 + k) * 0.035;
      const hit = surfacePointAt(y, theta);
      if (!hit) continue;
      const { p, n } = hit;
      const rim = rimWeightFromNormal(n);
      const ww = warmWeight(p.x, p.y);
      if (ww > 0.04) continue;
      const warm = 0;
      pts.push({
        x: p.x + (rnd(i * 3.3 + k) - 0.5) * 0.007,
        y: p.y,
        z: p.z,
        zone: 'shell',
        rim,
        warm,
        size: 0.66 + rim * 0.38,
        band,
        priority: pri,
        channel: 0,
        delay: pri * 0.2 + (k / count) * 0.05 + rnd(i + k * 7.3) * 0.05,
      });
    }
    band += 1;
  }

  // B. Silhouette rim — head/neck via lateral extrema; torso via continuous forward arc.
  const RIM_STEPS = 760;
  const rimFadeStart = CHEST_BOTTOM + RIM_FADE_HEIGHT;
  for (let i = 0; i <= RIM_STEPS; i++) {
    const y = CHEST_BOTTOM + (i / RIM_STEPS) * (CROWN_Y - CHEST_BOTTOM);
    const rimFade =
      y >= rimFadeStart ? 1 : Math.max(0, (y - CHEST_BOTTOM) / RIM_FADE_HEIGHT);
    if (rimFade < 0.04) continue;
    const yBound = sliceMaxRadius(y);
    if (isCrownSlice(y) || yBound < MIN_SLICE_RADIUS || frontHalfWidth(y) < MIN_SLICE_RADIUS) continue;
    const pri = y > CHIN_Y ? 0.03 + (CROWN_Y - y) * 0.05 : 0.28 + (CHIN_Y - y) * 0.18;
    const isTorso = y < NECK_BOTTOM - 0.08;

    // Torso rim: forward-center arc only — lateral deltoid tips become detached wing loops.
    const THETA_SAMPLES = isTorso ? 96 : 128;
    const thetaStart = isTorso ? Math.PI * 0.22 : 0;
    const thetaEnd = isTorso ? Math.PI * 0.78 : Math.PI;
    for (let k = 0; k <= THETA_SAMPLES; k++) {
      const theta = thetaStart + (k / THETA_SAMPLES) * (thetaEnd - thetaStart);
      const hit = surfacePointAt(y, theta);
      if (!hit || hit.p.z < -0.04) continue;
      if (!isTorso && warmWeight(hit.p.x, hit.p.y) > 0.06) continue;
      const rw = rimWeightFromNormal(hit.n);
      const lateral = Math.abs(hit.p.x) / Math.max(yBound, 0.01);
      if (isTorso && lateral > 0.72) continue;
      const edgeFade = isTorso ? 1 - Math.pow(Math.max(0, lateral - 0.38) / 0.34, 1.8) : 1;
      if (edgeFade < 0.15) continue;
      const centerWeight = isTorso ? 1 - Math.pow(lateral, 2.2) : 0;
      const layers = isTorso ? 2 + Math.round(centerWeight * 2) : 1;
      for (let j = 0; j < layers; j++) {
        pts.push({
          x: hit.p.x + (rnd(i * 17.3 + k + j) - 0.5) * 0.01,
          y: hit.p.y + (rnd(i * 3.1 + k + j) - 0.5) * 0.007,
          z: hit.p.z + (rnd(i * 9.7 + k + j) - 0.5) * 0.014,
          zone: 'shell',
          rim: rimFade * edgeFade * (isTorso ? 0.78 + centerWeight * 0.18 : Math.max(0.82, rw)),
          warm: 0,
          size: 0.94 * (0.72 + rimFade * 0.34 + centerWeight * 0.08),
          band,
          priority: pri,
          channel: 0,
          delay: pri * 0.18 + rnd(i + k * 11.9 + j) * 0.05,
        });
      }
    }
  }
  band += 1;

  // B2. Torso fill — front-surface grains bridging neck to deltoids (continuous shoulders).
  for (let i = 0; i <= 36; i++) {
    const y = NECK_BOTTOM - 0.04 - (i / 36) * 0.82;
    const bound = sliceMaxRadius(y);
    if (bound < 0.22) continue;
    for (let k = 0; k <= 48; k++) {
      const x = (-0.92 + (1.84 * k) / 48) * bound * 0.94;
      const z = frontSurfaceZ(y, x);
      if (z < 0.02) continue;
      if (rnd(i * 9.1 + k * 4.3) > 0.015) continue;
      pts.push({
        x,
        y: y + (rnd(i + k) - 0.5) * 0.012,
        z: z * 0.94,
        zone: 'shell',
        rim: 0.06,
        warm: 0,
        size: 0.68,
        band,
        priority: 0.3 + (i / 28) * 0.2,
        channel: 0,
        delay: 0.2 + (i / 28) * 0.25 + rnd(k * 2.1) * 0.04,
      });
    }
  }
  band += 1;

  // B2c. Upper-shoulder bridge — uniform fill across deltoid slope (no edge-bright wing loops).
  for (let i = 0; i <= 28; i++) {
    const y = NECK_BOTTOM - 0.12 - (i / 28) * 0.66;
    const bound = sliceMaxRadius(y);
    if (bound < 0.28) continue;
    for (let k = 0; k <= 72; k++) {
      const x = (-bound + (2 * bound * k) / 72) * 0.96;
      const z = frontSurfaceZ(y, x);
      if (z < 0.012) continue;
      if (rnd(i * 6.7 + k * 2.9) > 0.008) continue;
      pts.push({
        x,
        y: y + (rnd(i + k) - 0.5) * 0.01,
        z: z * 0.97,
        zone: 'shell',
        rim: 0.14,
        warm: 0,
        size: 0.74,
        band,
        priority: 0.28 + (i / 28) * 0.18,
        channel: 0,
        delay: 0.24 + (i / 28) * 0.2 + rnd(k) * 0.04,
      });
    }
  }
  band += 1;

  // B2b. Trapezius straps — capsule bridge from neck base to deltoids.
  const strap = (x0: number, y0: number, x1: number, y1: number, steps: number, seed: number) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t + Math.sin(t * 5 + seed) * 0.018;
      const y = y0 + (y1 - y0) * t;
      const z = frontSurfaceZ(y, x);
      if (z < 0.01) continue;
      pts.push({
        x,
        y: y + (rnd(i * 3.1 + seed) - 0.5) * 0.01,
        z: z * 0.96,
        zone: 'shell',
        rim: 0.22 + t * 0.18,
        warm: 0,
        size: 0.74,
        band,
        priority: 0.32 + t * 0.12,
        channel: 0,
        delay: 0.22 + t * 0.18 + rnd(i * 5.3 + seed) * 0.04,
      });
    }
  };
  strap(-0.28, NECK_BOTTOM + 0.02, -1.22, -1.94, 52, 8.2);
  strap(0.28, NECK_BOTTOM + 0.02, 1.22, -1.94, 52, 9.4);
  band += 1;

  // B3. Cheek-band cyan shell — dense, bloom-resistant for speaking shell/core separation.
  const cheekY = CHIN_Y + 0.55 * HEAD_H;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 220; k++) {
      const x = side * (0.38 + (k / 219) * 0.54);
      const y = cheekY + (rnd(k * 13.7 + side) - 0.5) * 0.08;
      const z = frontSurfaceZ(y, x);
      if (z < 0.02) continue;
      pts.push({
        x,
        y,
        z: z * 0.99,
        zone: 'shell',
        rim: 0.08,
        warm: 0,
        size: 1.08,
        band,
        priority: 0.12,
        channel: 1,
        delay: 0.1 + rnd(k * 2.3 + side) * 0.06,
      });
    }
  }
  band += 1;

  // B3b. Shoulder-flank cyan shell — lateral bands only (|x| > 0.46), for speaking separation.
  for (let row = 0; row <= 20; row++) {
    const y = 0.22 + (row / 20) * 0.32;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 88; k++) {
        const x = side * (0.46 + (k / 87) * 0.44);
        const z = frontSurfaceZ(y, x);
        if (z < 0.01) continue;
        pts.push({
          x,
          y: y + (rnd(row * 5.1 + k + side) - 0.5) * 0.014,
          z: z * 0.98,
          zone: 'shell',
          rim: 0.04,
          warm: 0,
          size: 1.02,
          band,
          priority: 0.1,
          channel: 1,
          delay: 0.08 + rnd(row * 3.7 + k + side) * 0.05,
        });
      }
    }
  }
  band += 1;

  // B4. Lateral cheek ridge shell — pure cyan on cheek slices for speaking separation.
  const cheekRidgeY = CHIN_Y + 0.52 * HEAD_H;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 56; k++) {
      const theta = side < 0 ? Math.PI * (0.54 + (0.14 * k) / 55) : Math.PI * (0.46 - (0.14 * k) / 55);
      const hit = surfacePointAt(cheekRidgeY, theta);
      if (!hit || hit.p.z < 0.01) continue;
      pts.push({
        x: hit.p.x,
        y: hit.p.y + (rnd(k * 7.1 + side) - 0.5) * 0.012,
        z: hit.p.z,
        zone: 'shell',
        rim: 0.1,
        warm: 0,
        size: 1.05,
        band,
        priority: 0.11,
        channel: 1,
        delay: 0.09 + rnd(k * 3.3 + side) * 0.05,
      });
    }
  }
  band += 1;

  // C. Chest arcs — concave-up rings bounded by the SDF silhouette.
  const ARCS = 22;
  const CHEST_ARC_SPAN = (Math.PI / 2) * 0.92;
  for (let i = 0; i < ARCS; i++) {
    const R = 0.34 + (i / (ARCS - 1)) * 2.08;
    const count = Math.round(200 + R * 118);
    const pri = 0.38 + (i / ARCS) * 0.38;
    for (let k = 0; k <= count; k++) {
      const aNorm = -1 + (2 * k) / count;
      const a = aNorm * CHEST_ARC_SPAN;
      const x = Math.sin(a) * R;
      const y = NECK_BOTTOM - Math.cos(a) * R * 0.72;
      if (y < CHEST_BOTTOM || y > NECK_BOTTOM) continue;
      const bound = sliceMaxRadius(y);
      if (Math.abs(x) > bound * 0.985) continue;
      const lateral = Math.abs(aNorm);
      const centerBias = Math.pow(1 - lateral, 0.85);
      if (rnd(i * 5.3 + k * 2.1) > 0.004 + (1 - centerBias) * 0.04) continue;
      const edge = Math.pow(Math.abs(x) / Math.max(bound, 0.01), 1.6);
      pts.push({
        x,
        y: y + (rnd(i * 5.3 + k) - 0.5) * 0.014,
        z: frontSurfaceZ(y, x) * 1.02,
        zone: 'shell',
        rim: 0.58 + edge * 0.38,
        warm: 0,
        size: 1.62 + edge * 0.48,
        band,
        priority: pri,
        channel: 0,
        delay: pri * 0.16 + lateral * 0.1 + rnd(i + k * 3.7) * 0.05,
      });
    }
    band += 1;
  }

  // C2. Fine radial fan between the chest arcs.
  for (let i = 0; i < 62; i++) {
    const aNorm = -1 + (2 * i) / 61;
    const a = aNorm * CHEST_ARC_SPAN * 0.98;
    const centerBias = Math.pow(1 - Math.abs(aNorm), 0.8);
    for (let k = 0; k < 42; k++) {
      const R = 0.45 + (k / 41) * 2.0;
      const x = Math.sin(a) * R;
      const y = NECK_BOTTOM - Math.cos(a) * R * 0.72;
      if (y < CHEST_BOTTOM || y > NECK_BOTTOM) continue;
      const bound = sliceMaxRadius(y);
      if (Math.abs(x) > bound * 0.96) continue;
      if (rnd(i * 7.9 + k * 3.3) > 0.01 + (1 - centerBias) * 0.12) continue;
      pts.push({
        x,
        y,
        z: frontSurfaceZ(y, x) * 0.58,
        zone: 'shell',
        rim: 0,
        warm: 0,
        size: 0.64,
        band,
        priority: 0.55 + (k / 37) * 0.3,
        channel: 0,
        delay: 0.4 + (k / 37) * 0.2 + rnd(i * 7.9 + k) * 0.06,
      });
    }
  }
  band += 1;

  // D. Amber face fill — shell zone with warm-only shader path (no cyan underlay → no magenta).
  for (let row = 0; row <= 42; row++) {
    for (let k = 0; k <= 124; k++) {
      const x = (-0.5 + k / 124) * 0.78;
      const y = 0.09 + (-0.5 + row / 42) * 0.52;
      const w = warmWeight(x, y);
      if (w < 0.05) continue;
      const hot = hotCoreWeight(x, y);
      const z = frontSurfaceZ(y, x);
      if (z <= 0.02) continue;
      pts.push({
        x: x + (rnd(row * 7.1 + k) - 0.5) * 0.005,
        y: y + (rnd(row * 5.3 + k) - 0.5) * 0.004,
        z: z * 1.06,
        zone: 'shell',
        rim: 0,
        warm: Math.min(0.96, 0.42 + w * 0.48 + hot * 0.38),
        size: 2.05 + w * 0.65 + hot * 0.35,
        band,
        priority: 0.05,
        channel: 0,
        delay: 0.03 + rnd(row * 11.3 + k) * 0.03,
      });
    }
  }
  band += 1;

  // D2. Hot core overlay — normal-blended face pass for yellow-white centre.
  for (let row = 0; row <= 28; row++) {
    for (let k = 0; k <= 96; k++) {
      const x = (-0.5 + k / 96) * 0.68;
      const y = 0.09 + (-0.5 + row / 28) * 0.44;
      const w = warmWeight(x, y);
      const hot = hotCoreWeight(x, y);
      if (hot < 0.12 || w < 0.2) continue;
      const z = frontSurfaceZ(y, x);
      if (z <= 0.02) continue;
      pts.push({
        x,
        y,
        z: z * 1.08,
        zone: 'face',
        rim: 0,
        warm: Math.min(0.95, 0.5 + hot * 0.45),
        size: 1.35 + hot * 0.45,
        band,
        priority: 0.04,
        channel: 0,
        delay: 0.02 + rnd(row * 9.3 + k) * 0.03,
      });
    }
  }
  band += 1;

  // E. Branching amber neck filaments rising from the sternum spark.
  const filament = (x0: number, y0: number, x1: number, y1: number, steps: number, seed: number) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t + Math.sin(t * 7 + seed) * 0.022;
      const y = y0 + (y1 - y0) * t;
      pts.push({
        x,
        y,
        z: frontSurfaceZ(y, x) * 0.98,
        zone: 'core',
        rim: 0,
        warm: 1,
        size: 0.66,
        band,
        priority: 0.34 + t * 0.1,
        channel: 1,
        delay: 0.24 + t * 0.14 + rnd(i * 7.7 + seed) * 0.04,
      });
    }
  };
  filament(0, -1.82, 0, -1.28, 42, 1.1);
  filament(0, -1.28, -0.2, -0.95, 36, 2.3);
  filament(0, -1.28, 0.2, -0.95, 36, 3.7);
  filament(-0.05, -1.52, -0.3, -1.12, 28, 4.9);
  filament(0.05, -1.52, 0.3, -1.12, 28, 6.1);
  band += 1;

  // E2. Sternum spark.
  for (let k = 0; k < 90; k++) {
    const a = rnd(k * 4.1) * Math.PI * 2;
    const rr = Math.sqrt(rnd(k * 8.3)) * 0.085;
    pts.push({
      x: Math.cos(a) * rr,
      y: -1.86 + Math.sin(a) * rr,
      z: 0.34,
      zone: 'core',
      rim: 0,
      warm: 1,
      size: 0.8,
      band,
      priority: 0.3,
      channel: 2,
      delay: 0.3 + rnd(k * 3.9) * 0.08,
    });
  }
  band += 1;

  return pts;
}

/** Evidence/diagnostics — particle counts by zone. */
export function bustParticleCounts(): Record<string, number> {
  const pts = sampleBust();
  const counts: Record<string, number> = { shell: 0, face: 0, core: 0 };
  for (const p of pts) counts[p.zone] = (counts[p.zone] ?? 0) + 1;
  return counts;
}

/** Crown plume plus dust trailing off to the right, as in the reference. */
function sampleDriftParticles(): Float32Array {
  const n = 320;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (i % 5 < 4) {
      // Dense plume hugging the crown, short height.
      const h = Math.pow(rnd(i * 7.3), 1.2);
      const spread = 0.38 * (1 - h * 0.4);
      let a = rnd(i * 2.7) * Math.PI * 2;
      if (Math.abs(Math.cos(a)) < 0.22) a += 0.55;
      const rad = 0.35 + Math.sqrt(rnd(i * 5.1)) * 0.65;
      let px = Math.cos(a) * spread * rad;
      if (Math.abs(px) < 0.12) px = (px >= 0 ? 1 : -1) * (0.16 + rnd(i * 4.9) * 0.2);
      arr[i * 3] = px;
      arr[i * 3 + 1] = CROWN_Y + 0.008 + h * 0.05;
      arr[i * 3 + 2] = Math.sin(a) * spread * 0.55 * Math.sqrt(rnd(i * 11.7));
    } else {
      const t = rnd(i * 3.9);
      arr[i * 3] = 1.15 + t * 2.3;
      arr[i * 3 + 1] = 0.1 + (rnd(i * 11.3) - 0.5) * 2.4;
      arr[i * 3 + 2] = (rnd(i * 13.7) - 0.5) * 1.0;
    }
  }
  return arr;
}

/**
 * Ribbon start positions: particles queue along a sweeping spiral ordered by
 * arrival time, so in-flight dust reads as the reference's comet ribbon and is
 * progressively consumed into the figure.
 */
/** Cubic bezier point — comet ribbon sweeps from far-right tail into the bust. */
function ribbonBezier(t: number): [number, number, number] {
  const u = 1 - t;
  // Elongated comet tail: far upper-right → sweep down-left → hook into bust.
  const p0: [number, number, number] = [9.8, 1.65, -1.75];
  const p1: [number, number, number] = [7.2, 0.15, -1.62];
  const p2: [number, number, number] = [3.8, -0.55, -1.48];
  const p3: [number, number, number] = [0.15, 0.25, -1.28];
  const x = u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0];
  const y = u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1];
  const z = u ** 3 * p0[2] + 3 * u ** 2 * t * p1[2] + 3 * u * t ** 2 * p2[2] + t ** 3 * p3[2];
  return [x, y, z];
}

function ribbonStartPositions(targets: Pt[]): Float32Array {
  const n = targets.length;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = targets[i];
    const s = Math.min(1, Math.max(0, p.priority * 0.55 + p.delay * 0.45));
    // s≈0 near the bust, s≈1 at the far tail of the sweeping ribbon.
    const [bx, by, bz] = ribbonBezier(1 - s);
    const spread = 0.035 + s * 0.14 * (1.05 - s * 0.35);
    arr[i * 3] = bx + (rnd(i * 1.7) - 0.5) * spread;
    arr[i * 3 + 1] = by + (rnd(i * 4.3) - 0.5) * spread * 0.42;
    arr[i * 3 + 2] = bz + (rnd(i * 8.9) - 0.5) * spread * 0.38;
  }
  return arr;
}

const SHELL_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aTarget;
attribute float aDelay;
attribute float aBand;
attribute float aPriority;
attribute float aRim;
attribute float aWarm;
attribute float aChannel;
attribute float aSize;
uniform float uProgress;
uniform float uTime;
uniform float uListen;
uniform float uFade;
uniform float uPixelRatio;
uniform float uSizeScale;
varying float vAlpha;
varying float vRim;
varying float vWarm;
varying float vCheek;

float easeOutCubic(float t) {
  return 1.0 - pow(1.0 - t, 3.0);
}

void main() {
  float lead = clamp((uProgress - aPriority * 0.10) / 0.75, 0.0, 1.0);
  float w = 0.52;
  float slot = clamp((lead - aDelay * (1.0 - w)) / w, 0.0, 1.0);
  float e = easeOutCubic(slot);
  vec3 dir = aTarget - aStart;
  vec3 sweep = cross(normalize(dir + vec3(0.0, 0.001, 0.0)), vec3(0.0, 1.0, 0.0));
  vec3 ctrl = mix(aStart, aTarget, 0.5) + sweep * (1.5 * (fract(aDelay * 4.7) - 0.5));
  vec3 pos = (1.0 - e) * (1.0 - e) * aStart + 2.0 * (1.0 - e) * e * ctrl + e * e * aTarget;
  pos += vec3(
    sin(uTime * 1.1 + aTarget.y * 5.0) * 0.008,
    cos(uTime * 0.9 + aBand * 0.7) * 0.005,
    sin(uTime * 0.85 + aTarget.x * 4.0) * 0.007
  ) * e;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fine dust in flight, settling into crisp structural grains.
  gl_PointSize = aSize * mix(0.6, 1.0, e) * uPixelRatio * (uSizeScale / -mv.z);
  vAlpha = mix(0.26, 0.92, e) * (0.98 + uListen * 0.12) * uFade;
  vRim = aRim * e;
  vWarm = aWarm * e;
  vCheek = step(0.5, aChannel) * e;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uCool;
uniform vec3 uRimCol;
uniform vec3 uWarm;
uniform vec3 uHot;
varying float vAlpha;
varying float vRim;
varying float vWarm;
varying float vCheek;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float grain = smoothstep(0.5, 0.05, d);
  // Cheek-band shell — bloom-resistant cyan for speaking shell/core separation.
  if (vCheek > 0.5) {
    vec3 cy = vec3(0.0, 148.0, 228.0) / 255.0;
    vec3 col = mix(cy, uRimCol, vRim * 0.08);
    gl_FragColor = vec4(col * (1.35 + vRim * 0.15), grain * vAlpha);
    return;
  }
  // Amber face tint — suppress cool shell where warm is high (additive blue+orange → pink).
  float tAmber = vWarm < 0.02 ? 0.0 : smoothstep(0.08, 0.82, vWarm);
  if (tAmber > 0.04) {
    vec3 amber = mix(vec3(1.0, 0.45, 0.04), vec3(1.0, 0.88, 0.55), smoothstep(0.45, 0.92, vWarm));
    float gain = 0.52 + tAmber * 0.1;
    gl_FragColor = vec4(amber * gain, grain * vAlpha * 0.78);
    return;
  }
  vec3 col = uCool;
  col = mix(col, uRimCol, vRim * 0.45);
  float gain = 0.62 + vRim * 0.34;
  gl_FragColor = vec4(col * gain, grain * vAlpha);
}
`;

const FACE_FRAG = /* glsl */ `
varying float vAlpha;
varying float vWarm;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float grain = smoothstep(0.5, 0.04, d);
  float t = smoothstep(0.2, 0.88, vWarm);
  vec3 amber = vec3(1.0, 0.55, 0.12);
  vec3 hot = vec3(1.0, 0.91, 0.64);
  vec3 col = mix(amber, hot, t);
  gl_FragColor = vec4(col, grain * vAlpha);
}
`;

const CORE_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aTarget;
attribute float aDelay;
attribute float aY;
attribute float aPriority;
attribute float aChannel;
attribute float aWarm;
attribute float aSize;
uniform float uProgress;
uniform float uTime;
uniform float uEnergy;
uniform float uFade;
uniform float uPixelRatio;
uniform float uSizeScale;
varying float vAlpha;
varying float vWarm;
varying float vChannel;
varying float vFlow;

float easeOutCubic(float t) {
  return 1.0 - pow(1.0 - t, 3.0);
}

void main() {
  float lead = clamp((uProgress - aPriority * 0.08) / 0.72, 0.0, 1.0);
  float w = 0.50;
  float slot = clamp((lead - aDelay * (1.0 - w)) / w, 0.0, 1.0);
  float e = easeOutCubic(slot);
  vec3 dir = aTarget - aStart;
  vec3 sweep = cross(normalize(dir + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
  vec3 ctrl = mix(aStart, aTarget, 0.52) + sweep * (1.1 * (fract(aDelay * 5.3) - 0.5));
  vec3 pos = (1.0 - e) * (1.0 - e) * aStart + 2.0 * (1.0 - e) * e * ctrl + e * e * aTarget;
  // Speech ripples the hot face patch vertically, as in the reference.
  pos.y += uEnergy * 0.016 * sin(uTime * 7.0 + aTarget.x * 8.0) * e * step(aChannel, 0.5);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * mix(0.55, 1.0, e) * uPixelRatio * (uSizeScale / -mv.z);
  vAlpha = mix(0.32, 0.98, e) * uFade;
  vWarm = aWarm;
  vChannel = aChannel;
  vFlow = e;
}
`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uHot;
uniform float uEnergy;
uniform float uTime;
varying float vAlpha;
varying float vWarm;
varying float vChannel;
varying float vFlow;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float grain = smoothstep(0.5, 0.02, d);
  float pulse = vChannel > 0.5 ? 0.82 + 0.18 * sin(uTime * 3.2 + vWarm * 9.0) : 1.0;
  vec3 col = mix(uWarm, uHot, smoothstep(0.62, 0.96, vWarm * (0.65 + uEnergy * 0.25)));
  gl_FragColor = vec4(col * 0.48 * pulse, grain * vAlpha * vFlow * 0.65);
}
`;

const DRIFT_VERT = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uProgress;
uniform float uPixelRatio;
uniform float uSizeScale;
varying float vAlpha;
void main() {
  vec3 pos = position;
  pos.x += sin(uTime * 0.5 + position.y * 2.0) * 0.1;
  pos.y += cos(uTime * 0.42 + position.x * 1.6) * 0.08;
  pos.z += sin(uTime * 0.34 + position.z * 3.0) * 0.08;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 0.6 * uPixelRatio * (uSizeScale / -mv.z);
  vAlpha = 0.72 * uFade * smoothstep(0.25, 0.85, uProgress);
}
`;

const DRIFT_FRAG = /* glsl */ `
uniform vec3 uCool;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uCool, smoothstep(0.5, 0.0, d) * vAlpha);
}
`;

const ASSEMBLY_COMPLETE_CONVERGENCE = 0.97;
/** Perspective size constant — keeps settled grains at ~2-4 physical px. */
const POINT_SIZE_SCALE = 22;
const WARM = '#ff8c1f';
const HOT = '#ffe7a3';

function shellColors(theme: WorldTheme): { cool: string; rim: string; drift: string } {
  return theme.name === 'violet'
    ? { cool: '#4a7aff', rim: '#d8e8ff', drift: '#8cb0ff' }
    : { cool: '#22c8ff', rim: '#ecfcff', drift: '#72e8ff' };
}

export function OrchestratorHead({
  theme,
  formed,
  onAssembled,
  onProgressChange,
  onGpuState,
  reducedMotion,
  audioEnergy = 0,
  assemblyRate = 0.22,
  assemblyDurationMs = 4000,
  assemblyProgress,
  assemblyActive = false,
  interactionMode = 'idle',
  summonFade = 1,
}: {
  theme: WorldTheme;
  formed: boolean;
  onAssembled?: () => void;
  onProgressChange?: (progress: number) => void;
  /** Capture/E2E — reports actual material uniform values each frame. */
  onGpuState?: (state: GpuAssemblyState) => void;
  reducedMotion: boolean;
  audioEnergy?: number;
  assemblyRate?: number;
  /** Wall-clock assembly span — locked at rising edge of assemblyActive. */
  assemblyDurationMs?: number;
  assemblyProgress?: number | null;
  /** When true, advance uProgress; reset to 0 on rising edge. */
  assemblyActive?: boolean;
  interactionMode?: 'idle' | 'listening' | 'speaking';
  summonFade?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const shellMat = useRef<THREE.ShaderMaterial>(null);
  const faceMat = useRef<THREE.ShaderMaterial>(null);
  const coreMat = useRef<THREE.ShaderMaterial>(null);
  const driftMat = useRef<THREE.ShaderMaterial>(null);
  const progressRef = useRef(formed ? 1 : 0);
  const formedRef = useRef(formed);
  const doneRef = useRef(formed);
  const lastReportRef = useRef(-1);
  const assemblyActiveRef = useRef(false);
  const assemblyStartMs = useRef<number | null>(null);
  const lockedDurationSec = useRef(Math.max(assemblyDurationMs, 400) / 1000);

  const effectiveAssemblyElapsedMs = useCallback((): number => {
    if (assemblyStartMs.current === null) return 0;
    const now = performance.now();
    const capturePaused =
      typeof window !== 'undefined' ? window.__RF_ASSEMBLY_PAUSED_TOTAL__ ?? 0 : 0;
    const holdNow =
      typeof window !== 'undefined' && window.__RF_ASSEMBLY_HOLD__ && window.__RF_ASSEMBLY_HOLD_AT__ != null
        ? now - window.__RF_ASSEMBLY_HOLD_AT__
        : 0;
    return Math.max(0, now - assemblyStartMs.current - capturePaused - holdNow);
  }, []);

  const resetAssemblyClock = useCallback(() => {
    progressRef.current = 0;
    doneRef.current = false;
    lastReportRef.current = -1;
    if (typeof window !== 'undefined') {
      window.__RF_ASSEMBLY_PAUSED_TOTAL__ = 0;
      window.__RF_ASSEMBLY_DIAG__ = { elapsedMs: 0, shell: 0, convergence: 0, progress: 0 };
    }
    lockedDurationSec.current = Math.max(assemblyDurationMs, 400) / 1000;
    assemblyStartMs.current = performance.now();
    onProgressChange?.(0);
  }, [assemblyDurationMs, onProgressChange]);

  useLayoutEffect(() => {
    if (assemblyActive && !assemblyActiveRef.current) {
      if (!(typeof window !== 'undefined' && window.__RF_DELAY_ASSEMBLY_UNTIL_ARM__)) {
        resetAssemblyClock();
      }
    } else if (!assemblyActive) {
      assemblyStartMs.current = null;
    }
    assemblyActiveRef.current = assemblyActive;
  }, [assemblyActive, resetAssemblyClock]);

  useEffect(() => {
    window.__RF_RESET_ASSEMBLY_CAPTURE__ = () => {
      assemblyActiveRef.current = true;
      resetAssemblyClock();
    };
    return () => {
      delete window.__RF_RESET_ASSEMBLY_CAPTURE__;
    };
  }, [resetAssemblyClock]);

  useEffect(() => {
    formedRef.current = formed;
    if (formed && !assemblyActive && progressRef.current >= 0.995) {
      progressRef.current = 1;
      doneRef.current = true;
    }
  }, [formed, assemblyActive]);

  const { shellGeo, faceGeo, coreGeo, driftGeo } = useMemo(() => {
    const samples = sampleBust();
    const build = (pts: Pt[]) => {
      const n = pts.length;
      const start = ribbonStartPositions(pts);
      const target = new Float32Array(n * 3);
      const delay = new Float32Array(n);
      const bandAttr = new Float32Array(n);
      const yAttr = new Float32Array(n);
      const priority = new Float32Array(n);
      const channel = new Float32Array(n);
      const rim = new Float32Array(n);
      const warm = new Float32Array(n);
      const size = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        target.set([pts[i].x, pts[i].y, pts[i].z], i * 3);
        delay[i] = pts[i].delay;
        bandAttr[i] = pts[i].band;
        yAttr[i] = pts[i].y;
        priority[i] = pts[i].priority;
        channel[i] = pts[i].channel;
        rim[i] = pts[i].rim;
        warm[i] = pts[i].warm;
        size[i] = pts[i].size;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(target.slice(), 3));
      g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
      g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
      g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
      g.setAttribute('aBand', new THREE.BufferAttribute(bandAttr, 1));
      g.setAttribute('aY', new THREE.BufferAttribute(yAttr, 1));
      g.setAttribute('aPriority', new THREE.BufferAttribute(priority, 1));
      g.setAttribute('aChannel', new THREE.BufferAttribute(channel, 1));
      g.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
      g.setAttribute('aWarm', new THREE.BufferAttribute(warm, 1));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      return g;
    };
    const drift = new THREE.BufferGeometry();
    drift.setAttribute('position', new THREE.BufferAttribute(sampleDriftParticles(), 3));
    return {
      shellGeo: build(samples.filter((p) => p.zone === 'shell')),
      faceGeo: build(samples.filter((p) => p.zone === 'face')),
      coreGeo: build(samples.filter((p) => p.zone === 'core')),
      driftGeo: drift,
    };
  }, []);

  const palette = shellColors(theme);

  const shellUniforms = useRef({
    uProgress: { value: formed ? 1 : 0 },
    uTime: { value: 0 },
    uListen: { value: 0 },
    uFade: { value: 1 },
    uPixelRatio: { value: 1.5 },
    uSizeScale: { value: POINT_SIZE_SCALE },
    uCool: { value: new THREE.Color(palette.cool) },
    uRimCol: { value: new THREE.Color(palette.rim) },
    uWarm: { value: new THREE.Color(WARM) },
    uHot: { value: new THREE.Color(HOT) },
  }).current;

  const coreUniforms = useRef({
    uProgress: { value: formed ? 1 : 0 },
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uFade: { value: 1 },
    uPixelRatio: { value: 1.5 },
    uSizeScale: { value: POINT_SIZE_SCALE },
    uWarm: { value: new THREE.Color(WARM) },
    uHot: { value: new THREE.Color(HOT) },
  }).current;

  const driftUniforms = useRef({
    uTime: { value: 0 },
    uFade: { value: 1 },
    uProgress: { value: formed ? 1 : 0 },
    uPixelRatio: { value: 1.5 },
    uSizeScale: { value: POINT_SIZE_SCALE },
    uCool: { value: new THREE.Color(palette.drift) },
  }).current;

  useEffect(() => {
    const { cool, rim, drift } = shellColors(theme);
    shellMat.current?.uniforms.uCool.value.set(cool);
    shellMat.current?.uniforms.uRimCol.value.set(rim);
    driftMat.current?.uniforms.uCool.value.set(drift);
    shellUniforms.uCool.value.set(cool);
    shellUniforms.uRimCol.value.set(rim);
    driftUniforms.uCool.value.set(drift);
  }, [theme, shellUniforms.uCool, shellUniforms.uRimCol, driftUniforms.uCool]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pr = Math.min(window.devicePixelRatio || 1, 2);

    const assemblyElapsedMs = effectiveAssemblyElapsedMs();

    const captureDelayed =
      typeof window !== 'undefined' &&
      window.__RF_DELAY_ASSEMBLY_UNTIL_ARM__ &&
      !window.__RF_ASSEMBLY_CAPTURE_ARMED__;

    if (assemblyProgress != null) {
      progressRef.current = assemblyProgress;
    } else if (captureDelayed && assemblyActive) {
      progressRef.current = 0;
      assemblyStartMs.current = null;
      if (typeof window !== 'undefined') window.__RF_ASSEMBLY_PAUSED_TOTAL__ = 0;
    } else if (assemblyActive && !doneRef.current) {
      if (assemblyStartMs.current === null) assemblyStartMs.current = performance.now();
      progressRef.current = Math.min(1, assemblyElapsedMs / 1000 / lockedDurationSec.current);
    } else if (!assemblyActive && (formedRef.current || doneRef.current)) {
      progressRef.current = 1;
    }

    const progress = progressRef.current;
    const convergence = assemblyConvergence(progress);
    const listen =
      interactionMode === 'listening'
        ? 0.75 + audioEnergy * 0.2
        : interactionMode === 'speaking'
          ? 0.42 + audioEnergy * 0.12
          : 0;
    const speak = interactionMode === 'speaking' ? Math.max(0.2, audioEnergy * 0.78) : 0;

    const syncMat = (mat: THREE.ShaderMaterial | null, extra?: (u: THREE.ShaderMaterial['uniforms']) => void) => {
      if (!mat) return;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uProgress.value = progress;
      mat.uniforms.uFade.value = summonFade;
      mat.uniforms.uPixelRatio.value = pr;
      extra?.(mat.uniforms);
    };
    syncMat(shellMat.current, (u) => { u.uListen.value = listen; });
    syncMat(faceMat.current);
    syncMat(coreMat.current, (u) => { u.uEnergy.value = speak; });
    syncMat(driftMat.current, (u) => { u.uFade.value = summonFade * 0.85; });

    if (group.current) group.current.rotation.y = Math.sin(t * 0.05) * 0.04;

    const pRounded = Math.round(progress * 1000) / 1000;
    if (pRounded !== lastReportRef.current) {
      lastReportRef.current = pRounded;
      onProgressChange?.(pRounded);
    }

    if (onGpuState) {
      const gpuShell = shellMat.current?.uniforms.uProgress.value ?? -1;
      const gpuCore = coreMat.current?.uniforms.uProgress.value ?? -1;
      onGpuState({
        progress,
        shellProgress: gpuShell,
        coreProgress: gpuCore,
        listen,
        energy: speak,
        fade: summonFade,
        convergence,
        assemblyElapsedMs,
      });
    }

    const assemblyElapsed = assemblyElapsedMs / 1000;
    const assemblyMinElapsed = lockedDurationSec.current * 0.94;
    if (
      !doneRef.current &&
      assemblyActive &&
      progress >= 0.99 &&
      convergence >= ASSEMBLY_COMPLETE_CONVERGENCE &&
      assemblyElapsed >= assemblyMinElapsed
    ) {
      doneRef.current = true;
      progressRef.current = 1;
      onAssembled?.();
    }
  });

  const ringEnergy =
    interactionMode === 'speaking'
      ? Math.max(0.5, audioEnergy)
      : interactionMode === 'listening'
        ? Math.max(0.3, audioEnergy * 0.45 + 0.25)
        : formedRef.current
          ? 0.12
          : 0;

  const ringsActive = interactionMode !== 'idle' || formedRef.current;

  return (
    <group ref={group}>
      <SignalRings
        theme={theme}
        energy={ringEnergy}
        active={ringsActive}
        reducedMotion={reducedMotion}
        mode={interactionMode === 'idle' && formedRef.current ? 'formed' : interactionMode}
      />
      <points geometry={shellGeo} renderOrder={1}>
        <shaderMaterial
          ref={shellMat}
          vertexShader={SHELL_VERT}
          fragmentShader={SHELL_FRAG}
          uniforms={shellUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={faceGeo} renderOrder={5}>
        <shaderMaterial
          ref={faceMat}
          vertexShader={SHELL_VERT}
          fragmentShader={FACE_FRAG}
          uniforms={shellUniforms}
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.NormalBlending}
        />
      </points>
      <points geometry={coreGeo} renderOrder={2}>
        <shaderMaterial
          ref={coreMat}
          vertexShader={CORE_VERT}
          fragmentShader={CORE_FRAG}
          uniforms={coreUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={driftGeo} renderOrder={0}>
        <shaderMaterial
          ref={driftMat}
          vertexShader={DRIFT_VERT}
          fragmentShader={DRIFT_FRAG}
          uniforms={driftUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
