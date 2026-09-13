/**
 * Implicit bust surface — cranium, jaw, neck, chest, trapezius and deltoids composed
 * via smooth unions. Ridge rings and rim strokes sample the zero level set.
 */

export const CROWN_Y = 1.55;
export const CHIN_Y = -0.85;
export const HEAD_H = CROWN_Y - CHIN_Y;
export const HEAD_RX = 0.89;
export const NECK_BOTTOM = -1.3;
export const NECK_TOP_RX = 0.15;
export const NECK_BASE_RX = 0.29;
export const DELTOID_RX = 2.3;
export const CHEST_BOTTOM = -2.45;
/** Skip degenerate ring slices below this radius (prevents crown spike). */
export const MIN_SLICE_RADIUS = 0.08;
/** Do not emit rim/rings above this fraction of head height (crown degeneracy). */
export const CROWN_SLICE_U = 0.74;

export type V3 = { x: number; y: number; z: number };

export const LANDMARKS = {
  neckCenter: { x: 0, y: (CHIN_Y + NECK_BOTTOM) / 2, z: 0.02 },
  leftDeltoid: { x: -1.62, y: -2.0, z: 0.1 },
  rightDeltoid: { x: 1.62, y: -2.0, z: 0.1 },
  chin: { x: 0, y: CHIN_Y + 0.08, z: 0.1 },
  chestCenter: { x: 0, y: CHEST_BOTTOM + 0.32, z: 0.1 },
} as const;

const EPS = 0.0012;

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sdEllipsoid(p: V3, c: V3, r: V3): number {
  const q = { x: (p.x - c.x) / r.x, y: (p.y - c.y) / r.y, z: (p.z - c.z) / r.z };
  const k0 = Math.hypot(q.x, q.y, q.z);
  const k1 = Math.hypot(q.x / r.x, q.y / r.y, q.z / r.z);
  if (k1 < 1e-8) return k0 - 1;
  return (k0 * (k0 - 1)) / k1;
}

function sdCapsule(p: V3, a: V3, b: V3, r: number): number {
  const pa = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const ba = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const h = clamp((pa.x * ba.x + pa.y * ba.y + pa.z * ba.z) / (ba.x * ba.x + ba.y * ba.y + ba.z * ba.z), 0, 1);
  const q = { x: pa.x - ba.x * h, y: pa.y - ba.y * h, z: pa.z - ba.z * h };
  return Math.hypot(q.x, q.y, q.z) - r;
}

/** Cranium — deeper front-to-back than side-to-side. */
function sdCranium(p: V3): number {
  return sdEllipsoid(p, { x: 0, y: 0.46, z: -0.14 }, { x: 0.84, y: 0.94, z: 1.16 });
}

/** Tapered envelope — cheek width at top, chin width at bottom (monotonic silhouette). */
function sdJawTaper(p: V3): number {
  const yCheek = CHIN_Y + 0.55 * HEAD_H;
  const yChin = CHIN_Y - 0.08;
  if (p.y > yCheek + 0.04) return -1;
  if (p.y < yChin - 0.04) return -1;
  const t = clamp((yCheek - p.y) / (yCheek - yChin), 0, 1);
  const rx = 0.838 * (1 - t) + 0.42 * t;
  const rz = 0.34 + (0.26 - 0.34) * t;
  const qx = Math.abs(p.x) / rx;
  const qz = Math.abs(p.z) / rz;
  return Math.hypot(qx, qz) - 1;
}

/** Mandible — smooth-unioned ellipsoids clipped by soft taper (monotonic cheek→chin). */
function sdJaw(p: V3): number {
  const upper = sdEllipsoid(
    p,
    { x: 0, y: CHIN_Y + 0.35 * HEAD_H, z: 0.04 },
    { x: 0.66, y: 0.3, z: 0.4 },
  );
  const lower = sdEllipsoid(
    p,
    { x: 0, y: CHIN_Y + 0.16 * HEAD_H, z: 0.08 },
    { x: 0.55, y: 0.32, z: 0.36 },
  );
  const chinPad = sdEllipsoid(p, { x: 0, y: CHIN_Y + 0.05, z: 0.1 }, { x: 0.43, y: 0.15, z: 0.28 });
  let jaw = smin(smin(upper, lower, 0.44), chinPad, 0.4);
  const yCheek = CHIN_Y + 0.55 * HEAD_H;
  if (p.y < yCheek - 0.02 && p.y > CHIN_Y - 0.14) {
    jaw = smax(jaw, sdJawTaper(p), 0.05);
  }
  return jaw;
}

function sdNeck(p: V3): number {
  const top = { x: 0, y: CHIN_Y - 0.14, z: 0 };
  const bot = { x: 0, y: NECK_BOTTOM + 0.06, z: 0 };
  const pa = { x: p.x - bot.x, y: p.y - bot.y, z: p.z - bot.z };
  const ba = { x: top.x - bot.x, y: top.y - bot.y, z: top.z - bot.z };
  const h = clamp((pa.x * ba.x + pa.y * ba.y + pa.z * ba.z) / (ba.x * ba.x + ba.y * ba.y + ba.z * ba.z), 0, 1);
  const r = NECK_BASE_RX + (NECK_TOP_RX - NECK_BASE_RX) * h;
  return sdCapsule(p, bot, top, r);
}

