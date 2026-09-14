import { describe, expect, it } from 'vitest';
import { assemblyConvergence } from './assembly-convergence';

describe('assemblyConvergence', () => {
  it('starts near zero and reaches full convergence at progress 1', () => {
    expect(assemblyConvergence(0)).toBeLessThan(0.05);
    expect(assemblyConvergence(1)).toBeGreaterThan(0.95);
  });

  it('is still visibly building at the midpoint, not already finished', () => {
    // The reference keeps adding material right through the beat. An early
    // plateau is the defect this curve exists to prevent, so the midpoint must
    // sit well short of complete.
    expect(assemblyConvergence(0.36)).toBeGreaterThan(0.1);
    expect(assemblyConvergence(0.5)).toBeLessThan(0.62);
    expect(assemblyConvergence(0.4)).toBeGreaterThan(assemblyConvergence(0.15));
    expect(assemblyConvergence(0.08)).toBeLessThan(0.2);
  });

  it('resolves late, with no dead stretch, like the reference beat', () => {
    // The reference opens on a thin dust arc and only resolves near the end,
    // so the quarters are deliberately uneven. What must hold is that every
    // quarter still advances and that the figure comes together in the back
    // half rather than being finished early and then holding.
    const q = [0, 0.25, 0.5, 0.75, 1].map(assemblyConvergence);
    for (let i = 0; i < q.length - 1; i++) {
      expect(q[i + 1] - q[i]).toBeGreaterThan(0.02);
    }
    const front = q[2] - q[0];
    const back = q[4] - q[2];
    expect(back).toBeGreaterThan(front);
    expect(back).toBeGreaterThan(0.4);
  });

  it('monotonically increases with progress', () => {
    let prev = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      const c = assemblyConvergence(p);
      expect(c).toBeGreaterThanOrEqual(prev - 0.001);
      prev = c;
    }
  });
});
