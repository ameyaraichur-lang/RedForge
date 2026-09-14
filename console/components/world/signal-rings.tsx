'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldTheme } from '@/lib/world-theme';

/**
 * One depth-separated ripple shell — XY-facing ring visible from hero camera.
 * Rings are deliberately thin strokes: a wide annulus under additive blending
 * fills as a disc rather than reading as a ripple.
 */
function ConcentricRipple({
  color,
  baseRadius,
  expand,
  speed,
  phaseOffset,
  opacityBase,
  z,
  y,
  energy,
  reducedMotion,
  inner = 0.78,
  outer = 1.22,
}: {
  color: string;
  baseRadius: number;
  expand: number;
  speed: number;
  phaseOffset: number;
  opacityBase: number;
  z: number;
  y: number;
  energy: number;
  reducedMotion: boolean;
  inner?: number;
  outer?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    const intensity = Math.max(0.35, energy);
    const cycle = reducedMotion ? 0.38 : (t * speed + phaseOffset) % 1;
    const r = baseRadius + cycle * expand;
    m.scale.set(r, r, 1);
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.opacity = (1 - cycle * cycle) * opacityBase * intensity;
    mat.color.set(color);
    m.visible = mat.opacity > 0.05;
  });

  return (
    <mesh ref={mesh} position={[0, y, z]} renderOrder={-12}>
      <ringGeometry args={[inner, outer, 144]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function SignalRings({
  theme,
  energy,
  active,
  reducedMotion,
  mode = 'idle',
}: {
  theme: WorldTheme;
  energy: number;
  active: boolean;
  reducedMotion: boolean;
  mode?: 'idle' | 'listening' | 'speaking' | 'formed';
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const phases = useMemo(() => Array.from({ length: 6 }, (_, i) => i / 6), []);
  const speaking = mode === 'speaking';
  const listening = mode === 'listening';
  const formed = mode === 'formed';
  const interactive = speaking || listening;

  useFrame(({ clock }) => {
    if (interactive) return;
    const t = clock.getElapsedTime();
    const speed = formed ? 0.07 : 0.1;
    const intensity = active ? Math.max(formed ? 0.14 : 0.18, energy) : 0;
    for (let i = 0; i < phases.length; i++) {
      const mesh = refs.current[i];
      if (!mesh) continue;
      const cycle = reducedMotion ? 0.42 : (t * speed + phases[i]) % 1;
      const r = (formed ? 2.4 : 2.8) + cycle * (formed ? 1.8 : 3.2) * (0.8 + intensity * 0.3);
      mesh.scale.set(r, r, 1);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = active ? (1 - cycle) * (formed ? 0.14 : 0.22) * Math.max(intensity, 0.12) : 0;
      mat.color.set(theme.halo);
      mesh.visible = mat.opacity > 0.03;
    }
  });

  if (!active) return null;

  if (interactive) {
    const e = Math.max(speaking ? 0.55 : 0.48, energy);
    // Both voice states ripple in cool light. Amber ripples read as a large
    // additive disc that buries the cyan shell, and the reference keeps its
    // ripples cool and thin in both states — speech is signalled by the face
    // core going white-hot, not by a warm halo behind the head.
    const inner = speaking ? '#9fe9ff' : '#7ee8ff';
    const mid = speaking ? '#63d6ff' : '#52d4ff';
    const outer = speaking ? '#4accf2' : '#3ec8e8';
    return (
      <group position={[0, 0.02, 0]}>
        <ConcentricRipple
          color={outer}
          baseRadius={1.05}
          expand={0.72}
          speed={speaking ? 0.48 : 0.26}
          phaseOffset={0}
          opacityBase={0.34}
          z={-4.2}
          y={0}
          energy={e}
          reducedMotion={reducedMotion}
          inner={1.16}
          outer={1.24}
        />
        <ConcentricRipple
          color={mid}
          baseRadius={1.28}
          expand={0.78}
          speed={speaking ? 0.36 : 0.2}
          phaseOffset={0.33}
          opacityBase={0.29}
          z={-6.8}
          y={-0.06}
          energy={e}
          reducedMotion={reducedMotion}
          inner={1.14}
          outer={1.21}
        />
        <ConcentricRipple
          color={inner}
          baseRadius={1.52}
          expand={0.84}
          speed={speaking ? 0.28 : 0.16}
          phaseOffset={0.66}
          opacityBase={0.24}
          z={-9.6}
          y={-0.1}
          energy={e}
          reducedMotion={reducedMotion}
          inner={1.12}
          outer={1.18}
        />
      </group>
    );
  }

  return (
    <group position={[0, -0.2, -6.2]} renderOrder={-8}>
      {phases.map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} visible={false}>
          <ringGeometry args={[0.94, 1.32, 128]} />
          <meshBasicMaterial
            color={theme.halo}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
