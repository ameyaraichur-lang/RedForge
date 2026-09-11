'use client';

// The swarm constellation (D8 phase 3): 9 agent nodes + 2 human gates around
// the core, hairline links with diamond gate waypoints and traveling light
// pulses, impact ripples on verdicts, camera-as-navigation with damped fly-to.
// Heavy per-frame state lives on the world bus; React only owns selection.

import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { worldBus, type WorldHandoff } from '@/lib/world-bus';
import {
  WORLD_EDGES,
  WORLD_NODES,
  nodePosition,
  type WorldNode,
  type WorldTheme,
} from '@/lib/world-theme';
import type { NodeState } from '@/lib/live';
import { PLANET_SPECS, PlanetBody } from '@/components/world/planet';

const EDGE_POS: Record<string, [number, number, number]> = {
  CORE: [0, 0, 0],
  ...Object.fromEntries(WORLD_NODES.map((n) => [n.id, nodePosition(n)])),
};

export const EDGE_SEGMENTS: Array<[THREE.Vector3, THREE.Vector3]> = WORLD_EDGES.map(
  ([a, b]) => [new THREE.Vector3(...EDGE_POS[a]), new THREE.Vector3(...EDGE_POS[b])],
);

function EdgeLines({ theme, bloomStart }: { theme: WorldTheme; bloomStart: number | null }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (const [a, b] of EDGE_SEGMENTS) pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const mat = useRef<THREE.LineBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) {
      // links draw in as the constellation blooms (edges stagger ~3.5s)
      const revealT = bloomStart === null ? -1 : (performance.now() - bloomStart) / 1000;
      const k = THREE.MathUtils.clamp((revealT + 0.5) / 3.5, 0, 1);
      mat.current.opacity = 0.55 * k * k;
    }
  });
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial
        ref={mat}
        color={theme.link}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}

/**
 * Handoff choreography (D9 / WV2-6): when agent A finishes and agent B
 * triggers, the A→B link blinks three times while packets stream across —
 * fired exactly once per handoff (bus dedupes by transition).
 */
function HandoffLinks() {
  const seen = useRef<Set<WorldHandoff>>(new Set());
  const lines = useRef<Array<THREE.Line | null>>([]);
  useFrame(() => {
    for (const h of worldBus.handoffs) {
      if (!seen.current.has(h)) {
        seen.current.add(h);
        // stream 6 packets along the edge (speed spread staggers them)
        const idx = WORLD_EDGES.findIndex(([a, b]) => a === h.from && b === h.to);
        if (idx >= 0) {
          for (let k = 0; k < 6; k++) {
            worldBus.spawnPulse(idx, '#ffffff', 1.1 + k * 0.18);
          }
        }
      }
    }
    for (let i = 0; i < 6; i++) {
      const l = lines.current[i];
      if (!l) continue;
      const h = worldBus.handoffs[i];
      if (!h) {
        l.visible = false;
        continue;
      }
      l.visible = true;
      const from = EDGE_POS[h.from] ?? EDGE_POS.CORE;
      const to = EDGE_POS[h.to] ?? EDGE_POS.CORE;
      const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, from[0], from[1], from[2]);
      pos.setXYZ(1, to[0], to[1], to[2]);
      pos.needsUpdate = true;
      const mat = l.material as THREE.LineBasicMaterial;
      mat.opacity = (1 - h.t) * Math.abs(Math.sin(h.t * Math.PI * 6));
    }
  });
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <lineSegments
          key={i}
          visible={false}
          ref={(el) => {
            lines.current[i] = el as unknown as THREE.Line;
          }}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </lineSegments>
      ))}
    </>
  );
}

const PULSE_POOL = 28;