/** Central chest/thorax — bridges neck base to both deltoids (one continuous bust). */
function sdChest(p: V3): number {
  if (p.y > NECK_BOTTOM - 0.06) return 999;
  const neckBridge = sdEllipsoid(p, { x: 0, y: -1.68, z: 0.1 }, { x: 0.48, y: 0.2, z: 0.3 });
  const upper = sdEllipsoid(p, { x: 0, y: -1.84, z: 0.15 }, { x: 2.14, y: 0.78, z: 0.58 });
  const lower = sdEllipsoid(p, { x: 0, y: -2.08, z: 0.12 }, { x: 2.42, y: 0.58, z: 0.5 });
  return smin(smin(neckBridge, upper, 0.36), lower, 0.4);
}

/** Signed distance to the full bust (negative = inside). */
export function bustSdf(p: V3): number {
  let d = smin(sdCranium(p), sdJaw(p), 0.38);
  d = smin(d, sdNeck(p), 0.22);
  d = smin(d, sdChest(p), 0.42);

  const deltoidL = sdEllipsoid(p, { x: -1.58, y: -1.96, z: 0.12 }, { x: 0.82, y: 0.46, z: 0.52 });
  const deltoidR = sdEllipsoid(p, { x: 1.58, y: -1.96, z: 0.12 }, { x: 0.82, y: 0.46, z: 0.52 });
  d = smin(d, deltoidL, 0.48);
  d = smin(d, deltoidR, 0.48);

  const trapL = sdCapsule(
    p,
    { x: -0.26, y: NECK_BOTTOM + 0.02, z: 0.02 },
    { x: -1.28, y: -1.96, z: 0.06 },
    0.32,
  );
  const trapR = sdCapsule(
    p,
    { x: 0.26, y: NECK_BOTTOM + 0.02, z: 0.02 },
    { x: 1.28, y: -1.96, z: 0.06 },
    0.32,
  );
  d = smin(d, trapL, 0.32);
  d = smin(d, trapR, 0.32);

  d = Math.max(d, CHEST_BOTTOM - p.y);
  return d;
}

export function sdfGradient(p: V3): V3 {
  const dx = bustSdf({ x: p.x + EPS, y: p.y, z: p.z }) - bustSdf({ x: p.x - EPS, y: p.y, z: p.z });
  const dy = bustSdf({ x: p.x, y: p.y + EPS, z: p.z }) - bustSdf({ x: p.x, y: p.y - EPS, z: p.z });
  const dz = bustSdf({ x: p.x, y: p.y, z: p.z + EPS }) - bustSdf({ x: p.x, y: p.y, z: p.z - EPS });
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** Sample line segment — all points must be strictly inside (d < 0). */
export function segmentInsideSolid(
  a: V3,
  b: V3,
  samples = 40,
): { ok: boolean; minMargin: number; worstT: number; worstD: number } {
  let minMargin = Infinity;
  let worstT = 0;
  let worstD = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const d = bustSdf(p);
    if (!Number.isFinite(d) || d >= 0) {
      return { ok: false, minMargin: Number.isFinite(d) ? -d : 0, worstT: t, worstD: d };
    }
    minMargin = Math.min(minMargin, -d);
  }
  return { ok: true, minMargin, worstT: -1, worstD: minMargin };
}

/** Rim weight from surface normal — bright where normal ⊥ view (+Z). */
export function rimWeightFromNormal(n: V3): number {
  const nxz = Math.hypot(n.x, n.z) || 1;
  const facing = Math.abs(n.z) / nxz;
  return clamp(Math.pow(1 - facing, 1.45), 0, 1);
}

/** Top 15% of head height — degenerate azimuth sampling; skip rings/rim here. */
export function isCrownSlice(y: number): boolean {
  return y > CHIN_Y + CROWN_SLICE_U * HEAD_H;
}

/** Bisect radial ray on slice y to land on the SDF zero level set. */
export function surfacePointAt(y: number, theta: number): { p: V3; n: V3 } | null {
  if (isCrownSlice(y)) return null;
  let lo = 0.02;
  let hi = 3.6;

  let dHi = bustSdf({ x: Math.cos(theta) * hi, y, z: Math.sin(theta) * hi });
  while (dHi < 0 && hi < 6) {
    hi *= 1.35;
    dHi = bustSdf({ x: Math.cos(theta) * hi, y, z: Math.sin(theta) * hi });
  }
  if (dHi < 0) return null;

  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) * 0.5;
    const d = bustSdf({ x: Math.cos(theta) * mid, y, z: Math.sin(theta) * mid });
    if (d > 0) hi = mid;
    else lo = mid;
  }
  const r = (lo + hi) * 0.5;
  if (r < MIN_SLICE_RADIUS) return null;
  const p = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
  return { p, n: sdfGradient(p) };
}

