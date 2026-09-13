// ---------------------------------------------------------------------------
// World View design tokens (D8) — extracted from the two reference reels:
//   violet (reel 1 "NIMBUS": near-black indigo + magenta/amber constellation)
//   navy   (reel 2 "Intelligent System": deep navy + cyan/green instruments,
//           golden hero core)
// Shared grammar: borderless floating instruments, micro-caps mono labels with
// middle-dot separators, 0.2–0.35em tracking, one glass element per screen
// (the objective banner).
// ---------------------------------------------------------------------------

export type WorldThemeName = 'violet' | 'navy';

export type WorldTheme = {
  name: WorldThemeName;
  bg0: string; // deepest background (edges)
  bg1: string; // background bloom center
  grid: string;
  gridSection: string;
  core: string; // hero orb hot color
  coreDeep: string; // hero orb deep color
  halo: string; // halo / bloom accent
  link: string;
  text: string;
  dim: string;
  ok: string;
  warn: string;
  crit: string;
  radar: string;
  audio: string;
};

export const WORLD_THEMES: Record<WorldThemeName, WorldTheme> = {
  violet: {
    name: 'violet',
    bg0: '#05010e',
    bg1: '#12042a',
    grid: '#1b0f38',
    gridSection: '#2c1a55',
    core: '#eaf6ff',
    coreDeep: '#7b2ff7',
    halo: '#ff3de0',
    link: '#4d3a7a',
    text: '#ede9ff',
    dim: '#8a7fb8',
    ok: '#3bff9e',
    warn: '#f5b841',
    crit: '#ff4d6d',
    radar: '#3bff9e',
    audio: '#ff8c1a',
  },
  navy: {
    name: 'navy',
    bg0: '#060d1f',
    bg1: '#0a1b3d',
    grid: '#12305a',
    gridSection: '#1e3a6e',
    core: '#fffdf5',
    coreDeep: '#ff8c1a',
    halo: '#4fd8ff',
    link: '#1e3a6e',
    text: '#d8ecff',
    dim: '#5f7ba6',
    ok: '#3bff9e',
    warn: '#f5b841',
    crit: '#ff4d6d',
    radar: '#3bff9e',
    audio: '#ff8c1a',
  },
};

export function readThemeName(): WorldThemeName {
  if (typeof window === 'undefined') return 'violet';
  return window.localStorage.getItem('rf-world-theme') === 'navy' ? 'navy' : 'violet';
}

export function writeThemeName(n: WorldThemeName): void {
  if (typeof window !== 'undefined') window.localStorage.setItem('rf-world-theme', n);
}

// ---------------------------------------------------------------------------
// Pulse edge indices — must match redforge/catalog/world_manifest.py edge order.
// Swarm layout/nodes come ONLY from /api/world/manifest (no UI fallback list).
// ---------------------------------------------------------------------------

/** Canonical manifest edge count — keep in sync with world_manifest.py. */
export const MANIFEST_EDGE_COUNT = 15;

// Which channel an attempt/verdict pulse rides.
export const PULSE_CHANNELS = {
  attempt: [4, 5] as number[], // strategist→operators, operators→judge
  verdict: [5, 8] as number[], // operators→judge, judge→G1
  chain: [9, 10, 11] as number[],
  gate: [8, 13] as number[],
};

// Pack → radar bearing (deg). Stable, spread around the scope.
export const PACK_BEARING: Record<string, number> = {
  PIN: 18, EXF: 64, OUT: 110, AGE: 156, MEM: 202, CON: 248, HAL: 294, SUP: 340,
};

export const MCP_SERVERS = [
  'redforge-target-adapter',
  'redforge-pyrit',
  'redforge-judge',
  'redforge-canary',
  'redforge-opa',
  'redforge-evidence',
] as const;
