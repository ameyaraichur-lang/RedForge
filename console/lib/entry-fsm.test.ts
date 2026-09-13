import { describe, expect, it } from 'vitest';
import {
  heroChromeMicState,
  heroChromeStatusLine,
  isHeadCloseUp,
  isMissionControlLive,
  resolveInitialEntry,
  transitionEntry,
  type EntryContext,
} from './entry-fsm';

function ctx(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    repeatVisit: false,
    campaignRunning: false,
    bootSkip: false,
    bootFast: false,
    capturePhase: null,
    authRequired: false,
    authReady: true,
    reducedMotion: false,
    webglOk: true,
    ...overrides,
  };
}

describe('resolveInitialEntry', () => {
  it('first visit starts initializing without pre-formed head', () => {
    const d = resolveInitialEntry(ctx());
    expect(d.phase).toBe('initializing');
    expect(d.headPreFormed).toBe(false);
    expect(d.skipAssembly).toBe(false);
  });

  it('boot=skip with secure auth required lands on authenticating', () => {
    const d = resolveInitialEntry(ctx({ bootSkip: true, authRequired: true, authReady: false }));
    expect(d.phase).toBe('authenticating');
    expect(d.showEntryPrompt).toBe(false);
  });

  it('capture assembly query does not force assembling phase label', () => {
    const d = resolveInitialEntry(ctx({ capturePhase: 'assembly' }));
    expect(d.phase).toBe('initializing');
  });

  it('secure auth required on no-webgl path lands on authenticating', () => {
    const d = resolveInitialEntry(ctx({ authRequired: true, authReady: false, webglOk: false }));
    expect(d.phase).toBe('authenticating');
  });

  it('boot=fast skips assembly animation', () => {
    const d = resolveInitialEntry(ctx({ bootFast: true }));
    expect(d.phase).toBe('awaiting_entry');
    expect(d.headPreFormed).toBe(true);
    expect(d.skipAssembly).toBe(true);
  });
});

describe('transitionEntry', () => {
  it('scene_ready goes to assembling when auth ready', () => {
    expect(transitionEntry('initializing', 'scene_ready', ctx())).toBe('assembling');
  });

  it('auth_ready on boot=skip goes to awaiting_entry not assembling', () => {
    expect(transitionEntry('authenticating', 'auth_ready', ctx({ bootSkip: true }))).toBe('awaiting_entry');
  });

  it('assembly_complete leads to greeting', () => {
    expect(transitionEntry('assembling', 'assembly_complete', ctx())).toBe('greeting');
  });

  it('enter_mission_control starts summoning', () => {
    expect(transitionEntry('awaiting_entry', 'enter_mission_control', ctx())).toBe('summoning');
  });

  it('campaign running does not skip summoning phase', () => {
    expect(transitionEntry('summoning', 'summon_complete', ctx({ campaignRunning: true }))).toBe(
      'mission_control',
    );
    expect(transitionEntry('awaiting_entry', 'enter_mission_control', ctx({ campaignRunning: true }))).toBe(
      'summoning',
    );
  });

  it('campaign running jumps to mission_control only outside entry lock', () => {
    expect(transitionEntry('greeting', 'greeting_done', ctx({ campaignRunning: true }))).toBe(
      'mission_control',
    );
  });
});

describe('phase helpers', () => {
  it('mission control is live only in mission_control phase', () => {
    expect(isMissionControlLive('mission_control')).toBe(true);
    expect(isMissionControlLive('awaiting_entry')).toBe(false);
  });

  it('speaking is head close-up', () => {
    expect(isHeadCloseUp('speaking')).toBe(true);
    expect(isHeadCloseUp('mission_control')).toBe(false);
  });

  it('hero chrome uses one RedForge brand token and one state — no orchestrator repeat', () => {
    for (const phase of ['assembling', 'speaking', 'listening', 'summoning'] as const) {
      const line = heroChromeStatusLine(phase);
      expect(line.toLowerCase().split('orchestrator').length - 1).toBe(0);
      expect(line.toLowerCase().split('redforge').length - 1).toBe(1);
      expect(line.split('·').length).toBe(2);
    }
  });

  it('speaking shows TTS active only; listening is separate mic-on phase', () => {
    expect(heroChromeStatusLine('speaking')).toBe('RedForge · TTS active');
    expect(heroChromeStatusLine('speaking').toLowerCase()).not.toMatch(/mic on/);
    expect(heroChromeMicState('speaking')).toBe('tts');
    expect(heroChromeStatusLine('listening')).toBe('RedForge · listening');
    expect(heroChromeMicState('listening')).toBe('active');
    expect(heroChromeStatusLine('summoning')).toBe('RedForge · summoning');
    expect(heroChromeStatusLine('summoning').toLowerCase()).not.toContain('orchestrator');
  });
});
