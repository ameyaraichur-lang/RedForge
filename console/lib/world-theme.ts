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
// Constellation map — the 9 swarm nodes + 2 human gates, laid out around the
// RedForge core like the NIMBUS satellite ring. Color families carry meaning:
// recon=amber, offense=warm, adjudication=green, evolution=violet, outcome=gold.
// ---------------------------------------------------------------------------

export type WorldNode = {
  id: string;
  name: string;
  role: string;
  color: string;
  angle: number; // degrees around the core
  radius: number;
  y: number; // vertical offset for depth
  gate?: 'G1' | 'G2';
};

export const WORLD_NODES: WorldNode[] = [
  { id: 'N0_mission_control', name: 'MISSION', role: 'mission control', color: '#7fe7ff', angle: 96, radius: 10.4, y: 2.3 },
  { id: 'N1_recon', name: 'SCOUT', role: 'recon', color: '#f5b841', angle: 137, radius: 11.4, y: -0.6 },
  { id: 'N2_attack_strategist', name: 'STRATEGIST', role: 'attack planner', color: '#ff8c4d', angle: 176, radius: 9.8, y: 1.2 },
  { id: 'N3_red_operators', name: 'OPERATORS', role: 'red execution', color: '#ff4d9d', angle: 214, radius: 12.2, y: -1.4 },
  { id: 'N4_judge', name: 'SENTINEL', role: 'adjudicator', color: '#3bff9e', angle: 253, radius: 10.6, y: 0.8 },
  { id: 'N5_mutator', name: 'MUTATOR', role: 'evolution', color: '#9d5cff', angle: 291, radius: 11.8, y: -1.8 },
  { id: 'G1_gatekeeper', name: 'G1', role: 'two-person gate', color: '#f5b841', angle: 322, radius: 12.8, y: 0.4, gate: 'G1' },
  { id: 'N6_chain_builder', name: 'CHAINER', role: 'kill chains', color: '#5ea0ff', angle: 352, radius: 13.6, y: 2.2 },
  { id: 'N7_verifier', name: 'VERIFIER', role: 'fp-kill', color: '#4fe3c1', angle: 17, radius: 11.2, y: -2.4 },
  { id: 'N8_scorer', name: 'SCORER', role: 'opa policy', color: '#ffd166', angle: 47, radius: 13.0, y: 0.6 },
  { id: 'G2_release', name: 'G2', role: 'release gate', color: '#7fe7ff', angle: 71, radius: 14.4, y: -1.2, gate: 'G2' },
];

export function nodePosition(n: WorldNode): [number, number, number] {
  const a = (n.angle * Math.PI) / 180;
  return [Math.cos(a) * n.radius, n.y, Math.sin(a) * n.radius];
}

export const WORLD_NODE_BY_ID: Record<string, WorldNode> = Object.fromEntries(
  WORLD_NODES.map((n) => [n.id, n]),
);

// Constellation links (from,to) — index into EDGES is the pulse channel.
export const WORLD_EDGES: [string, string][] = [
  ['CORE', 'N0_mission_control'],
  ['CORE', 'N1_recon'],
  ['N0_mission_control', 'N1_recon'],
  ['N1_recon', 'N2_attack_strategist'],
  ['N2_attack_strategist', 'N3_red_operators'],
  ['N3_red_operators', 'N4_judge'],
  ['N4_judge', 'N5_mutator'],
  ['N5_mutator', 'N3_red_operators'],
  ['N4_judge', 'G1_gatekeeper'],
  ['G1_gatekeeper', 'N6_chain_builder'],
  ['G1_gatekeeper', 'N7_verifier'],
  ['N6_chain_builder', 'N8_scorer'],
  ['N7_verifier', 'N8_scorer'],
  ['N8_scorer', 'G2_release'],
  ['G2_release', 'N0_mission_control'],
];

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
