'use client';

// The Orchestrator (D9 / WV2-2) — the humanoid protagonist assembles from
// ~12k "molecules" into a FEATURELESS head silhouette (D9 amendment: no eyes,
// brows, mouth or nose — the overall shape only, like the reference reel minus
// facial detail). Assembly runs entirely in the vertex shader: each particle
// has start/target/delay attributes and flies a curved bezier path. Once
// formed, the head breathes, shimmers, pulses while speaking, and is fed by
// faint inward streams at the neck.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldTheme } from '@/lib/world-theme';

const HEAD_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aTarget;
attribute float aDelay;   // 0..1 stagger across the assembly window
attribute float aSize;
attribute float aTint;    // 0 = cool white-cyan, 1 = warm gold accent
uniform float uProgress;  // 0..1 assembly
uniform float uTime;
uniform float uEnergy;    // speaking / campaign excitement
uniform float uPixelRatio;
varying float vTint;
varying float vFade;

float easeInOut(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  // per-particle staggered convergence
  float w = 0.38; // travel window per particle
  float t = clamp((uProgress - aDelay * (1.0 - w)) / w, 0.0, 1.0);
  float e = easeInOut(t);

  // curved transit path: control point pushed outward + swirl
  vec3 mid = mix(aStart, aTarget, 0.5);
  vec3 radial = normalize(mid + vec3(0.001));
  vec3 ctrl = mid + radial * (1.6 + 1.4 * fract(aDelay * 7.31));
  vec3 pos =
    (1.0 - e) * (1.0 - e) * aStart +
    2.0 * (1.0 - e) * e * ctrl +
    e * e * aTarget;

  // formed-state life: gentle wobble + slow surface drift
  float formed = t;
  vec3 jitter = vec3(
    sin(uTime * 1.3 + aTarget.y * 5.0 + aDelay * 40.0),
    cos(uTime * 1.1 + aTarget.x * 5.0 + aDelay * 31.0),
    sin(uTime * 0.9 + aTarget.z * 5.0 + aDelay * 23.0)
  ) * 0.028;
  pos += jitter * formed;

  // breathing + speaking expansion
  float breathe = 0.015 * sin(uTime * 1.2);
  float energyScale = 1.0 + breathe + uEnergy * 0.045 * (0.6 + 0.4 * sin(uTime * 6.0));
  pos *= energyScale;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSize * (1.0 + formed * 0.35 + uEnergy * 0.5);
  gl_PointSize = size * uPixelRatio * (140.0 / -mv.z);
  vTint = aTint;
  // fade in during flight, full when landed; traveling sparks are brighter
  vFade = mix(0.35 + 0.65 * sin(e * 3.14159), 1.0, formed);
}
`;

const HEAD_FRAG = /* glsl */ `
uniform vec3 uColorCool;
uniform vec3 uColorWarm;
uniform float uEnergy;
varying float vTint;
varying float vFade;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.05, d);
  vec3 col = mix(uColorCool, uColorWarm, vTint);
  col += uEnergy * 0.25;
  gl_FragColor = vec4(col, soft * vFade);
}
`;

// Streamers: faint particles cycling up into the neck — the head is always fed
const STREAM_VERT = /* glsl */ `
attribute float aOffset;
attribute float aSpeed;
attribute float aSide;
uniform float uTime;
varying float vA;
void main() {
  float cycle = fract(uTime * aSpeed + aOffset);
  float y = mix(-7.0, -2.6, cycle);
  float sway = sin(uTime * 0.8 + aOffset * 20.0) * (0.4 + aSide);
  vec3 pos = vec3(sway, y, cos(uTime * 0.6 + aOffset * 15.0) * 0.3);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.2 * (140.0 / -mv.z);
  vA = (1.0 - cycle) * 0.5;
}
`;
const STREAM_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, smoothstep(0.5, 0.05, d) * vA);
}
`;

/**
 * Featureless humanoid head silhouette (D9): skull dome tapering into jaw and
 * a sparser neck column — shell-distributed particles, no facial features.
 */
function headSurface(): Array<[number, number, number, number]> {
  // returns [x, y, z, tint] samples on/near the silhouette shell
  const pts: Array<[number, number, number, number]> = [];
  const N = 11500;
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    let x: number, y: number, z: number;
    if (r < 0.68) {
      // skull dome + upper head: ellipsoid shell (y 0.15..1.55)
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const dirx = Math.sin(ph) * Math.cos(th);
      const diry = Math.cos(ph);
      const dirz = Math.sin(ph) * Math.sin(th) * 0.92;
      const R = 1.55;
      x = dirx * R;
      y = 0.72 + diry * R * 1.18;
      z = dirz * R - 0.08; // fuller back of head
      if (y < 0.15) {
        const k = 0.15 - y;
        y = 0.15;
        x *= 1 - k * 0.2;
        z *= 1 - k * 0.2;
      }
    } else if (r < 0.9) {
      // jaw taper (y -1.35..0.15): radius shrinks toward the chin
      y = -1.35 + Math.random() * 1.5;
      const k = (0.15 - y) / 1.5; // 0 at top of jaw, 1 at chin
      const rad = 1.42 * (1 - 0.52 * Math.pow(k, 1.35));
      const th = Math.random() * Math.PI * 2;
      x = Math.cos(th) * rad;
      z = Math.sin(th) * rad * 0.9 + 0.1 * (1 - k); // chin forward
    } else {
      // neck column (y -2.6..-1.3), sparser
      y = -2.6 + Math.random() * 1.3;
      const rad = 0.5 + Math.random() * 0.06;
      const th = Math.random() * Math.PI * 2;
      x = Math.cos(th) * rad;
      z = Math.sin(th) * rad;
    }
    // 8% interior scatter for volume
    if (Math.random() < 0.08) {
      x *= 0.55 + Math.random() * 0.3;
      z *= 0.55 + Math.random() * 0.3;
    }
    const tint = Math.random() < 0.06 ? 1 : Math.random() * 0.25; // sparse gold accents
    pts.push([x, y, z, tint]);
  }
  return pts;
}