function EdgePulses() {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(() => {
    for (let i = 0; i < PULSE_POOL; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const p = worldBus.pulses[i];
      if (!p) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      const [a, b] = EDGE_SEGMENTS[p.edge];
      const t = p.t;
      // ease so the pulse accelerates out and fades in
      const te = t * t * (3 - 2 * t);
      m.position.lerpVectors(a, b, te);
      m.position.y += Math.sin(te * Math.PI) * 0.35; // slight arc
      const s = 0.5 + Math.sin(te * Math.PI) * 0.9;
      m.scale.setScalar(Math.max(0.05, s));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(p.color);
      mat.opacity = Math.sin(te * Math.PI) * 0.95;
    }
  });
  return (
    <>
      {Array.from({ length: PULSE_POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.16, 10, 10]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function GateCrystal({ color, active }: { color: string; active: boolean }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (outer.current) {
      outer.current.rotation.y = t * 0.5;
      outer.current.rotation.x = Math.sin(t * 0.4) * 0.25;
      outer.current.scale.setScalar(active ? 1 + 0.12 * Math.sin(t * 5) : 1);
    }
    if (inner.current) {
      inner.current.rotation.y = -t * 0.9;
      inner.current.rotation.z = t * 0.4;
    }
  });
  return (
    <group>
      <mesh ref={outer}>
        <octahedronGeometry args={[0.66, 0]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={inner}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight color={color} intensity={6} distance={6} />
    </group>
  );
}

function SwarmNode({
  node,
  state,
  selected,
  onSelect,
  labelSide,
  index,
  bloomStart,
}: {
  node: WorldNode;
  state: NodeState;
  selected: boolean;
  onSelect: (id: string | null) => void;
  labelSide: number;
  index: number;
  bloomStart: number | null; // performance.now() when the summon began
}) {
  const planetGroup = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ripple = useRef<THREE.Mesh>(null);
  const labelWrap = useRef<HTMLDivElement>(null);
  const pos = useMemo(() => nodePosition(node), [node]);
  const spec = PLANET_SPECS[node.id] ?? PLANET_SPECS.N1_recon;
  const haloRadius = Math.max(0.95, spec.size * 1.5 + 0.35);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const revealT = bloomStart === null ? -1 : (performance.now() - bloomStart) / 1000;
    const reveal = THREE.MathUtils.clamp((revealT - index * 0.35) / 0.7, 0, 1);
    const glow = worldBus.nodeGlow[node.id] ?? 0;
    const impact = worldBus.impacts.find((i) => i.node === node.id);
    const active = state === 'active';
    const lit = state === 'pending' ? 0 : 1;
    if (planetGroup.current) {
      // elastic bloom-in multiplied onto the event pulse
      const bloom = elasticOut(reveal);
      const s = bloom * (1 + (active ? 0.09 * Math.sin(t * 5) : 0) + glow * 0.22 + (selected ? 0.14 : 0));
      planetGroup.current.scale.setScalar(Math.max(0.0001, s));
      planetGroup.current.visible = reveal > 0.01;
    }
    if (ring.current) {
      ring.current.visible = reveal > 0.5;
      ring.current.rotation.z = t * (active ? 1.4 : 0.22);
      const rs = 1 + (active ? 0.18 * Math.sin(t * 3) : 0) + glow * 0.5;
      ring.current.scale.setScalar(rs);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (0.18 + lit * 0.32 + glow * 0.4) * reveal;
    }
    if (labelWrap.current) {
      labelWrap.current.style.opacity = String(THREE.MathUtils.clamp((reveal - 0.85) / 0.15, 0, 1));
      labelWrap.current.style.pointerEvents = reveal > 0.99 ? 'auto' : 'none';
    }
    if (ripple.current) {
      const k = impact ? impact.t : 1;
      const vis = impact ? 1 - k : 0;
      ripple.current.visible = vis > 0.02;
      if (ripple.current.visible) {
        ripple.current.scale.setScalar(1 + k * 3.2);
        (ripple.current.material as THREE.MeshBasicMaterial).opacity = vis * 0.7 * (impact?.strength ?? 1);
        (ripple.current.material as THREE.MeshBasicMaterial).color.set(impact?.color ?? node.color);
      }
    }
  });

  const labelTone = state === 'pending' ? '#6b7a9e' : node.color;

  return (
    <group position={pos}>
      {/* raycast target — sized to the body, invisible but hit-testable */}
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(selected ? null : node.id);
        }}
      >
        <sphereGeometry args={[Math.max(0.85, spec.size * 1.7), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={planetGroup}>
        {node.gate ? (
          <GateCrystal color={node.color} active={state === 'active'} />
        ) : (
          <PlanetBody spec={spec} nodeId={node.id} />
        )}
      </group>
      <mesh ref={ring} rotation={[Math.PI / 2.6, 0.2, 0]}>
        <torusGeometry args={[haloRadius, 0.012, 8, 48]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ripple} rotation={[Math.PI / 2.01, 0, 0]} visible={false}>
        <torusGeometry args={[haloRadius, 0.05, 8, 48]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh rotation={[Math.PI / 2.01, 0, 0]}>
          <torusGeometry args={[haloRadius + 0.55, 0.02, 8, 64]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
      {/* labels alternate above/below so neighbors never collide */}
      <Html position={[0, labelSide, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={labelWrap} style={{ opacity: 0 }}>
          <button
            type="button"
            onClick={() => onSelect(selected ? null : node.id)}
            data-world-node={node.id}
            aria-pressed={selected}
            className="world-node-label"
            style={{ ['--tone' as string]: labelTone }}
          >
            <span className="world-node-name">{node.name}</span>
            <span className="world-node-role">{node.role}</span>
            <span className="world-node-state" data-state={state}>{state}</span>
          </button>
        </div>
      </Html>
    </group>
  );
}

export function SwarmConstellation({
  states,
  selected,
  onSelect,
  theme,
  bloomStart,
}: {
  states: Record<string, NodeState>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  theme: WorldTheme;
  bloomStart: number | null; // performance.now() when the orchestrator summoned the swarm
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    // the whole constellation slowly precesses — the world is never still
    if (group.current) group.current.rotation.y += dt * 0.008;
  });
  return (
    <group ref={group}>
      <EdgeLines theme={theme} bloomStart={bloomStart} />
      <HandoffLinks />
      <EdgePulses />
      {WORLD_NODES.map((n, i) => (
        <SwarmNode
          key={n.id}
          node={n}
          state={states[n.id] ?? 'pending'}
          selected={selected === n.id}
          onSelect={onSelect}
          labelSide={i % 2 === 0 ? -1.35 : 1.35}
          index={i}
          bloomStart={bloomStart}
        />
      ))}
    </group>
  );
}

/** Overshoot ease for the planet bloom-in. */
function elasticOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -9 * t) * Math.cos(t * 13);
}

// ---------------------------------------------------------------------------
// Camera rig — overview ⟷ node fly-to, damped, with pointer parallax.
// ---------------------------------------------------------------------------

export function CameraRig({
  focusId,
  reducedMotion,
  mode,
}: {
  focusId: string | null;
  reducedMotion: boolean;
  mode: 'head' | 'world';
}) {
  const desiredPos = useRef(new THREE.Vector3(0, 5.5, 27));
  const desiredTarget = useRef(new THREE.Vector3(0, 0, 0));
  const curTarget = useRef(new THREE.Vector3(0, 0, 0));

  useFrame(({ camera, pointer }, dt) => {
    const k = 1 - Math.exp(-dt * 2.6); // frame-rate independent damping
    if (mode === 'head') {
      // boot framing: close on the assembling orchestrator
      desiredPos.current.set(0, 1.1, 9.8);
      desiredTarget.current.set(0, 0.7, 0);
    } else if (focusId) {
      const n = WORLD_NODES.find((x) => x.id === focusId);
      if (n) {
        const p = new THREE.Vector3(...nodePosition(n));
        const dir = p.clone().normalize();
        desiredPos.current.copy(p).add(dir.multiplyScalar(6.5)).add(new THREE.Vector3(0, 1.6, 0));
        desiredTarget.current.copy(p);
      }
    } else {
      desiredPos.current.set(0, 5.5, 27);
      desiredTarget.current.set(0, 0.6, 0);
      if (!reducedMotion) {
        desiredPos.current.x += pointer.x * 1.6;
        desiredPos.current.y += pointer.y * 1.1;
      }
    }
    camera.position.lerp(desiredPos.current, k);
    curTarget.current.lerp(desiredTarget.current, k);
    camera.lookAt(curTarget.current);
  });
  return null;
}
