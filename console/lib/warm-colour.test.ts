import { describe, expect, it } from 'vitest';
import {
  FACE_ESTABLISHED_W,
  shellColourFromWarm,
  warmChannelOrderingOk,
  warmCrossFadeMonotonic,
} from './warm-colour';

describe('warm face colour path', () => {
  it('never puts green in the trough, at any warm weight, rim or speaking state', () => {
    const { ok, worst, w } = warmChannelOrderingOk();
    expect(ok, `w=${w} rgb=${JSON.stringify(worst)}`).toBe(true);
  });

  it('reads fully amber once the face wash is established', () => {
    const c = shellColourFromWarm(0.8);
    expect(c.r).toBeGreaterThanOrEqual(c.g);
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    expect(c.r - c.b).toBeGreaterThan(40);
  });

  it('stays cool at the edge of the face oval so the wash has a soft border', () => {
    // A hard cool→amber step here is what made the face look like a mask.
    const edge = shellColourFromWarm(0.08);
    expect(edge.b).toBeGreaterThan(edge.r);
  });

  it('moves monotonically from cool to amber with no magenta midpoint', () => {
    for (const rim of [0, 0.5, 1]) {
      const { ok, w } = warmCrossFadeMonotonic(rim);
      expect(ok, `rim=${rim} broke monotonicity at w=${w}`).toBe(true);
    }
  });

  it('crosses over to amber before the face is established', () => {
    const mid = shellColourFromWarm(FACE_ESTABLISHED_W);
    expect(mid.r).toBeGreaterThan(mid.b);
  });
});
