/** Summon choreography — hold bust, progressive overlap, HUD late reveal. */

import { SUMMON_DURATION_S } from '@/lib/summon-anchor';

export { SUMMON_DURATION_S };

/** Stage boundaries on a 5.6s summon (seconds → normalized t). */
const T_BUST_HOLD = 2.5 / SUMMON_DURATION_S;
const T_DISSOLVE_END = 4.5 / SUMMON_DURATION_S;

/** Normalized t when HUD instruments may appear — hero CTA must hide before this. */
export const SUMMON_HUD_START_T = T_DISSOLVE_END;

/** Camera pullback 0–2.5s while bust holds. */
export function summonCameraEase(t: number): number {
  if (t <= 0.06) return 0;
  const u = Math.min(1, (t - 0.06) / (T_BUST_HOLD - 0.06));
  return u * u * (3 - 2 * u);
}

/** Bust persists through 2.5s, dissolves 2.5–4.5s. */
export function summonHeadFade(t: number): number {
  if (t <= T_BUST_HOLD) return 1;
  const u = Math.min(1, (t - T_BUST_HOLD) / (T_DISSOLVE_END - T_BUST_HOLD));
  return 1 - u * u;
}

/** Planets emerge from ~15% for >=2.5s bust overlap. */
export function summonPlanetReveal(t: number): number {
  if (t < 0.15) return 0;
  return Math.min(1, (t - 0.15) / (T_DISSOLVE_END - 0.15));
}

/** Mission-control instrument HUD — invisible until >=4.5s, full by end. */
export function summonHudReveal(t: number): number {
  if (t < T_DISSOLVE_END) return 0;
  const u = Math.min(1, (t - T_DISSOLVE_END) / (1 - T_DISSOLVE_END));
  return u * u * (3 - 2 * u);
}

/** Ambient grid/stars fade in during early summon. */
export function summonAmbientReveal(t: number): number {
  if (t < 0.1) return 0;
  return Math.min(1, (t - 0.1) / (T_BUST_HOLD - 0.1));
}
