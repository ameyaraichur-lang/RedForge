/**
 * CPU mirror of the shell fragment's colour path.
 *
 * The bust draws cool ridge rings and an amber face into the same additive
 * buffer, so the failure mode to guard against is magenta: blue and orange
 * summing to R≈B with G in the trough. The shader cross-fades cool→amber over
 * the face oval, so the blend region is itself a magenta risk and has to be
 * swept, not just the endpoints.
 */

export type Rgb = { r: number; g: number; b: number };

/** uCool / uRimCol as supplied by the world theme. */
const COOL: Rgb = { r: 34, g: 200, b: 255 };
const RIM: Rgb = { r: 236, g: 252, b: 255 };

/** Amber endpoints, matching SHELL_FRAG (idle, non-speaking). */
const DARK_AMBER: Rgb = { r: 210, g: 92, b: 16 };
const AMBER: Rgb = { r: 238, g: 108, b: 18 };
/** Additive warm/hot lifts, expressed in 0–255 like the rest of this module. */
const WARM_LIFT: Rgb = { r: 255, g: 107, b: 10 };
const HOT_LIFT: Rgb = { r: 255, g: 173, b: 56 };

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

function scale(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

/**
 * Shell colour for a given warm weight and rim emphasis.
 * Mirrors SHELL_FRAG: cool ridges at w≈0, amber face at high w, cross-faded
 * through `tAmber` in between.
 */
export function shellColourFromWarm(w: number, rim = 0, speaking = 0): Rgb {
  const tAmber = w < 0.02 ? 0 : smoothstep(0.04, 0.72, w);
  const tHot = smoothstep(0.52, 0.92, w);

  let warmCol = lerpRgb(
    lerpRgb(DARK_AMBER, { r: 228, g: 82, b: 10 }, speaking),
    lerpRgb(AMBER, { r: 252, g: 98, b: 12 }, speaking),
    tAmber,
  );
  const warmAdd = tAmber * (0.1 - speaking * 0.04);
  const hotAdd = tHot * (0.06 - speaking * 0.04);
  warmCol = {
    r: warmCol.r + WARM_LIFT.r * warmAdd + HOT_LIFT.r * hotAdd,
    g: warmCol.g + WARM_LIFT.g * warmAdd + HOT_LIFT.g * hotAdd,
    b: warmCol.b + WARM_LIFT.b * warmAdd + HOT_LIFT.b * hotAdd,
  };
  const warmGain = Math.min(0.82, (speaking ? 0.7 : 0.76) + tHot * (0.06 - speaking * 0.02));

  const coolCol = lerpRgb(COOL, RIM, rim * 0.45);
  const coolGain = 0.62 + rim * 0.34;

  return lerpRgb(scale(coolCol, coolGain), scale(warmCol, warmGain), tAmber);
}

/** Warm weight at which the face wash is considered established. */
export const FACE_ESTABLISHED_W = 0.55;

/**
 * Objective guard against magenta, swept across warm weight, rim and speaking.
 *
 * Magenta's signature is green sitting in the trough with red and blue both
 * above it, so that is the condition to forbid everywhere. Note this does NOT
 * demand R ≥ G ≥ B at low warm weights: grains at the edge of the face oval are
 * deliberately still cool, and requiring amber ordering there is what forced
 * the face to step to a hard-edged mask.
 */
export function warmChannelOrderingOk(): { ok: boolean; worst: Rgb | null; w: number } {
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    for (let r = 0; r <= 4; r++) {
      for (const speaking of [0, 1]) {
        const c = shellColourFromWarm(w, r / 4, speaking);
        // Green may not be the trough between red and blue.
        if (c.g < Math.min(c.r, c.b) - 1e-6) return { ok: false, worst: c, w };
        // Once the wash is established the colour must be fully amber.
        if (w >= FACE_ESTABLISHED_W && !(c.r >= c.g && c.g >= c.b)) {
          return { ok: false, worst: c, w };
        }
      }
    }
  }
  return { ok: true, worst: null, w: 1 };
}

/**
 * The cross-fade must move monotonically away from blue: red minus blue never
 * decreases as warm weight rises. That is what stops the blend from doubling
 * back through a magenta midpoint.
 *
 * Blue itself is allowed to rise near the hot core, where the centre of the
 * face lifts toward pale gold — a highlight, not a regression toward cool.
 */
export function warmCrossFadeMonotonic(rim = 0): { ok: boolean; w: number } {
  let prev = shellColourFromWarm(0, rim);
  for (let i = 1; i <= 40; i++) {
    const w = i / 40;
    const c = shellColourFromWarm(w, rim);
    if (c.r - c.b < prev.r - prev.b - 1e-6) return { ok: false, w };
    prev = c;
  }
  return { ok: true, w: 1 };
}
