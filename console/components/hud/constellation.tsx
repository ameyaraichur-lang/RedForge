'use client';

// JARVIS-layer 3D swarm constellation (M6b+): the 15-node DAG as a living
// organism. react-three-fiber + drei + bloom postprocessing. Node spheres glow
// by live state; attack paths pulse when edges are hot. Degrades gracefully:
// WebGL failure falls back to null (the schematic SVG DAG remains underneath).

import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { nodeStatesFromEvents, type LiveEvent, type NodeState } from '@/lib/live';

type CNode = { id: string; label: string; sub: string; gate: boolean; pos: [number, number, number] };

// Layered layout: plan -> recon -> strategy -> execution triad -> gate -> chain/verify -> score
const NODES: CNode[] = [
  { id: 'N0_mission_control', label: 'N0', sub: 'mission', gate: false, pos: [-7.5, 3.4, 0] },
  { id: 'N1_recon', label: 'N1', sub: 'recon', gate: false, pos: [-7.5, 1.1, 1.6] },
  { id: 'N2_attack_strategist', label: 'N2', sub: 'strategist', gate: false, pos: [-7.5, -1.2, -1.2] },
  { id: 'N3_red_operators', label: 'N3', sub: 'operators', gate: false, pos: [-2.5, 1.4, 1.8] },
  { id: 'N4_judge', label: 'N4', sub: 'judge', gate: false, pos: [-2.5, -0.9, -1.5] },
  { id: 'N5_mutator', label: 'N5', sub: 'mutator', gate: false, pos: [-2.5, -3.1, 0.6] },
  { id: 'G1_gatekeeper', label: 'G1', sub: 'gate', gate: true, pos: [1.9, 0.2, 0] },
  { id: 'N6_chain_builder', label: 'N6', sub: 'chains', gate: false, pos: [5.6, 1.6, -1.4] },
  { id: 'N7_verifier', label: 'N7', sub: 'verifier', gate: false, pos: [5.6, -0.8, 1.6] },
  { id: 'N8_scorer', label: 'N8', sub: 'scorer', gate: false, pos: [9.2, 0.4, 0] },
  { id: 'G2_release', label: 'G2', sub: 'release', gate: true, pos: [12.4, 0.0, 0] },
];

const EDGES: [string, string][] = [
  ['N0_mission_control', 'N1_recon'],
  ['N0_mission_control', 'N2_attack_strategist'],
  ['N1_recon', 'N2_attack_strategist'],
  ['N2_attack_strategist', 'N3_red_operators'],
  ['N3_red_operators', 'N4_judge'],
  ['N4_judge', 'N5_mutator'],
  ['N5_mutator', 'N3_red_operators'],
  ['N4_judge', 'G1_gatekeeper'],
  ['N3_red_operators', 'G1_gatekeeper'],
  ['G1_gatekeeper', 'N6_chain_builder'],
  ['G1_gatekeeper', 'N7_verifier'],
  ['N6_chain_builder', 'N8_scorer'],
  ['N7_verifier', 'N8_scorer'],
  ['N8_scorer', 'G2_release'],
];

const STATE_COLOR: Record<NodeState, string> = {
  pending: '#334155',
  active: '#22d3ee',
  complete: '#34d399',
  blocked: '#fbbf24',
};

function NodeSphere({ node, state }: { node: CNode; state: NodeState }) {
  const mesh = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = STATE_COLOR[state];
  const active = state === 'active';

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (mesh.current) {
      const s = active ? 1 + 0.12 * Math.sin(t * 5) : hovered ? 1.12 : 1;
      mesh.current.scale.setScalar(s);
      (mesh.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        state === 'pending' ? 0.25 : active ? 2.2 + Math.sin(t * 5) : 1.1;
    }
    if (halo.current) {
      halo.current.rotation.z = t * (active ? 1.6 : 0.25);
      halo.current.scale.setScalar(active ? 1.5 + 0.25 * Math.sin(t * 3) : 1.35);
    }
  });

  const geo = node.gate ? <octahedronGeometry args={[0.52, 0]} /> : <sphereGeometry args={[0.44, 32, 32]} />;

  return (
    <group position={node.pos}>
      <mesh
        ref={mesh}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        {geo}
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} roughness={0.25} metalness={0.4} />
      </mesh>
      {/* orbiting halo ring */}
      <mesh ref={halo} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[0.78, 0.015, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={state === 'pending' ? 0.25 : 0.7} />
      </mesh>
      {(hovered || state === 'active') && (
        <Html center distanceFactor={14} position={[0, -1.15, 0]}>
          <div
            style={{ border: '1px solid rgba(34,211,238,.5)', background: 'rgba(10,14,20,.92)' }}
            className="rounded px-2 py-1 font-mono text-[10px] tracking-widest text-cyan-200"
          >
            {node.label} · {node.sub} · {state}
          </div>
        </Html>
      )}
    </group>
  );
}

function FlowParticle({ from, to, hot }: { from: [number, number, number]; to: [number, number, number]; hot: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const dir = useMemo(
    () => new THREE.Vector3(...to).sub(new THREE.Vector3(...from)),
    [from, to],
  );
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() * 0.35) % 1;
    ref.current.position.set(
      from[0] + dir.x * t,
      from[1] + dir.y * t,
      from[2] + dir.z * t,
    );
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = hot ? 0.95 * Math.sin(t * Math.PI) : 0.12;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.4} />
    </mesh>
  );
}

function Scene({ states }: { states: Record<string, NodeState> }) {
  const pos = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n.pos])) as Record<string, [number, number, number]>, []);
  const anyActive = Object.values(states).some((s) => s === 'active');
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 6, 8]} intensity={80} color="#22d3ee" />
      <pointLight position={[8, -4, -6]} intensity={50} color="#34d399" />
      {NODES.map((n) => (
        <NodeSphere key={n.id} node={n} state={states[n.id] ?? 'pending'} />
      ))}
      {EDGES.map(([a, b]) => (
        <group key={`${a}-${b}`}>
          <mesh>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([...(pos[a] ?? [0, 0, 0]), ...(pos[b] ?? [0, 0, 0])]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#1e293b" transparent opacity={0.8} />
          </mesh>
          <FlowParticle from={pos[a] ?? [0, 0, 0]} to={pos[b] ?? [0, 0, 0]} hot={anyActive} />
        </group>
      ))}
      <gridHelper args={[40, 40, '#0f172a', '#0b1120']} position={[2, -6, 0]} />
      <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.5} minDistance={8} maxDistance={30} />
      <EffectComposer>
        <Bloom intensity={0.9} luminanceThreshold={0.15} luminanceSmoothing={0.85} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export function Constellation({ events, height = 460 }: { events: LiveEvent[]; height?: number }) {
  const [webglOk, setWebglOk] = useState(true);
  const states = useMemo(() => nodeStatesFromEvents(events), [events]);

  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      if (!c.getContext('webgl2') && !c.getContext('webgl')) setWebglOk(false);
    } catch {
      setWebglOk(false);
    }
  }, []);

  if (!webglOk) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded border border-line bg-ink-2 font-mono text-[11px] text-dim"
      >
        webgl unavailable — schematic dag remains active (ops mode fallback, D7)
      </div>
    );
  }
  return (
    <div style={{ height }} className="overflow-hidden rounded border border-acc/20 bg-[#060a10]">
      <Canvas camera={{ position: [2, 3, 16], fov: 55 }} dpr={[1, 1.8]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Scene states={states} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[9px] uppercase tracking-[0.22em] text-acc/80">
        hud mode · swarm constellation · drag to orbit
      </div>
    </div>
  );
}
