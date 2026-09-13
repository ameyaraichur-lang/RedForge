/** Mirrors shell fragment warm tint — amber via warm-biased intermediate, never blue→orange RGB mix. */

export type Rgb = { r: number; g: number; b: number };

const COOL: Rgb = { r: 34, g: 200, b: 255 };
/** Warm-biased intermediate — lerp cool→amber stays in R≥G≥B quadrant (no magenta). */
const AMBER: Rgb = { r: 195, g: 108, b: 32 };
const WARM: Rgb = { r: 255, g: 122, b: 24 };
const HOT: Rgb = { r: 255, g: 200, b: 112 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const DARK_AMBER: Rgb = { r: 172, g: 96, b: 28 };

/** Shell colour (matches SHELL_FRAG): cool ridges at w≈0; w≥0.1 stays R≥G≥B amber. */
export function shellColourFromWarm(w: number, rim = 0): Rgb {
  const tAmber = w < 0.02 ? 0 : smoothstep(0.1, 0.88, w);
  const tHot = smoothstep(0.55, 0.92, w);
  let col = w < 0.02 ? { ...COOL } : lerpRgb(DARK_AMBER, AMBER, tAmber);
  if (w >= 0.02) {
    col = {
      r: col.r + WARM.r * tAmber * 0.08 + HOT.r * tHot * 0.1,
      g: col.g + WARM.g * tAmber * 0.06 + HOT.g * tHot * 0.08,
      b: col.b + WARM.b * tAmber * 0.02 + HOT.b * tHot * 0.03,
    };
  }
  const rimCol: Rgb = { r: 236, g: 252, b: 255 };
  const rf = rim * 0.55 * (1 - tAmber * 0.98);
  let out = {
    r: col.r * (1 - rf) + rimCol.r * rf,
    g: col.g * (1 - rf) + rimCol.g * rf,
    b: col.b * (1 - rf) + rimCol.b * rf,
  };
  let gain = 0.78 + rim * 0.42 + tAmber * 0.06 + tHot * 0.03;
  if (tAmber > 0) gain = Math.min(gain, 0.55);
  out = { r: out.r * gain, g: out.g * gain, b: out.b * gain };
  return out;
}

/** Objective guard: amber path keeps R >= G >= B for warm weights 0.1–1.0. */
export function warmChannelOrderingOk(): { ok: boolean; worst: Rgb | null; w: number } {
  for (let i = 2; i <= 20; i++) {
    const w = i / 20;
    const c = shellColourFromWarm(w);
    if (!(c.r >= c.g && c.g >= c.b)) {
      return { ok: false, worst: c, w };
    }
  }
  return { ok: true, worst: null, w: 1 };
}