function startCloud(): Array<[number, number, number]> {
  // loose nebula the molecules fly in from
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 11500; i++) {
    const r = 9 + Math.random() * 16;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pts.push([
      r * Math.sin(ph) * Math.cos(th),
      r * Math.cos(ph) * 0.55 - 0.5,
      r * Math.sin(ph) * Math.sin(th),
    ]);
  }
  return pts;
}

export function OrchestratorHead({
  theme,
  assembled,
  onAssembled,
  reducedMotion,
}: {
  theme: WorldTheme;
  assembled: boolean; // true = skip the flight, render pre-formed
  onAssembled?: () => void;
  reducedMotion: boolean;
}) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const doneRef = useRef(assembled);

  const { geo, streamGeo } = useMemo(() => {
    const targets = headSurface();
    const starts = startCloud();
    const N = targets.length;
    const start = new Float32Array(N * 3);
    const target = new Float32Array(N * 3);
    const delay = new Float32Array(N);
    const size = new Float32Array(N);
    const tint = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      start.set(starts[i], i * 3);
      target.set(targets[i].slice(0, 3), i * 3); // rows are 4-wide [x,y,z,tint]
      // assemble bottom-up (neck first, dome last) like a body forming
      delay[i] = THREE.MathUtils.clamp((1.2 - targets[i][1] / 1.6) * 0.75 + Math.random() * 0.25, 0, 1);
      size[i] = 1.1 + Math.random() * 1.6;
      tint[i] = targets[i][3];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(target.slice(), 3)); // final rest pose
    g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
    g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
    g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));

    const SN = 240;
    const sPos = new Float32Array(SN * 3);
    const sOff = new Float32Array(SN);
    const sSpd = new Float32Array(SN);
    const sSide = new Float32Array(SN);
    for (let i = 0; i < SN; i++) {
      sOff[i] = Math.random();
      sSpd[i] = 0.05 + Math.random() * 0.06;
      sSide[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sg.setAttribute('aOffset', new THREE.BufferAttribute(sOff, 1));
    sg.setAttribute('aSpeed', new THREE.BufferAttribute(sSpd, 1));
    sg.setAttribute('aSide', new THREE.BufferAttribute(sSide, 1));
    return { geo: g, streamGeo: sg };
  }, []);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: assembled ? 1 : 0 },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uPixelRatio: { value: 1.5 },
      uColorCool: { value: new THREE.Color('#bfe9ff') },
      uColorWarm: { value: new THREE.Color('#ffd166') },
    }),
    [assembled],
  );
  const streamUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(theme.halo) }, uTime: { value: 0 } }),
    [theme],
  );

  useFrame(({ clock, size: sz }, dt) => {
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2.75);
    if (!reducedMotion) {
      uniforms.uProgress.value = Math.min(1, uniforms.uProgress.value + dt * 0.2); // ~5s assembly
    } else {
      uniforms.uProgress.value = Math.min(1, uniforms.uProgress.value + dt * 1.5);
    }
    const speaking = typeof window !== 'undefined' && window.speechSynthesis?.speaking;
    // ease toward speaking/energy state — the whole head pulses while talking
    const cur = uniforms.uEnergy.value;
    const want = speaking ? Math.min(1, cur + dt * 3) : Math.max(0, cur - dt * 1.5);
    uniforms.uEnergy.value = want + 0.12 * Math.sin(t * 2.0) * (speaking ? 1 : 0.2);
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.07) * 0.12; // subtle presence turn
    }
    if (!doneRef.current && uniforms.uProgress.value >= 1) {
      doneRef.current = true;
      onAssembled?.();
    }
  });

  return (
    <group ref={group}>
      <points geometry={geo}>
        <shaderMaterial
          ref={mat}
          vertexShader={HEAD_VERT}
          fragmentShader={HEAD_FRAG}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={streamGeo}>
        <shaderMaterial
          vertexShader={STREAM_VERT}
          fragmentShader={STREAM_FRAG}
          uniforms={streamUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      {/* the arc-core: chest reactor beneath the head — the orb lives on */}
      <pointLight position={[0, -3.2, 0.5]} intensity={26} color={theme.halo} distance={18} />
    </group>
  );
}
