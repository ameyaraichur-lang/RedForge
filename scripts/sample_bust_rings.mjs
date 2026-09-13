#!/usr/bin/env node
/**
 * Offline bust-ring sampler.
 *
 * Slices a head/bust mesh into horizontal contour loops and emits them as a
 * compact quantised asset. The console renderer expands those loops into
 * particles at runtime, so the browser never loads a mesh and particle density
 * stays a runtime knob.
 *
 *   node scripts/sample_bust_rings.mjs <mesh.glb> <out.ts>
 *
 * Contour rings are the reference's visual grammar, and slicing a real scan is
 * what keeps the anatomy correct: the crown dome, jaw line, neck taper and
 * deltoid flare all fall out of the mesh instead of hand-fitted radius curves.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- GLB reading

const COMP = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const total = b.readUInt32LE(8);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < total) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error(`${file}: missing JSON or BIN chunk`);
  return { json, bin };
}

function readAccessor(json, bin, index) {
  const a = json.accessors[index];
  const [Ctor, csize] = COMP[a.componentType];
  const n = NUM[a.type];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || csize * n;
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const view = new Ctor(bin.buffer, bin.byteOffset + base + i * stride, n);
    for (let c = 0; c < n; c++) out[i * n + c] = view[c];
  }
  return { data: out, count: a.count };
}

function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Flat world-space triangle soup: [ax,ay,az,bx,by,bz,cx,cy,cz, ...]. */
function worldTriangles(json, bin) {
  const tris = [];
  const scene = json.scenes[json.scene || 0];
  const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (index, parent) => {
    const node = json.nodes[index];
    const world = matMul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.attributes.POSITION == null) continue;
        const pos = readAccessor(json, bin, prim.attributes.POSITION);
        const idx = prim.indices != null ? readAccessor(json, bin, prim.indices).data : null;
        const count = idx ? idx.length : pos.count;
        for (let i = 0; i + 2 < count; i += 3) {
          for (let k = 0; k < 3; k++) {
            const v = idx ? idx[i + k] : i + k;
            const w = apply(world, [pos.data[v * 3], pos.data[v * 3 + 1], pos.data[v * 3 + 2]]);
            tris.push(w[0], w[1], w[2]);
          }
        }
      }
    }
    for (const child of node.children || []) walk(child, world);
  };
  for (const root of scene.nodes) walk(root, IDENT);
  return tris;
}

// ------------------------------------------------------------ plane slicing

/** Intersect the triangle soup with plane y = level, returning xz segments. */
function sliceAt(tris, level) {
  const segs = [];
  for (let t = 0; t < tris.length; t += 9) {
    const px = [tris[t], tris[t + 3], tris[t + 6]];
    const py = [tris[t + 1], tris[t + 4], tris[t + 7]];
    const pz = [tris[t + 2], tris[t + 5], tris[t + 8]];
    const hits = [];
    for (let e = 0; e < 3; e++) {
      const a = e;
      const b = (e + 1) % 3;
      const ya = py[a];
      const yb = py[b];
      if ((ya < level && yb < level) || (ya > level && yb > level)) continue;
      if (ya === yb) continue;
      const f = (level - ya) / (yb - ya);
      if (f < 0 || f > 1) continue;
      hits.push([px[a] + (px[b] - px[a]) * f, pz[a] + (pz[b] - pz[a]) * f]);
    }
    if (hits.length < 2) continue;
    const [p, q] = hits;
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9) continue;
    segs.push([p[0], p[1], q[0], q[1]]);
  }
  return segs;
}

