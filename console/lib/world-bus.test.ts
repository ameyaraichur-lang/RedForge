import { describe, expect, it } from 'vitest';
import { worldBus } from '@/lib/world-bus';

describe('worldBus G2 runtime semantics', () => {
  it('maps G2 gate_approved to G2_release impact, not G1', () => {
    worldBus.reset();
    worldBus.ingest({
      type: 'gate_approved',
      gate_level: 'G2',
      gate_request_id: 'RF-G2-test',
      technique_id: 'release',
    });
    expect(worldBus.counters.gatesApproved).toBe(1);
    expect(worldBus.impacts.some((i) => i.node === 'G2_release')).toBe(true);
    expect(worldBus.impacts.some((i) => i.node === 'G1_gatekeeper')).toBe(false);
  });

  it('maps G1 gate_approved to G1_gatekeeper only', () => {
    worldBus.reset();
    worldBus.ingest({
      type: 'gate_approved',
      gate_level: 'G1',
      gate_request_id: 'RF-G1-test',
      technique_id: 'PIN-001',
    });
    expect(worldBus.impacts.some((i) => i.node === 'G1_gatekeeper')).toBe(true);
    expect(worldBus.impacts.some((i) => i.node === 'G2_release')).toBe(false);
  });
});
