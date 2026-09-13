#!/usr/bin/env node
/**
 * Renders the generated bust rings to a PNG so the sliced geometry can be
 * inspected on its own, before any shader or particle work is layered on top.
 *
 *   node scripts/preview_bust_rings.mjs [generated.ts] [out.png]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const src = process.argv[2] || 'console/lib/bust-rings.generated.ts';
const out = process.argv[3] || 'output/visual-fidelity/bust-rings-preview.png';

const text = fs.readFileSync(src, 'utf8');
const grab = (name) => {
  const m = text.match(new RegExp(`${name}\\s*=\\s*\\n?\\s*'([^']*)'`));
  if (!m) throw new Error(`${src}: could not find ${name}`);
  return Buffer.from(m[1], 'base64');
};
const quant = Number(text.match(/RING_QUANT = (\d+)/)[1]);
const hb = grab('RING_HEADER_B64');
const vb = grab('RING_VERTS_B64');
const header = new Int16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2);
const vraw = new Int16Array(vb.buffer, vb.byteOffset, vb.byteLength / 2);

const rings = [];
let v = 0;
for (let i = 0; i + 2 < header.length; i += 3) {
  const y = header[i] / quant;
  const count = header[i + 1];
  const zone = header[i + 2];
  const verts = [];
  for (let k = 0; k < count; k++) {
    verts.push([vraw[v] / quant, vraw[v + 1] / quant]);
    v += 2;
  }
  rings.push({ y, zone, verts });
}
console.log(`rings ${rings.length}  vertices ${rings.reduce((a, r) => a + r.verts.length, 0)}`);

// ---- tiny PNG writer (RGB8, non-interlaced) ----
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// ---- render three views side by side ----
const PANEL = 380;
const H = 520;
const W = PANEL * 3;
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i * 3] = 8; buf[i * 3 + 1] = 10; buf[i * 3 + 2] = 18; }

const ZONE_COL = [
  [120, 200, 255], // crown
  [255, 150, 40],  // face
  [255, 220, 140], // jaw
  [120, 235, 255], // neck
  [150, 180, 255], // shoulder
  [90, 130, 220],  // chest
];

const yLo = Math.min(...rings.map((r) => r.y));
const yHi = Math.max(...rings.map((r) => r.y));
const half = Math.max(...rings.flatMap((r) => r.verts.map((p) => Math.abs(p[0]))));
const depth = Math.max(...rings.flatMap((r) => r.verts.map((p) => Math.abs(p[1]))));
const span = Math.max(half, depth) * 2.15;

const plot = (panel, px, py, col, bright) => {
  const x = Math.round(panel * PANEL + px);
  const y = Math.round(py);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  for (let c = 0; c < 3; c++) buf[o + c] = Math.min(255, buf[o + c] + col[c] * bright);
};

const views = [
  // [label, horizontal source, sign, depth-cue source]
  ['front', (p) => p[0], (p) => p[1]],
  ['side', (p) => p[1], (p) => -p[0]],
  ['three-quarter', (p) => p[0] * 0.72 + p[1] * 0.69, (p) => p[1] * 0.72 - p[0] * 0.69],
];

views.forEach(([, hFn, dFn], panel) => {
  for (const ring of rings) {
    const col = ZONE_COL[ring.zone] || [255, 255, 255];
    for (const p of ring.verts) {
      const hx = hFn(p);
      const dz = dFn(p);
      const px = PANEL / 2 + (hx / span) * PANEL;
      const py = H - 40 - ((ring.y - yLo) / (yHi - yLo)) * (H - 80);
      // Dim the back of the loop so the form reads three-dimensionally.
      const bright = dz > 0 ? 0.95 : 0.28;
      plot(panel, px, py, col, bright);
    }
  }
});

fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, png(W, H, buf));
console.log(`wrote ${out}  (panels: front | side | three-quarter)`);
console.log(`zone colours: crown=blue face=orange jaw=pale neck=cyan shoulder=periwinkle chest=deep`);
