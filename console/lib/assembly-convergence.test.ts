import { describe, expect, it } from 'vitest';
import { assemblyConvergence } from './assembly-convergence';

describe('assemblyConvergence', () => {
  it('starts near zero and reaches full convergence at progress 1', () => {
    expect(assemblyConvergence(0)).toBeLessThan(0.05);
    expect(assemblyConvergence(1)).toBeGreaterThan(0.95);
  });

  it('crown/face bands converge by ~36% progress', () => {
    expect(assemblyConvergence(0.36)).toBeGreaterThanOrEqual(0.32);
    expect(assemblyConvergence(0.36)).toBeLessThan(0.88);
    expect(assemblyConvergence(0.4)).toBeGreaterThan(assemblyConvergence(0.15));
    expect(assemblyConvergence(0.08)).toBeLessThan(0.2);
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
