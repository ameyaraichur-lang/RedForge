import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUMMON_DURATION_MS,
  clearSummonAnchor,
  getSummonElapsedMs,
  getSummonProgress,
  installSummonCaptureHooks,
  resetSummonAnchor,
  setSummonHold,
  startSummonAnchor,
} from './summon-anchor';

describe('summon-anchor', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      __RF_SUMMON_ANCHOR_MS__: null,
      __RF_SUMMON_HOLD_MS__: 0,
      __RF_SUMMON_HOLDING__: false,
      __RF_SUMMON_HOLD_SINCE__: undefined,
    });
    vi.stubGlobal('performance', { now: () => Date.now() });
  });

  afterEach(() => {
    clearSummonAnchor();
    vi.unstubAllGlobals();
  });

  it('progress reaches 1 only after full duration', () => {
    const t0 = 1_000;
    resetSummonAnchor(t0);
    expect(getSummonProgress(t0)).toBe(0);
    expect(getSummonProgress(t0 + SUMMON_DURATION_MS * 0.32)).toBeCloseTo(0.32, 2);
    expect(getSummonProgress(t0 + SUMMON_DURATION_MS - 1)).toBeLessThan(1);
    expect(getSummonProgress(t0 + SUMMON_DURATION_MS)).toBe(1);
  });

  it('hold freezes elapsed time for capture screenshots', () => {
    resetSummonAnchor(0);
    setSummonHold(true, 500);
    expect(getSummonElapsedMs(900)).toBe(500);
    setSummonHold(false, 900);
    expect(getSummonElapsedMs(1100)).toBe(700);
    expect(getSummonElapsedMs(1600)).toBe(1200);
  });

  it('startSummonAnchor is idempotent', () => {
    startSummonAnchor(200);
    startSummonAnchor(800);
    expect(getSummonElapsedMs(1200)).toBe(1000);
  });

  it('capture seek sets progress while held', () => {
    resetSummonAnchor(0);
    installSummonCaptureHooks();
    window.__RF_SUMMON_SEEK__?.(0.42);
    expect(getSummonProgress(9999)).toBeCloseTo(0.42, 2);
    window.__RF_SUMMON_SEEK__?.(0.91);
    expect(getSummonProgress(9999)).toBeCloseTo(0.91, 2);
  });

  it('reset preserves hold when requested (capture arm)', () => {
    resetSummonAnchor(0);
    setSummonHold(true, 100);
    resetSummonAnchor(500, { preserveHold: true });
    expect(getSummonElapsedMs(900)).toBe(0);
    setSummonHold(false, 900);
    expect(getSummonElapsedMs(1100)).toBe(200);
  });
});
