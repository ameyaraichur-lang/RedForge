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
import { BUST_LANDMARKS, bustRings } from '@/lib/bust-rings.generated';
import { CROWN_Y } from '@/lib/orchestrator-sdf';
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

/**
 * Height over which the bust dissolves into dust above the chest cut. The
 * reference peaks at the shoulder line and fades below it, so this spans most
 * of the chest rather than just hiding the mesh's bottom edge.
 */
const RIM_FADE_HEIGHT = 0.78;

/**
 * Horizontal contour rings sliced offline from a real head/bust scan
 * (scripts/sample_bust_rings.mjs). Anatomy — cranium dome, brow, nose, jaw
 * line, neck taper, deltoid flare — comes from the scan rather than from
 * hand-fitted radius curves, which is what the reference grammar needs: the
 * rings ARE the visual language, so slicing a real surface gives both the
 * silhouette and the striation for free.
 */
const RINGS = bustRings();

function rnd(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type RingVert = {
  x: number;
  z: number;
  /** Camera-facing component of the outward normal, -1 (back) … +1 (front). */
  frontness: number;
  /** Silhouette emphasis: peaks where the surface turns away sideways. */
  rim: number;
};

/** Outward xz normals and rim weights derived from each loop's tangent. */
function ringVerts(verts: Array<[number, number]>): RingVert[] {
  const n = verts.length;
  return verts.map(([x, z], i) => {
    const prev = verts[(i - 1 + n) % n];
    const next = verts[(i + 1) % n];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // Rotate the tangent into a normal, then flip it to point away from the axis.
    let nx = tz;
    let nz = -tx;
    if (nx * x + nz * z < 0) {
      nx = -nx;
      nz = -nz;
    }
    return { x, z, frontness: nz, rim: Math.pow(1 - Math.abs(nz), 1.4) };
  });
}

const RING_VERTS = RINGS.map((r) => ringVerts(r.verts));

const FACE_CENTRE_Y = (BUST_LANDMARKS.browY + BUST_LANDMARKS.chinY) / 2;
const FACE_RY = ((BUST_LANDMARKS.browY - BUST_LANDMARKS.chinY) / 2) * 1.32;
const FACE_RX = BUST_LANDMARKS.headHalfWidth * 0.78;

/**
 * Amber wash over the face. Gated on how strongly the surface faces the camera
 * so the warm tint lands on the face plane instead of wrapping the skull sides.
 */
function warmWeight(x: number, y: number, frontness = 1): number {
  const u = x / FACE_RX;
  const v = (y - FACE_CENTRE_Y) / FACE_RY;
  const d = Math.hypot(u, v);
  if (d >= 1) return 0;
  // Broad plateau with the ramp confined to the outer band. A falloff that
  // starts at the centre leaves most of the face only partly amber, which lets
  // the cool rings mix back in and turns the face magenta.
  const radial = smoothstep(1, 0.7, d);
  // Gate on facing as a near-binary: the oval already bounds the face, so a
  // gradual frontness term would dim the cheeks a second time.
  const facing = smoothstep(-0.12, 0.34, frontness);
  return radial * facing;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Wavy hot centre sitting inside the amber face. */
function hotCoreWeight(x: number, y: number, frontness = 1): number {
  const wave = Math.sin(x * 8.5 + y * 10.2) * 0.05;
  const u = x / (FACE_RX * 0.62);
  const v = (y - FACE_CENTRE_Y + wave) / (FACE_RY * 0.58);
  const d = Math.hypot(u, v);
  if (d >= 1) return 0;
  return Math.pow(1 - d, 1.3) * smoothstep(-0.12, 0.34, frontness);
}

/** Front surface z at a point, looked up from the nearest contour ring. */
function ringFrontZ(y: number, x: number): number {
  let best = -1;
  let bestDy = Infinity;
  for (let i = 0; i < RINGS.length; i++) {
    const dy = Math.abs(RINGS[i].y - y);
    if (dy < bestDy) {
      bestDy = dy;
      best = i;
    }
  }
  if (best < 0) return 0;
  let z = 0;
  let found = false;
  for (const [vx, vz] of RINGS[best].verts) {
    if (Math.abs(vx - x) > 0.09 || vz <= 0) continue;
    if (!found || vz > z) {
      z = vz;
      found = true;
    }
  }
  return found ? z : 0;
}

function sampleBust(): Pt[] {
  const pts: Pt[] = [];
  const { crownY, chestBottom } = BUST_LANDMARKS;

  // A. Ridge rings — the striated shell, straight off the sliced surface.
  RINGS.forEach((ring, ri) => {
    const vs = RING_VERTS[ri];
    if (vs.length < 8) return;

    const rimFade =
      ring.y >= chestBottom + RIM_FADE_HEIGHT
        ? 1
        : Math.max(0, (ring.y - chestBottom) / RIM_FADE_HEIGHT);
    if (rimFade < 0.04) return;

    // Assembly order runs crown-first, chest-last.
    const depth = Math.min(1, Math.max(0, (crownY - ring.y) / (crownY - chestBottom)));
    const pri = 0.02 + depth * 0.84;

    const onHead = ring.zone <= 2;
    const density = onHead ? 150 : 104;
    const count = Math.max(30, Math.round(ring.perimeter * density));

    for (let k = 0; k < count; k++) {
      const t = (k / count) * vs.length;
      const i0 = Math.floor(t) % vs.length;
      const i1 = (i0 + 1) % vs.length;
      const f = t - Math.floor(t);
      const a = vs[i0];
      const b = vs[i1];
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const frontness = a.frontness + (b.frontness - a.frontness) * f;
      const rimW = a.rim + (b.rim - a.rim) * f;

      // Front shell only. Additive points carry no depth occlusion, so cool
      // grains on the back of the skull would shine straight through the face
      // and mix blue into the amber. Keep a sparse fringe just past the
      // silhouette so the edge still has thickness.
      if (frontness < -0.32) continue;
      if (frontness < 0 && rnd(ri * 7.7 + k * 1.3) > 0.16) continue;

      const ww = warmWeight(x, ring.y, frontness);
      const hot = hotCoreWeight(x, ring.y, frontness);
      // Ramp warmth up from the oval edge so the shader can cross-fade cool to
      // amber instead of stepping at the boundary, but keep the body of the
      // face decisively amber.
      const warm = ww > 0.02 ? Math.min(0.98, 0.3 + ww * 0.68 + hot * 0.28) : 0;

      pts.push({
        x: x + (rnd(ri * 3.3 + k) - 0.5) * 0.006,
        y: ring.y + (rnd(ri * 5.1 + k) - 0.5) * 0.005,
        z,
        zone: 'shell',
        // Warm face grains stay flat; cool grains carry the rim gradient.
        rim: warm > 0.08 ? rimW * 0.16 : rimW * rimFade,
        warm,
        // rimFade thins the grains toward the chest cut so the bottom edge
        // dissolves instead of ending on a hard line.
        size: (warm > 0.12 ? 0.78 + warm * 0.22 : 0.64 + rimW * 0.36) * (0.55 + rimFade * 0.45),
        band: ri,
        priority: pri,
        channel: 0,
        delay: pri * 0.2 + (k / count) * 0.05 + rnd(ri + k * 7.3) * 0.05,
      });
    }
  });

  // B. Silhouette rim stroke — extra bright layers at each ring's lateral extrema.
  RINGS.forEach((ring, ri) => {
    const vs = RING_VERTS[ri];
    if (vs.length < 8) return;
    const rimFade =
      ring.y >= chestBottom + RIM_FADE_HEIGHT
        ? 1
        : Math.max(0, (ring.y - chestBottom) / RIM_FADE_HEIGHT);
    if (rimFade < 0.04) return;

    const depth = Math.min(1, Math.max(0, (crownY - ring.y) / (crownY - chestBottom)));
    const pri = 0.02 + depth * 0.84;

    for (const side of [-1, 1]) {
      // Lateral extremum on this side, front hemisphere only.
      let pick: RingVert | null = null;
      for (const v of vs) {
        if (Math.sign(v.x) !== side || v.z < -0.05) continue;
        if (!pick || Math.abs(v.x) > Math.abs(pick.x)) pick = v;
      }
      if (!pick) continue;
      if (warmWeight(pick.x, ring.y, pick.frontness) > 0.06) continue;

      const layers = 3;
      for (let j = 0; j < layers; j++) {
        pts.push({
          x: pick.x + (rnd(ri * 17.3 + j) - 0.5) * 0.009,
          y: ring.y + (rnd(ri * 3.1 + j) - 0.5) * 0.007,
          z: pick.z + (rnd(ri * 9.7 + j) - 0.5) * 0.012,
          zone: 'shell',
          rim: Math.max(0.82, pick.rim) * rimFade,
          warm: 0,
          size: 0.94 * (0.74 + rimFade * 0.32),
          band: ri,
          priority: pri,
          channel: 0,
          delay: pri * 0.18 + rnd(ri + j * 11.9) * 0.05,
        });
      }
    }
  });

  let band = RINGS.length + 1;

  // C. Face hot core — a modest striated centre riding the same ring surface.
  RINGS.forEach((ring, ri) => {
    if (ring.zone !== 1) return;
    const vs = RING_VERTS[ri];
    const count = Math.max(10, Math.round(ring.perimeter * 42));
    for (let k = 0; k < count; k++) {
      const t = (k / count) * vs.length;
      const i0 = Math.floor(t) % vs.length;
      const i1 = (i0 + 1) % vs.length;
      const f = t - Math.floor(t);
      const a = vs[i0];
      const b = vs[i1];
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const frontness = a.frontness + (b.frontness - a.frontness) * f;
      const hot = hotCoreWeight(x, ring.y, frontness);
      if (hot < 0.5) continue;
      pts.push({
        x: x + (rnd(ri * 7.1 + k) - 0.5) * 0.002,
        y: ring.y + (rnd(ri * 5.3 + k) - 0.5) * 0.0015,
        z: z * 1.01,
        zone: 'core',
        rim: 0,
        warm: Math.min(0.96, 0.68 + hot * 0.26),
        size: 0.58 + hot * 0.16,
        band,
        priority: 0.04,
        channel: 0,
        delay: 0.02 + rnd(ri * 9.3 + k) * 0.03,
      });
    }
  });
  band += 1;

  // D. Branching amber neck filaments rising from the sternum spark.
  const filament = (x0: number, y0: number, x1: number, y1: number, steps: number, seed: number) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t + Math.sin(t * 7 + seed) * 0.022;
      const y = y0 + (y1 - y0) * t;
      pts.push({
        x,
        y,
        z: ringFrontZ(y, x) * 0.98,
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
  const sternumY = BUST_LANDMARKS.shoulderY - 0.05;
  const throatY = BUST_LANDMARKS.neckY - 0.1;
  filament(0, sternumY, 0, throatY, 42, 1.1);
  filament(0, throatY, -0.2, throatY + 0.32, 36, 2.3);
  filament(0, throatY, 0.2, throatY + 0.32, 36, 3.7);
  filament(-0.05, (sternumY + throatY) / 2, -0.3, throatY + 0.16, 28, 4.9);
  filament(0.05, (sternumY + throatY) / 2, 0.3, throatY + 0.16, 28, 6.1);
  band += 1;

  // E. Sternum spark.
  for (let k = 0; k < 90; k++) {
    const a = rnd(k * 4.1) * Math.PI * 2;
    const rr = Math.sqrt(rnd(k * 8.3)) * 0.085;
    pts.push({
      x: Math.cos(a) * rr,
      y: sternumY + Math.sin(a) * rr,
      z: Math.max(0.2, ringFrontZ(sternumY, 0)) * 0.9,
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
      arr[i * 3 + 1] = CROWN_Y + 0.006 + h * 0.032;
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
}
`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uCool;
uniform vec3 uRimCol;
uniform vec3 uWarm;
uniform vec3 uHot;
uniform float uListen;
varying float vAlpha;
varying float vRim;
varying float vWarm;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float grain = smoothstep(0.5, 0.05, d);
  float tAmber = vWarm < 0.02 ? 0.0 : smoothstep(0.04, 0.72, vWarm);
  float tHot = smoothstep(0.52, 0.92, vWarm);
  float speaking = smoothstep(0.34, 0.48, uListen);

  vec3 darkAmber = mix(vec3(210.0, 92.0, 16.0), vec3(228.0, 82.0, 10.0), speaking) / 255.0;
  vec3 amber = mix(vec3(238.0, 108.0, 18.0), vec3(252.0, 98.0, 12.0), speaking) / 255.0;
  vec3 warmCol = mix(darkAmber, amber, tAmber);
  warmCol += vec3(1.0, 0.42, 0.04) * tAmber * (0.1 - speaking * 0.04);
  warmCol += vec3(1.0, 0.68, 0.22) * tHot * (0.06 - speaking * 0.04);
  // Matched to the cool ring gain: the face has to actually read amber against
  // the surrounding rings rather than sit under them.
  float warmGain = min(0.82, mix(0.76, 0.7, speaking) + tHot * (0.06 - speaking * 0.02));

  vec3 coolCol = mix(uCool, uRimCol, vRim * 0.28);
  float coolGain = 0.66 + vRim * 0.22;

  // Cross-fade rather than branch: a hard switch draws a visible seam around
  // the face oval, which the reference does not have.
  vec3 col = mix(coolCol * coolGain, warmCol * warmGain, tAmber);
  float warmAlpha = mix(0.92, 0.86, speaking) * (1.0 - tHot * 0.06);
  gl_FragColor = vec4(col, grain * vAlpha * mix(1.0, warmAlpha, tAmber));
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
  float eSpeak = min(uEnergy, 0.24);
  float pulse = vChannel > 0.5 ? 0.82 + 0.18 * sin(uTime * 3.2 + vWarm * 9.0) : 1.0;
  vec3 faceAmber = vec3(1.0, 0.52, 0.1);
  vec3 col = vChannel > 0.5
    ? mix(uWarm, uHot, smoothstep(0.62, 0.96, vWarm))
    : mix(faceAmber, uHot, smoothstep(0.72, 0.96, vWarm * (0.55 + eSpeak * 0.12)));
  float faceDim = vChannel > 0.5 ? 1.0 : (1.0 - eSpeak * 0.12);
  float coreGain = vChannel > 0.5 ? 0.48 : 0.46 * faceDim;
  gl_FragColor = vec4(col * coreGain * pulse, grain * vAlpha * vFlow * 0.52 * faceDim);
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
  // Red is kept near zero in both the body and rim colours. These points blend
  // additively, so wherever rings overlap the channels accumulate and clip:
  // any red in the source climbs toward white and desaturates the figure. The
  // reference holds green roughly 100-140 above red even in its densest areas,
  // which is only reachable if red is not there to accumulate.
  return theme.name === 'violet'
    ? { cool: '#3a6cff', rim: '#7ea8ff', drift: '#8cb0ff' }
    : { cool: '#00c6ff', rim: '#5ceeff', drift: '#72e8ff' };
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

  const { shellGeo, coreGeo, driftGeo } = useMemo(() => {
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
    const speak =
      interactionMode === 'speaking' ? Math.min(0.24, Math.max(0.2, audioEnergy * 0.78)) : 0;

    const syncMat = (mat: THREE.ShaderMaterial | null, extra?: (u: THREE.ShaderMaterial['uniforms']) => void) => {
      if (!mat) return;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uProgress.value = progress;
      mat.uniforms.uFade.value = summonFade;
      mat.uniforms.uPixelRatio.value = pr;
      extra?.(mat.uniforms);
    };
    syncMat(shellMat.current, (u) => { u.uListen.value = listen; });
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
