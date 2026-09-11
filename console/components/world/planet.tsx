'use client';

// Planet bodies (D8 polish): every swarm agent is a distinct world — rocky,
// banded gas giant, ice, ocean, nebula, or a blazing star — rendered with one
// shared procedural GLSL material parameterized per node. Gates stay
// crystalline stations. Clarity-first: crisp fresnel atmospheres, no blur.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldBus } from '@/lib/world-bus';

export type PlanetSpec = {
  kind: 'rocky' | 'gas' | 'ice' | 'ocean' | 'nebula' | 'star';
  size: number;           // relative body radius
  colorA: string;         // deep base
  colorB: string;         // highlight
  atmosphere: string;     // fresnel rim
  bands: number;          // 0 = none (gas/ice latitude bands)
  noiseScale: number;     // surface churn
  displacement: number;   // rocky bump (vertex)
  emissive: number;       // 1 = star (self-lit)
  ring?: { inner: number; outer: number; tiltX: number; tiltZ: number };
  moons?: number;
};

export const PLANET_SPECS: Record<string, PlanetSpec> = {
  N0_mission_control: { kind: 'ocean', size: 1.0, colorA: '#0d2f4a', colorB: '#2d8fc4', atmosphere: '#7fe7ff', bands: 0, noiseScale: 2.6, displacement: 0.04, emissive: 0.12, moons: 1 },
  N1_recon: { kind: 'rocky', size: 0.84, colorA: '#5a3a12', colorB: '#ffd066', atmosphere: '#f5b841', bands: 0, noiseScale: 5.0, displacement: 0.11, emissive: 0.15, ring: { inner: 1.5, outer: 1.95, tiltX: 0.65, tiltZ: -0.2 } },
  N2_attack_strategist: { kind: 'rocky', size: 0.82, colorA: '#5f2408', colorB: '#ff8c4d', atmosphere: '#ff8c4d', bands: 0, noiseScale: 3.4, displacement: 0.07, emissive: 0 },
  N3_red_operators: { kind: 'gas', size: 1.28, colorA: '#6e1234', colorB: '#ffb3d1', atmosphere: '#ff4d9d', bands: 7.0, noiseScale: 1.4, displacement: 0, emissive: 0, ring: { inner: 1.55, outer: 2.35, tiltX: 0.42, tiltZ: 0.12 } },
  N4_judge: { kind: 'ice', size: 0.88, colorA: '#06382a', colorB: '#49e8a6', atmosphere: '#3bff9e', bands: 3.0, noiseScale: 2.0, displacement: 0, emissive: 0.05, ring: { inner: 1.4, outer: 2.0, tiltX: 1.25, tiltZ: 0.2 } },
  N5_mutator: { kind: 'nebula', size: 0.78, colorA: '#1d0b3d', colorB: '#b07dff', atmosphere: '#9d5cff', bands: 0, noiseScale: 4.2, displacement: 0.05, emissive: 0.25 },
  N6_chain_builder: { kind: 'ice', size: 1.05, colorA: '#0e2a5e', colorB: '#8ab8ff', atmosphere: '#5ea0ff', bands: 5.0, noiseScale: 1.8, displacement: 0, emissive: 0, ring: { inner: 1.5, outer: 2.6, tiltX: 0.3, tiltZ: -0.35 }, moons: 2 },
  N7_verifier: { kind: 'ocean', size: 0.86, colorA: '#063a36', colorB: '#4fe3c1', atmosphere: '#4fe3c1', bands: 0, noiseScale: 2.2, displacement: 0.02, emissive: 0.15, moons: 1 },
  N8_scorer: { kind: 'star', size: 0.9, colorA: '#7a3c00', colorB: '#fff3c9', atmosphere: '#ffd166', bands: 0, noiseScale: 3.0, displacement: 0, emissive: 1 },
  G1_gatekeeper: { kind: 'rocky', size: 0.62, colorA: '#3a2a06', colorB: '#ffd97a', atmosphere: '#f5b841', bands: 0, noiseScale: 4.0, displacement: 0.05, emissive: 0.3 },
  G2_release: { kind: 'ocean', size: 0.62, colorA: '#0a2c3d', colorB: '#a8e9ff', atmosphere: '#7fe7ff', bands: 0, noiseScale: 3.0, displacement: 0.03, emissive: 0.3 },
};

