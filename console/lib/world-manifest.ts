'use client';

/** Typed client for /api/world/manifest — authoritative agent topology. */

export type ManifestNodeKind = 'agent' | 'gate';

export type ManifestNode = {
  id: string;
  name: string;
  role: string;
  color: string;
  angle: number;
  radius: number;
  y: number;
  pipeline_order: number;
  kind: ManifestNodeKind;
  gate?: 'G1' | 'G2';
};

export type ManifestEdge = {
  from_id: string;
  to_id: string;
};

export type WorldManifest = {
  version: string;
  core_id: string;
  agent_count: number;
  gate_count: number;
  runtime_agents: string[];
  nodes: ManifestNode[];
  edges: ManifestEdge[];
  pipeline_order: string[];
};

let cached: WorldManifest | null = null;

export async function fetchWorldManifest(): Promise<WorldManifest> {
  if (cached) return cached;
  const r = await fetch('/api/world/manifest', { cache: 'no-store' });
  if (!r.ok) throw new Error(`world manifest fetch failed (${r.status})`);
  cached = (await r.json()) as WorldManifest;
  return cached;
}

export function clearManifestCache(): void {
  cached = null;
}

export function nodePosition(n: Pick<ManifestNode, 'angle' | 'radius' | 'y'>): [number, number, number] {
  const a = (n.angle * Math.PI) / 180;
  return [Math.cos(a) * n.radius, n.y, Math.sin(a) * n.radius];
}

export function manifestNodeById(m: WorldManifest): Record<string, ManifestNode> {
  return Object.fromEntries(m.nodes.map((n) => [n.id, n]));
}

export function manifestEdgesAsPairs(m: WorldManifest): [string, string][] {
  return m.edges.map((e) => [e.from_id, e.to_id]);
}