/** Chain xz segments into ordered polylines (closed where the mesh is closed). */
function chainSegments(segs, tol) {
  const key = (x, z) => `${Math.round(x / tol)}:${Math.round(z / tol)}`;
  const ends = new Map();
  const add = (k, i) => {
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push(i);
  };
  segs.forEach((s, i) => {
    add(key(s[0], s[1]), i);
    add(key(s[2], s[3]), i);
  });

  const used = new Array(segs.length).fill(false);
  const loops = [];
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const pts = [[segs[start][0], segs[start][1]], [segs[start][2], segs[start][3]]];
    // Walk forward, then backward, consuming adjacent unused segments.
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const tip = dir === 0 ? pts[pts.length - 1] : pts[0];
        const cand = ends.get(key(tip[0], tip[1])) || [];
        let next = -1;
        for (const i of cand) if (!used[i]) { next = i; break; }
        if (next < 0) break;
        used[next] = true;
        const s = segs[next];
        const d0 = Math.hypot(s[0] - tip[0], s[1] - tip[1]);
        const d1 = Math.hypot(s[2] - tip[0], s[3] - tip[1]);
        const far = d0 <= d1 ? [s[2], s[3]] : [s[0], s[1]];
        if (dir === 0) pts.push(far);
        else pts.unshift(far);
      }
    }
    const perim = pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    if (pts.length >= 4 && perim > tol * 8) {
      const closed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < tol * 3;
      loops.push({ pts, perim, closed });
    }
  }
  loops.sort((a, b) => b.perim - a.perim);
  return loops;
}

/** Resample a polyline to `n` points at uniform arc length. */
function resample(loop, n) {
  const pts = loop.closed ? [...loop.pts, loop.pts[0]] : loop.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const out = [];
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const t0 = cum[seg - 1];
    const f = cum[seg] - t0 > 0 ? (target - t0) / (cum[seg] - t0) : 0;
    out.push([
      pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * f,
      pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * f,
    ]);
  }
  return out;
}

// ------------------------------------------------------------------- driver

const ZONES = ['crown', 'face', 'jaw', 'neck', 'shoulder', 'chest'];

