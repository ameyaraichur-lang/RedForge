import { describe, expect, it } from 'vitest';
import { BUST_LANDMARKS, ZONE, bustRings } from './bust-rings.generated';

/**
 * The bust is sliced offline from a real head scan, so these assertions are
 * anatomical rather than aesthetic: they pin the proportions that hand-fitted
 * radius curves kept getting wrong (a pinched neck and a missing cranium dome).
 */
describe('bust ring anatomy', () => {
  const rings = bustRings();

  /** Widest loop at each slice height; ear contours are narrow and must not win. */
  const levels = (() => {
    const byY = new Map<number, number>();
    for (const r of rings) {
      const k = Math.round(r.y * 1e4);
      byY.set(k, Math.max(byY.get(k) ?? 0, r.halfWidth));
    }
    return [...byY.entries()].map(([k, w]) => ({ y: k / 1e4, w })).sort((a, b) => a.y - b.y);
  })();

  it('decodes a dense ring set spanning crown to chest', () => {
    expect(rings.length).toBeGreaterThan(60);
    const ys = rings.map((r) => r.y);
    expect(Math.max(...ys)).toBeCloseTo(BUST_LANDMARKS.crownY, 1);
    expect(Math.min(...ys)).toBeCloseTo(BUST_LANDMARKS.chestBottom, 1);
    // Every ring must be a real loop, not a stub.
    for (const r of rings) {
      expect(r.verts.length).toBeGreaterThanOrEqual(12);
      expect(r.perimeter).toBeGreaterThan(0);
    }
  });

  it('has a neck roughly two thirds of head width, not a pinch', () => {
    const ratio = BUST_LANDMARKS.neckHalfWidth / BUST_LANDMARKS.headHalfWidth;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.78);
  });

  it('has shoulders about twice head width', () => {
    const ratio = BUST_LANDMARKS.shoulderHalfWidth / BUST_LANDMARKS.headHalfWidth;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.6);
  });

  it('orders the landmarks crown > brow > cheekbone > chin > neck > shoulder', () => {
    const l = BUST_LANDMARKS;
    expect(l.crownY).toBeGreaterThan(l.browY);
    expect(l.browY).toBeGreaterThan(l.headWidestY);
    expect(l.headWidestY).toBeGreaterThan(l.chinY);
    expect(l.chinY).toBeGreaterThan(l.neckY);
    expect(l.neckY).toBeGreaterThan(l.shoulderY);
    expect(l.shoulderY).toBeGreaterThan(l.chestBottom);
  });

  it('tapers to a dome at the crown instead of a flat cut', () => {
    const top = levels.filter((l) => l.y > BUST_LANDMARKS.browY);
    expect(top.length).toBeGreaterThan(4);
    // Width must fall monotonically-ish toward the crown, ending narrow.
    const highest = top[top.length - 1];
    expect(highest.w).toBeLessThan(BUST_LANDMARKS.headHalfWidth * 0.55);
    expect(highest.w).toBeGreaterThan(0.02);
  });

  it('makes the neck the narrowest point between jaw and shoulders', () => {
    const band = levels.filter((l) => l.y < BUST_LANDMARKS.chinY && l.y > BUST_LANDMARKS.shoulderY);
    expect(band.length).toBeGreaterThan(3);
    const narrowest = band.reduce((a, b) => (b.w < a.w ? b : a));
    expect(narrowest.w).toBeCloseTo(BUST_LANDMARKS.neckHalfWidth, 1);
    // And it must be narrower than both the head above and the shoulders below.
    expect(narrowest.w).toBeLessThan(BUST_LANDMARKS.headHalfWidth);
    expect(narrowest.w).toBeLessThan(BUST_LANDMARKS.shoulderHalfWidth);
  });

  it('widens continuously from neck into shoulders with no gap', () => {
    const band = levels
      .filter((l) => l.y <= BUST_LANDMARKS.neckY && l.y >= BUST_LANDMARKS.shoulderY)
      .sort((a, b) => b.y - a.y);
    expect(band.length).toBeGreaterThan(3);
    for (let i = 1; i < band.length; i++) {
      // Allow small non-monotonic wobble from scan noise, but never a collapse.
      expect(band[i].w).toBeGreaterThan(band[i - 1].w * 0.82);
    }
    expect(band[band.length - 1].w).toBeGreaterThan(band[0].w * 1.8);
  });

  it('assigns every zone at least one ring, ordered by height', () => {
    const seen = new Map<number, number[]>();
    for (const r of rings) {
      if (!seen.has(r.zone)) seen.set(r.zone, []);
      seen.get(r.zone)!.push(r.y);
    }
    for (const zone of Object.values(ZONE)) {
      expect(seen.has(zone), `zone ${zone} has rings`).toBe(true);
    }
    const meanY = (z: number) => {
      const ys = seen.get(z)!;
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(meanY(ZONE.crown)).toBeGreaterThan(meanY(ZONE.face));
    expect(meanY(ZONE.face)).toBeGreaterThan(meanY(ZONE.jaw));
    expect(meanY(ZONE.jaw)).toBeGreaterThan(meanY(ZONE.neck));
    expect(meanY(ZONE.neck)).toBeGreaterThan(meanY(ZONE.shoulder));
    expect(meanY(ZONE.shoulder)).toBeGreaterThan(meanY(ZONE.chest));
  });

  it('keeps the face zone in front of the head centre', () => {
    const face = rings.filter((r) => r.zone === ZONE.face);
    expect(face.length).toBeGreaterThan(3);
    // Face rings must reach forward (+z) — that is where the amber wash lands.
    for (const r of face) {
      const maxZ = Math.max(...r.verts.map((v) => v[1]));
      expect(maxZ).toBeGreaterThan(0.1);
    }
  });
});