/** Front-view silhouette extrema on slice y (left/right max |x| on forward hemisphere). */
export function silhouetteExtremaAt(y: number): { left: { p: V3; n: V3 } | null; right: { p: V3; n: V3 } | null } {
  if (isCrownSlice(y)) return { left: null, right: null };
  let left: { p: V3; n: V3; x: number } | null = null;
  let right: { p: V3; n: V3; x: number } | null = null;
  for (let i = 0; i < 144; i++) {
    const theta = (i / 144) * Math.PI * 2;
    const hit = surfacePointAt(y, theta);
    if (!hit || hit.p.z < -0.06) continue;
    if (hit.p.x <= 0 && (!left || hit.p.x < left.x)) left = { ...hit, x: hit.p.x };
    if (hit.p.x >= 0 && (!right || hit.p.x > right.x)) right = { ...hit, x: hit.p.x };
  }
  return {
    left: left ? { p: left.p, n: left.n } : null,
    right: right ? { p: right.p, n: right.n } : null,
  };
}

/** Max horizontal extent on slice y (for chest-arc bounds). */
export function sliceMaxRadius(y: number): number {
  if (isCrownSlice(y)) return 0;
  let maxR = 0;
  for (let i = 0; i < 72; i++) {
    const theta = (i / 72) * Math.PI * 2;
    const hit = surfacePointAt(y, theta);
    if (hit) maxR = Math.max(maxR, Math.hypot(hit.p.x, hit.p.z));
  }
  return maxR;
}

/** Front-facing z on the surface at (x, y) via bisection. */
export function frontSurfaceZ(y: number, x: number): number {
  let lo = -0.05;
  let hi = 1.8;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const d = bustSdf({ x, y, z: mid });
    if (d > 0) hi = mid;
    else lo = mid;
  }
  return Math.max(0, (lo + hi) * 0.5);
}

/** Front-view half-width: max |x| on the forward hemisphere (z ≥ 0). */
export function frontHalfWidth(y: number): number {
  if (isCrownSlice(y)) return 0;
  let maxX = 0;
  for (let i = 0; i < 96; i++) {
    const theta = (i / 96) * Math.PI * 2;
    const hit = surfacePointAt(y, theta);
    if (!hit || hit.p.z < -0.04) continue;
    maxX = Math.max(maxX, Math.abs(hit.p.x));
  }
  return maxX;
}

/** Half-width samples over the top 15% of head height (ascending y toward crown). */
export function crownWidthProfile(): number[] {
  const y0 = CHIN_Y + (CROWN_SLICE_U - 0.14) * HEAD_H;
  const yEnd = CHIN_Y + CROWN_SLICE_U * HEAD_H - 0.01;
  const widths: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = y0 + (i / 24) * (yEnd - y0);
    if (isCrownSlice(y)) break;
    widths.push(frontHalfWidth(y));
  }
  return widths;
}

/** Jaw half-width samples from cheekbone down to chin (descending y). */
export function jawWidthProfile(): number[] {
  const yCheek = CHIN_Y + 0.55 * HEAD_H;
  const yChin = CHIN_Y + 0.04;
  const widths: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = yCheek - (i / 24) * (yCheek - yChin);
    widths.push(frontHalfWidth(y));
  }
  return widths;
}

export function maxAdjacentJawStep(): number {
  const widths = jawWidthProfile();
  let maxStep = 0;
  for (let i = 1; i < widths.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(widths[i] - widths[i - 1]));
  }
  return maxStep;
}

/** Anatomical probes for tests — compare slice radii at reference heights. */
export function cheekboneHalfWidth(): number {
  return frontHalfWidth(CHIN_Y + 0.55 * HEAD_H);
}

export function chinHalfWidth(): number {
  return frontHalfWidth(CHIN_Y + 0.06);
}

export function neckHalfWidth(): number {
  let min = Infinity;
  for (let i = 0; i <= 24; i++) {
    const y = NECK_BOTTOM + (i / 24) * (CHIN_Y - NECK_BOTTOM - 0.06);
    min = Math.min(min, frontHalfWidth(y));
  }
  return min;
}

export function deltoidHalfWidth(): number {
  return sliceMaxRadius(NECK_BOTTOM - 0.8);
}

/** Front half-width samples from neck base down toward deltoid (descending y). */
export function torsoWidthProfile(steps = 14): number[] {
  const yStart = NECK_BOTTOM - 0.04;
  const yEnd = NECK_BOTTOM - 0.82;
  const widths: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = yStart - (i / steps) * (yStart - yEnd);
    widths.push(frontHalfWidth(y));
  }
  return widths;
}

/** True when a horizontal slice has one connected front span (not disjoint lobes). */
export function frontSpanConnected(y: number): boolean {
  const bound = frontHalfWidth(y);
  if (bound < 0.2) return false;
  const samples = 24;
  let inside = 0;
  for (let i = 0; i <= samples; i++) {
    const x = (-bound + (2 * bound * i) / samples) * 0.96;
    const z = frontSurfaceZ(y, x);
    if (z > 0.015) inside += 1;
  }
  return inside >= samples * 0.82;
}
