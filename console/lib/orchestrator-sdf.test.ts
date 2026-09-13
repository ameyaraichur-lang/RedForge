import { describe, expect, it } from 'vitest';
import {
  CHIN_Y,
  HEAD_H,
  LANDMARKS,
  MIN_SLICE_RADIUS,
  NECK_BOTTOM,
  cheekboneHalfWidth,
  chinHalfWidth,
  crownWidthProfile,
  deltoidHalfWidth,
  frontHalfWidth,
  jawWidthProfile,
  neckHalfWidth,
  frontSpanConnected,
  segmentInsideSolid,
  sliceMaxRadius,
  torsoWidthProfile,
} from './orchestrator-sdf';

describe('orchestrator SDF anatomy', () => {
  it('chin is narrower than cheekbone', () => {
    expect(chinHalfWidth()).toBeLessThan(cheekboneHalfWidth() * 0.72);
    expect(chinHalfWidth()).toBeGreaterThan(0.4);
    expect(chinHalfWidth()).toBeLessThan(0.6);
    expect(cheekboneHalfWidth()).toBeGreaterThan(0.78);
    expect(cheekboneHalfWidth()).toBeLessThan(1.02);
  });

  it('neck is the narrowest slice between jaw and deltoids', () => {
    const neck = neckHalfWidth();
    const chin = chinHalfWidth();
    const cheek = cheekboneHalfWidth();
    const delt = deltoidHalfWidth();
    expect(neck).toBeLessThan(chin);
    expect(neck).toBeLessThan(cheek * 0.55);
    expect(neck).toBeLessThan(delt * 0.35);
    expect(neck).toBeGreaterThan(0.28);
    expect(neck).toBeLessThan(0.48);
  });

  it('deltoid slice is widest in the bust', () => {
    const delt = deltoidHalfWidth();
    expect(delt).toBeGreaterThan(cheekboneHalfWidth() * 1.8);
    expect(delt).toBeGreaterThan(1.9);
    expect(delt).toBeLessThan(2.85);
  });

  it('shoulder slices are wider than neck slices', () => {
    const yNeck = NECK_BOTTOM + 0.14;
    const yDelt = NECK_BOTTOM - 0.8;
    expect(sliceMaxRadius(yDelt)).toBeGreaterThan(sliceMaxRadius(yNeck) * 2.5);
  });

  it('jaw corner is wider than chin but narrower than cheekbone', () => {
    const jaw = frontHalfWidth(CHIN_Y + 0.15 * HEAD_H);
    const chin = chinHalfWidth();
    const cheek = cheekboneHalfWidth();
    expect(jaw).toBeGreaterThan(chin * 1.08);
    expect(jaw).toBeLessThan(cheek * 0.88);
  });
});

describe('orchestrator SDF connectivity', () => {
  const segments: Array<[string, keyof typeof LANDMARKS, keyof typeof LANDMARKS]> = [
    ['neck → left deltoid', 'neckCenter', 'leftDeltoid'],
    ['neck → right deltoid', 'neckCenter', 'rightDeltoid'],
    ['chin → neck', 'chin', 'neckCenter'],
    ['neck → chest', 'neckCenter', 'chestCenter'],
  ];

  it.each(segments)('%s stays inside solid (40 samples)', (_label, aKey, bKey) => {
    const result = segmentInsideSolid(LANDMARKS[aKey], LANDMARKS[bKey], 40);
    expect(result.ok, `worstT=${result.worstT} d=${result.worstD}`).toBe(true);
    expect(result.minMargin).toBeGreaterThan(0);
  });
});

describe('orchestrator SDF crown monotonicity', () => {
  it('top 15% half-width decreases monotonically toward crown', () => {
    const widths = crownWidthProfile();
    expect(widths.length).toBeGreaterThan(2);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 0.002);
    }
  });

  it('degenerate crown slices fall below MIN_SLICE_RADIUS threshold', () => {
    const yTop = CHIN_Y + 0.98 * HEAD_H;
    expect(sliceMaxRadius(yTop)).toBeLessThan(MIN_SLICE_RADIUS + 0.02);
  });
});

describe('orchestrator SDF torso continuity', () => {
  it('torso slices are one connected span from neck base toward deltoids', () => {
    const yStart = NECK_BOTTOM - 0.04;
    const yEnd = NECK_BOTTOM - 0.78;
    for (let i = 0; i <= 8; i++) {
      const y = yStart - (i / 8) * (yStart - yEnd);
      expect(frontSpanConnected(y), `disconnected at y=${y.toFixed(2)}`).toBe(true);
    }
  });

  it('torso half-width increases monotonically from neck base toward deltoid', () => {
    const widths = torsoWidthProfile();
    expect(widths.length).toBeGreaterThan(4);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 0.015);
    }
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0] * 1.35);
  });
});

describe('orchestrator SDF jaw continuity', () => {
  it('cheekbone→chin half-width is monotonically non-increasing', () => {
    const widths = jawWidthProfile();
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 0.001);
    }
  });

  it('adjacent jaw slice steps stay under 0.06 units', () => {
    const widths = jawWidthProfile();
    let maxStep = 0;
    for (let i = 1; i < widths.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(widths[i] - widths[i - 1]));
    }
    expect(maxStep).toBeLessThanOrEqual(0.06);
  });
});
