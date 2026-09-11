'use client';

// Living sky (D9 / WV2-5): rockets crossing the void edge-to-edge every ~2
// minutes, meteoroids with fiery tails every ~1 minute. Pooled, jittered
// timers, additive materials — ambience only, never gameplay-critical.
// Disabled under prefers-reduced-motion.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldTheme } from '@/lib/world-theme';

type Flyer = {
  active: boolean;
  t: number;          // 0..1 along path
  dur: number;        // seconds
  from: THREE.Vector3;
  to: THREE.Vector3;
  nextAt: number;     // clock time of next spawn
};

function randChord(r: number): { from: THREE.Vector3; to: THREE.Vector3 } {
  const pick = () => {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    return new THREE.Vector3(
      r * Math.sin(ph) * Math.cos(th),
      r * Math.cos(ph) * 0.6 + 6,
      r * Math.sin(ph) * Math.sin(th),
    );
  };
  const from = pick();
  let to = pick();
  while (to.distanceTo(from) < r * 1.1) to = pick();
  return { from, to };
}

const ROCKET_PERIOD = 120; // s ± jitter
const METEOR_PERIOD = 60;  // s ± jitter

export function SkyTraffic({ theme, reducedMotion }: { theme: WorldTheme; reducedMotion: boolean }) {
  const rockets = useRef<Array<{ flyer: Flyer; group: THREE.Group | null }>>([]);
  const meteors = useRef<Array<{ flyer: Flyer; group: THREE.Group | null; tailPts: THREE.Points | null }>>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const initFlyer = (f: Flyer, period: number, now: number, dur: number) => {
    f.active = false;
    f.t = 0;
    f.dur = dur;
    f.nextAt = now + Math.random() * period * 0.8 + 2;
  };

  useFrame(({ clock }, dt) => {
    if (reducedMotion) return;
    const now = clock.getElapsedTime();
    const step = Math.min(dt, 0.1);

    // lazily initialize pooled flyers created by the ref callbacks
    for (const r of rockets.current) if (r.flyer.nextAt === undefined) initFlyer(r.flyer, ROCKET_PERIOD, now, 9);
    for (const m of meteors.current) if (m.flyer.nextAt === undefined) initFlyer(m.flyer, METEOR_PERIOD, now, 2.4);

    for (const r of rockets.current) {
      const f = r.flyer;
      if (!f.active) {
        if (now >= f.nextAt && r.group) {
          const { from, to } = randChord(62);
          f.from = from;
          f.to = to;
          f.t = 0;
          f.dur = 8 + Math.random() * 3;
          f.active = true;
        }
        if (r.group) r.group.visible = false;
        continue;
      }
      f.t += step / f.dur;
      if (f.t >= 1) {
        f.active = false;
        f.nextAt = now + ROCKET_PERIOD * (0.75 + Math.random() * 0.5);
        if (r.group) r.group.visible = false;
        continue;
      }
      if (!r.group) continue;
      r.group.visible = true;
      tmp.lerpVectors(f.from, f.to, f.t);
      r.group.position.copy(tmp);
      dummy.position.copy(tmp);
      dummy.lookAt(f.to);
      r.group.quaternion.copy(dummy.quaternion);
      const edge = Math.min(1, Math.min(f.t, 1 - f.t) / 0.12); // fade at ends
      r.group.scale.setScalar(0.6 + edge * 0.6);
    }

    for (const m of meteors.current) {
      const f = m.flyer;
      if (!f.active) {
        if (now >= f.nextAt && m.group) {
          const { from, to } = randChord(48);
          f.from = from;
          f.to = to;
          f.t = 0;
          f.active = true;
        }
        if (m.group) m.group.visible = false;
        continue;
      }
      f.t += step / f.dur;
      if (f.t >= 1) {
        f.active = false;
        f.nextAt = now + METEOR_PERIOD * (0.7 + Math.random() * 0.6);
        if (m.group) m.group.visible = false;
        continue;
      }
      if (!m.group) continue;
      m.group.visible = true;
      tmp.lerpVectors(f.from, f.to, f.t);
      m.group.position.copy(tmp);
      dummy.position.copy(tmp);
      dummy.lookAt(f.to);
      m.group.quaternion.copy(dummy.quaternion);
    }
  });

  if (reducedMotion) return null;

  return (
    <group>
      {/* rockets: slim glow streaks */}
      {Array.from({ length: 3 }, (_, i) => (
        <group
          key={`r${i}`}
          visible={false}
          ref={(el) => {
            if (el) rockets.current[i] = { flyer: rockets.current[i]?.flyer ?? ({} as Flyer), group: el };
          }}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.12, 1.4, 8]} />
            <meshBasicMaterial color={theme.text} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, -1.6]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.22, 3.2]} />
            <meshBasicMaterial color={theme.halo} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* meteoroids: rock + fiery tail + orange light */}
      {Array.from({ length: 2 }, (_, i) => (
        <group
          key={`m${i}`}
          visible={false}
          ref={(el) => {
            if (el) meteors.current[i] = meteors.current[i] ?? { flyer: {} as Flyer, group: el, tailPts: null };
          }}
        >
          <mesh>
            <icosahedronGeometry args={[0.38, 0]} />
            <meshStandardMaterial color="#4a3a30" roughness={1} emissive="#ff6a1a" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 0, -1.5]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.5, 3.4, 10, 1, true]} />
            <meshBasicMaterial color="#ff8c1a" transparent opacity={0.38} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0, -2.6]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.22, 2.4, 8, 1, true]} />
            <meshBasicMaterial color="#ffe9b0" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <pointLight color="#ff8c1a" intensity={18} distance={14} />
        </group>
      ))}
    </group>
  );
}