function main() {
  const [meshPath, outPath] = process.argv.slice(2);
  if (!meshPath || !outPath) {
    console.error('usage: node scripts/sample_bust_rings.mjs <mesh.glb> <out.ts>');
    process.exit(2);
  }

  const { json, bin } = readGlb(meshPath);
  const tris = worldTriangles(json, bin);
  if (!tris.length) throw new Error('mesh produced no triangles');

  // Mesh bounds (LeePerrySmith is Y-up, faces +Z).
  let yLo = Infinity, yHi = -Infinity, zSum = 0, zN = 0;
  for (let i = 0; i < tris.length; i += 3) {
    yLo = Math.min(yLo, tris[i + 1]);
    yHi = Math.max(yHi, tris[i + 1]);
    zSum += tris[i + 2];
    zN++;
  }

  // Target scene space, matching console/lib/orchestrator-sdf.ts.
  const CROWN_Y = 1.55;
  const CHEST_BOTTOM = -2.45;
  const S = (CROWN_Y - CHEST_BOTTOM) / (yHi - yLo);
  const YOFF = CROWN_Y - yHi * S;

  // Facing check: the nose must protrude toward +z near the head centreline.
  const headY = yLo + (yHi - yLo) * 0.7;
  let front = 0, back = 0;
  for (let i = 0; i < tris.length; i += 3) {
    if (Math.abs(tris[i + 1] - headY) > (yHi - yLo) * 0.06) continue;
    if (Math.abs(tris[i]) > (yHi - yLo) * 0.05) continue;
    front = Math.max(front, tris[i + 2]);
    back = Math.min(back, tris[i + 2]);
  }
  const faceSign = Math.abs(front) >= Math.abs(back) ? 1 : -1;

  const toScene = (x, y, z) => [x * S, y * S + YOFF, z * S * faceSign];

  // Slice levels: denser through the face so ridge rings read as features.
  const LEVELS = 96;
  const rings = [];
  const tol = (yHi - yLo) * 0.004;
  for (let i = 0; i < LEVELS; i++) {
    // Bias sampling toward the upper (head) half.
    const u = i / (LEVELS - 1);
    const biased = Math.pow(u, 0.82);
    const y = yLo + biased * (yHi - yLo) * 0.998 + (yHi - yLo) * 0.001;
    const loops = chainSegments(sliceAt(tris, y), tol);
    if (!loops.length) continue;

    const sceneY = y * S + YOFF;
    // Dominant loop only. Secondary loops at ear height render as bright
    // detached blocks, which the reference figure does not have.
    for (const loop of [loops[0]]) {
      const n = Math.max(24, Math.min(120, Math.round(loop.perim * S * 46)));
      const pts = resample(loop, n);
      if (pts.length < 12) continue;
      const verts = pts.map(([x, z]) => {
        const [sx, , sz] = toScene(x, y, z);
        return [sx, sz];
      });
      rings.push({ y: sceneY, verts });
    }
  }

  if (!rings.length) throw new Error('slicing produced no rings');

  // Zone tagging from measured landmarks rather than guessed constants.
  // Measure per slice level, taking the widest loop at each height: secondary
  // loops (ear contours) are narrow and would otherwise masquerade as the neck.
  const halfWidthAt = (ring) => ring.verts.reduce((m, v) => Math.max(m, Math.abs(v[0])), 0);
  const byLevel = new Map();
  for (const r of rings) {
    const k = Math.round(r.y * 1e4);
    byLevel.set(k, Math.max(byLevel.get(k) ?? 0, halfWidthAt(r)));
  }
  const measured = [...byLevel.entries()]
    .map(([k, w]) => ({ y: k / 1e4, w }))
    .sort((a, b) => a.y - b.y);

  const headWidest = measured.filter((m) => m.y > 0).sort((a, b) => b.w - a.w)[0];
  const shoulderWidest = measured.slice().sort((a, b) => b.w - a.w)[0];
  // Neck = narrowest level strictly between the jaw and the deltoid flare.
  const mid = measured.filter((m) => m.y < headWidest.y - 0.05 && m.y > shoulderWidest.y + 0.05);
  const neck = mid.slice().sort((a, b) => a.w - b.w)[0] ?? { y: -1.0, w: 0.6 };

  // Chin = steepest narrowing between the cheekbones and the neck; that edge is
  // where the jaw leaves the silhouette, so it beats a guessed offset.
  const jawBand = measured.filter((m) => m.y <= headWidest.y && m.y >= neck.y);
  let chinY = neck.y + (headWidest.y - neck.y) * 0.35;
  let steepest = 0;
  for (let i = 1; i < jawBand.length; i++) {
    const dy = jawBand[i].y - jawBand[i - 1].y;
    if (dy <= 0) continue;
    const slope = (jawBand[i].w - jawBand[i - 1].w) / dy;
    if (slope > steepest) {
      steepest = slope;
      chinY = (jawBand[i].y + jawBand[i - 1].y) / 2;
    }
  }
  // Brow sits above the cheekbones, below the crown dome.
  const browY = headWidest.y + (CROWN_Y - headWidest.y) * 0.34;

  const zoneOf = (y) => {
    if (y > browY) return 0; // crown / forehead dome
    if (y > chinY) return 1; // face (eyes, nose, mouth)
    if (y > chinY - (chinY - neck.y) * 0.45) return 2; // jaw underside
    if (y > neck.y - (neck.y - shoulderWidest.y) * 0.42) return 3; // neck
    if (y > shoulderWidest.y - 0.12) return 4; // shoulder
    return 5; // chest
  };

  // Quantise: y per ring, xz per vertex, 1/4096 scene units.
  const Q = 4096;
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * Q)));
  const head = [];
  const verts = [];
  for (const ring of rings) {
    head.push(q(ring.y), ring.verts.length, zoneOf(ring.y));
    for (const [x, z] of ring.verts) verts.push(q(x), q(z));
  }
  const headBuf = Buffer.from(new Int16Array(head).buffer);
  const vertBuf = Buffer.from(new Int16Array(verts).buffer);

  const stats = {
    rings: rings.length,
    vertices: verts.length / 2,
    bytes: headBuf.length + vertBuf.length,
    crownY: CROWN_Y,
    chestBottom: CHEST_BOTTOM,
    headWidest,
    neck,
    shoulderWidest,
    faceSign,
  };

  const ts = `// GENERATED by scripts/sample_bust_rings.mjs — do not edit by hand.
//
// Horizontal contour rings sliced from a real head/bust scan, quantised to
// 1/${Q} scene units. Source mesh: LeePerrySmith head scan by Lee Perry-Smith
// (Infinite-Realities), distributed with three.js under CC-BY 3.0.
//
// rings: ${stats.rings}   ring vertices: ${stats.vertices}   payload: ${(stats.bytes / 1024).toFixed(1)} KiB
// measured landmarks (scene units):
//   head widest  y=${headWidest.y.toFixed(3)} halfWidth=${headWidest.w.toFixed(3)}
//   neck         y=${neck.y.toFixed(3)} halfWidth=${neck.w.toFixed(3)}
//   shoulders    y=${shoulderWidest.y.toFixed(3)} halfWidth=${shoulderWidest.w.toFixed(3)}
//   neck/head    ${(neck.w / headWidest.w).toFixed(3)}   shoulder/head ${(shoulderWidest.w / headWidest.w).toFixed(3)}

export const RING_QUANT = ${Q};

export const ZONE = { crown: 0, face: 1, jaw: 2, neck: 3, shoulder: 4, chest: 5 } as const;
export type ZoneName = keyof typeof ZONE;

const RING_HEADER_B64 =
  '${headBuf.toString('base64')}';

const RING_VERTS_B64 =
  '${vertBuf.toString('base64')}';

function decode(b64: string): Int16Array {
  if (typeof atob === 'function') {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }
  const buf = Buffer.from(b64, 'base64');
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

export type BustRing = {
  /** Ring height in scene units. */
  y: number;
  /** Anatomical zone, see ZONE. */
  zone: number;
  /** Arc-length-uniform loop vertices as [x, z] pairs. */
  verts: Array<[number, number]>;
  /** Loop perimeter in scene units. */
  perimeter: number;
  /** Max |x| on the loop. */
  halfWidth: number;
};

let cache: BustRing[] | null = null;

/** Contour rings of the bust, ordered bottom-to-top within each slice group. */
export function bustRings(): BustRing[] {
  if (cache) return cache;
  const header = decode(RING_HEADER_B64);
  const verts = decode(RING_VERTS_B64);
  const out: BustRing[] = [];
  let v = 0;
  for (let i = 0; i + 2 < header.length; i += 3) {
    const y = header[i] / RING_QUANT;
    const count = header[i + 1];
    const zone = header[i + 2];
    const loop: Array<[number, number]> = [];
    for (let k = 0; k < count; k++) {
      loop.push([verts[v] / RING_QUANT, verts[v + 1] / RING_QUANT]);
      v += 2;
    }
    let perimeter = 0;
    let halfWidth = 0;
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k];
      const b = loop[(k + 1) % loop.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
      halfWidth = Math.max(halfWidth, Math.abs(a[0]));
    }
    out.push({ y, zone, verts: loop, perimeter, halfWidth });
  }
  cache = out;
  return out;
}

/** Measured landmarks, derived from the mesh rather than hand-fitted. */
export const BUST_LANDMARKS = {
  crownY: ${CROWN_Y},
  chestBottom: ${CHEST_BOTTOM},
  headWidestY: ${headWidest.y.toFixed(4)},
  headHalfWidth: ${headWidest.w.toFixed(4)},
  neckY: ${neck.y.toFixed(4)},
  neckHalfWidth: ${neck.w.toFixed(4)},
  shoulderY: ${shoulderWidest.y.toFixed(4)},
  shoulderHalfWidth: ${shoulderWidest.w.toFixed(4)},
  /** Brow line: top of the face region, base of the forehead dome. */
  browY: ${browY.toFixed(4)},
  /** Chin: where the jaw leaves the silhouette. */
  chinY: ${chinY.toFixed(4)},
} as const;
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, ts);

  console.log(`rings            ${stats.rings}`);
  console.log(`ring vertices    ${stats.vertices}`);
  console.log(`payload          ${(stats.bytes / 1024).toFixed(1)} KiB  (${(headBuf.toString('base64').length + vertBuf.toString('base64').length) / 1024} KiB base64)`);
  console.log(`face sign        ${faceSign > 0 ? '+z' : '-z'}`);
  console.log(`scale            ${S.toFixed(5)}  yOffset ${YOFF.toFixed(5)}`);
  console.log(`head widest      y=${headWidest.y.toFixed(3)}  halfWidth=${headWidest.w.toFixed(3)}`);
  console.log(`neck             y=${neck.y.toFixed(3)}  halfWidth=${neck.w.toFixed(3)}`);
  console.log(`shoulders        y=${shoulderWidest.y.toFixed(3)}  halfWidth=${shoulderWidest.w.toFixed(3)}`);
  console.log(`neck/head        ${(neck.w / headWidest.w).toFixed(3)}   (anatomical target ~0.66)`);
  console.log(`shoulder/head    ${(shoulderWidest.w / headWidest.w).toFixed(3)}   (anatomical target ~2.25)`);
  console.log(`wrote            ${outPath}`);
}

main();
