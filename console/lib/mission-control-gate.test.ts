import { beforeEach, describe, expect, it } from 'vitest';
import { isEntryLocked, isMissionControlLive, setMissionControlLive } from '@/lib/mission-control-gate';
import { transitionEntry } from '@/lib/entry-fsm';
import type { EntryContext } from '@/lib/entry-fsm';

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  repeatVisit: false,
  campaignRunning: false,
  bootSkip: false,
  bootFast: false,
  capturePhase: null,
  authRequired: false,
  authReady: true,
  reducedMotion: false,
  webglOk: true,
  ...over,
});

describe('mission control entry gate', () => {
  beforeEach(() => {
    setMissionControlLive(false);
  });

  it('blocks operator commands until mission control is live', () => {
    expect(isEntryLocked()).toBe(true);
    setMissionControlLive(true);
    expect(isEntryLocked()).toBe(false);
    expect(isMissionControlLive()).toBe(true);
  });

  it('campaign running does not bypass summoning entry path', () => {
    expect(transitionEntry('awaiting_entry', 'enter_mission_control', ctx({ campaignRunning: true }))).toBe(
      'summoning',
    );
    expect(transitionEntry('summoning', 'summon_complete', ctx({ campaignRunning: true }))).toBe('mission_control');
  });
});
