'use client';

// The RedForge Core (D8 phase 2) — protagonist of the world. Custom GLSL orb
// (fresnel + fbm noise displacement, white-hot center), the signature sunburst
// tick dial counter-rotating around it, two elliptical orbit rings with a
// traveling satellite, and a drifting particle shell. Energy/alert uniforms are
// driven by the world bus inside useFrame — no React re-renders.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldBus } from '@/lib/world-bus';
import type { WorldTheme } from '@/lib/world-theme';

const CORE_VERT = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;

// iq-style value noise fbm — cheap enough for a single hero orb
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
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  float n = fbm(position * 1.6 + vec3(0.0, uTime * 0.22, uTime * 0.14));
  vNoise = n;
  float disp = (n - 0.5) * (0.22 + uEnergy * 0.3);
  vec3 displaced = position + normal * disp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform float uAlert;
uniform vec3 uColorDeep;
uniform vec3 uColorHot;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;

void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
  float breathe = 0.5 + 0.5 * sin(uTime * 1.4);
  float heat = clamp(fres * 0.85 + vNoise * 0.45 + uEnergy * 0.5 + breathe * 0.08, 0.0, 1.0);
  vec3 col = mix(uColorDeep, uColorHot, heat);
  col = mix(col, vec3(1.4, 1.5, 1.6), pow(heat, 3.0) * 0.55); // white-hot center
  col = mix(col, vec3(1.0, 0.22, 0.3), uAlert * (0.35 + 0.3 * sin(uTime * 9.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;

const HALO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 3.0);
  gl_FragColor = vec4(uColor, fres * uOpacity);
}
`;

function SunburstTicks({ theme }: { theme: WorldTheme }) {
  // The signature dial: 56 radial tick lines facing the camera,
  // counter-rotating slowly, brightness modulated by core energy.
  const group = useRef<THREE.Group>(null);
  const COUNT = 56;
  const inst = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () => Array.from({ length: COUNT }, (_, i) => ({
      len: 0.5 + 0.5 * Math.abs(Math.sin(i * 2.399)),
      phase: (i / COUNT) * Math.PI * 2,
    })),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) group.current.rotation.z = -t * 0.05;
    if (!inst.current) return;
    const energy = worldBus.coreEnergy;
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      const r0 = 3.35;
      const len = s.len * (0.7 + 0.5 * Math.sin(t * 1.3 + s.phase * 3) * 0.3 + energy * 0.5);
      dummy.position.set(Math.cos(s.phase) * (r0 + len / 2), Math.sin(s.phase) * (r0 + len / 2), 0);
      dummy.rotation.z = s.phase;
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      inst.current.setMatrixAt(i, dummy.matrix);
    }
    inst.current.instanceMatrix.needsUpdate = true;
    const mat = inst.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.22 + worldBus.coreEnergy * 0.5;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={inst} args={[undefined, undefined, COUNT]}>
        <planeGeometry args={[0.025, 1]} />
        <meshBasicMaterial color={theme.halo} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

function OrbitRing({ radius, tilt, color, speed }: { radius: number; tilt: number; color: string; speed: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const sat = useRef<THREE.Mesh>(null);
  const a = radius;
  const b = radius * 0.38;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * speed;
    if (ring.current) ring.current.rotation.z = t * 0.05;
    if (sat.current) {
      sat.current.position.set(Math.cos(t) * a, Math.sin(t) * b, 0);
      const s = 1 + 0.3 * Math.sin(clock.getElapsedTime() * 4);
      sat.current.scale.setScalar(s);
    }
  });
  return (
    <group rotation={[0.15, tilt, 0.1]}>
      <mesh ref={ring}>
        <ringGeometry args={[0.985, 1.0, 128]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* elliptical path is faked by scaling the whole group */}
      <group scale={[a, b, 1]}>
        <mesh>
          <ringGeometry args={[0.995, 1.003, 160]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={sat}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshBasicMaterial color={color} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Dust({ theme, count = 700 }: { theme: WorldTheme; count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 4.5 + Math.random() * 30;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = (r * Math.cos(ph)) * 0.45;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [count]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.012;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial
        size={0.09}
        color={theme.halo}
        transparent
        opacity={0.5}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function CoreOrb({ theme }: { theme: WorldTheme }) {
  const core = useRef<THREE.ShaderMaterial>(null);
  const halo = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Group>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uAlert: { value: 0 },
      uColorDeep: { value: new THREE.Color(theme.coreDeep) },
      uColorHot: { value: new THREE.Color(theme.core) },
    }),
    [theme],
  );
  const haloUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(theme.halo) },
      uOpacity: { value: 0.9 },
    }),
    [theme],
  );

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    if (core.current) {
      core.current.uniforms.uTime.value = t;
      core.current.uniforms.uEnergy.value = worldBus.coreEnergy;
      core.current.uniforms.uAlert.value = worldBus.alert;
    }
    if (halo.current) {
      halo.current.uniforms.uOpacity.value = 0.65 + worldBus.coreEnergy * 0.5;
    }
    if (group.current) {
      // breathing protagonist — the orb never sits still
      const s = 1 + 0.025 * Math.sin(t * 1.4) + worldBus.coreEnergy * 0.06;
      group.current.scale.setScalar(s);
      group.current.rotation.y = t * 0.06;
      group.current.rotation.y += dt * worldBus.coreEnergy * 0.25;
    }
  });

  return (
    <group>
      <group ref={group}>
        <mesh>
          <icosahedronGeometry args={[2.1, 5]} />
          <shaderMaterial
            ref={core}
            vertexShader={CORE_VERT}
            fragmentShader={CORE_FRAG}
            uniforms={uniforms}
          />
        </mesh>
        {/* additive fresnel halo shell */}
        <mesh scale={1.45}>
          <sphereGeometry args={[2.1, 48, 48]} />
          <shaderMaterial
            ref={halo}
            vertexShader={HALO_VERT}
            fragmentShader={HALO_FRAG}
            uniforms={haloUniforms}
            transparent
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <SunburstTicks theme={theme} />
      </group>
      <OrbitRing radius={3.9} tilt={0.35} color={theme.halo} speed={0.35} />
      <OrbitRing radius={4.8} tilt={-0.5} color={theme.ok} speed={-0.22} />
      <Dust theme={theme} />
      <pointLight position={[0, 0, 0]} intensity={40} color={theme.halo} distance={40} />
    </group>
  );
}
