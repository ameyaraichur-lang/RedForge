import { describe, expect, it } from 'vitest';
import { shellColourFromWarm, warmChannelOrderingOk } from './warm-colour';

describe('warm face colour path', () => {
  it('keeps R >= G >= B for warm weights 0.1 through 1.0', () => {
    const { ok, worst, w } = warmChannelOrderingOk();
    expect(ok, `w=${w} rgb=${JSON.stringify(worst)}`).toBe(true);
  });

  it('never produces magenta mid-blend (B must not exceed G at w=0.5)', () => {
    const c = shellColourFromWarm(0.5);
    expect(c.r).toBeGreaterThanOrEqual(c.g);
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    expect(c.r - c.b).toBeGreaterThan(40);
  });
});