const PLANET_VERT = /* glsl */ `
uniform float uTime;
uniform float uDisplacement;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  vPos = position;
  float bump = noise(position * 4.0 + uTime * 0.05) - 0.5;
  vec3 displaced = position + normal * bump * uDisplacement;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const PLANET_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAtmosphere;
uniform float uBands;
uniform float uNoiseScale;
uniform float uEmissive;
uniform float uActive;   // 0..1 — event glow brightens the world
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.3; a *= 0.5; }
  return v;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);

  // surface: latitude bands (gas/ice) churned by fbm
  float lat = vPos.y;                       // object-space latitude
  float bandWave = 0.5 + 0.5 * sin(lat * uBands * 6.2831 + fbm(vPos * uNoiseScale + uTime * 0.03) * 2.2);
  float churn = fbm(vPos * uNoiseScale + vec3(uTime * 0.04, 0.0, uTime * 0.02));
  float surface = mix(churn, bandWave, clamp(uBands * 0.22, 0.0, 1.0));

  vec3 col = mix(uColorA, uColorB, clamp(surface, 0.0, 1.0));

  // terminator shading (soft directional light) — keeps bodies spherical
  float light = clamp(dot(n, normalize(vec3(0.55, 0.5, 0.68))), 0.0, 1.0);
  col *= 0.42 + 0.72 * light;

  // star: self-lit, white-hot churn
  col = mix(col, mix(uColorA * 2.0, uColorB, surface * surface) * (1.4 + 0.25 * sin(uTime * 2.0)), uEmissive);

  // event activity lifts everything toward its highlight
  col = mix(col, uColorB, uActive * 0.35);

  // fresnel atmosphere rim
  col += uAtmosphere * pow(fres, 1.6) * (0.45 + uActive * 0.9 + uEmissive * 0.7);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function PlanetBody({ spec, nodeId }: { spec: PlanetSpec; nodeId: string }) {
  const body = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const moons = useRef<THREE.Group>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(spec.colorA) },
      uColorB: { value: new THREE.Color(spec.colorB) },
      uAtmosphere: { value: new THREE.Color(spec.atmosphere) },
      uBands: { value: spec.bands },
      uNoiseScale: { value: spec.noiseScale },
      uEmissive: { value: spec.emissive },
      uActive: { value: 0 },
    }),
    [spec],
  );

  // weak import cycle avoidance: world-bus is state-only
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (material.current) {
      material.current.uniforms.uTime.value = t;
      material.current.uniforms.uActive.value = Math.min(
        1,
        (worldBus.nodeGlow[nodeId] ?? 0) + worldBus.coreEnergy * 0.35,
      );
    }
    if (body.current) {
      body.current.rotation.y = t * 0.12 + hashSeed(nodeId);
    }
    if (moons.current) {
      moons.current.rotation.y = t * 0.35;
    }
  });

  const geo = useMemo(() => new THREE.IcosahedronGeometry(spec.size, 4), [spec.size]);

  return (
    <group>
      <mesh ref={body} geometry={geo}>
        <shaderMaterial
          ref={material}
          vertexShader={PLANET_VERT}
          fragmentShader={PLANET_FRAG}
          uniforms={uniforms}
        />
      </mesh>
      {spec.ring && (
        <mesh rotation={[Math.PI / 2 + spec.ring.tiltX, 0, spec.ring.tiltZ]}>
          <ringGeometry args={[spec.size * spec.ring.inner, spec.size * spec.ring.outer, 96, 1]} />
          <meshBasicMaterial
            color={spec.atmosphere}
            transparent
            opacity={0.34}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
      {spec.emissive > 0.5 && (
        <mesh scale={1.5}>
          <sphereGeometry args={[spec.size, 32, 32]} />
          <shaderMaterial
            vertexShader="varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }"
            fragmentShader="uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0); gl_FragColor = vec4(uC, f * 0.9); }"
            uniforms={{ uC: { value: new THREE.Color(spec.atmosphere) } }}
            transparent
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
      {(() => {
        const moonsCount = spec.moons ?? 0;
        if (moonsCount === 0) return null;
        return (
          <group ref={moons}>
            {Array.from({ length: moonsCount }, (_, i) => {
              const a = (i / moonsCount) * Math.PI * 2;
              const r = spec.size * (1.9 + i * 0.55);
              const y = (i % 2 === 0 ? 1 : -1) * spec.size * 0.35;
              return (
                <mesh key={i} position={[Math.cos(a) * r, y, Math.sin(a) * r]}>
                  <sphereGeometry args={[0.09 + i * 0.02, 10, 10]} />
                  <meshBasicMaterial color={i === 0 ? spec.atmosphere : '#cdd6e4'} />
                </mesh>
              );
            })}
          </group>
        );
      })()}
    </group>
  );
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}
