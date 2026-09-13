'use client';

/**
 * Orchestrator entry state machine — single source for boot/auth/entry flow.
 * Deterministic URL/query controls for capture and E2E (no timing flakiness).
 */

export type EntryPhase =
  | 'initializing'
  | 'scene_loading'
  | 'assembling'
  | 'greeting'
  | 'awaiting_entry'
  | 'authenticating'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'summoning'
  | 'mission_control'
  | 'error'
  | 'skipped';

export type EntryContext = {
  repeatVisit: boolean;
  campaignRunning: boolean;
  bootSkip: boolean;
  bootFast: boolean;
  capturePhase: string | null;
  authRequired: boolean;
  authReady: boolean;
  reducedMotion: boolean;
  webglOk: boolean;
};

export type EntryDecision = {
  phase: EntryPhase;
  headPreFormed: boolean;
  skipAssembly: boolean;
  assemblyDurationMs: number;
  summonDurationMs: number;
  showSkip: boolean;
  showEntryPrompt: boolean;
  showMissionControl: boolean;
  cameraMode: 'head' | 'world';
};

const REPEAT_KEY = 'rf-world-booted';

export function readEntryContext(params: URLSearchParams): Omit<EntryContext, 'authRequired' | 'authReady' | 'reducedMotion' | 'webglOk'> {
  return {
    repeatVisit: typeof window !== 'undefined' && window.sessionStorage.getItem(REPEAT_KEY) === '1',
    campaignRunning: false,
    bootSkip: params.get('boot') === 'skip',
    bootFast: params.get('boot') === 'fast' || params.get('boot') === 'skip',
    capturePhase: params.get('phase'),
  };
}

/** Resolve initial phase from URL + session without race conditions. */
export function resolveInitialEntry(ctx: EntryContext): EntryDecision {
  const capture = ctx.capturePhase;
  if (ctx.bootSkip) {
    if (ctx.authRequired && !ctx.authReady) {
      return decision('authenticating', ctx, {
        headPreFormed: true,
        skipAssembly: true,
        showMissionControl: false,
        showEntryPrompt: false,
      });
    }
    if (capture === 'mission_control' || capture === 'planets') {
      return decision('mission_control', ctx, { headPreFormed: true, showMissionControl: true, cameraMode: 'world' });
    }
    return decision('awaiting_entry', ctx, {
      headPreFormed: true,
      skipAssembly: true,
      showMissionControl: false,
    });
  }
  if (capture === 'mission_control' || capture === 'planets') {
    return decision('mission_control', ctx, { headPreFormed: true, showMissionControl: true, cameraMode: 'world' });
  }
  if (ctx.campaignRunning) {
    return decision('mission_control', ctx, { headPreFormed: true, showMissionControl: true, cameraMode: 'world' });
  }
  if (ctx.authRequired && !ctx.authReady) {
    return decision('authenticating', ctx, {
      headPreFormed: false,
      showMissionControl: false,
      showEntryPrompt: false,
    });
  }
  if (ctx.repeatVisit || ctx.bootFast) {
    return decision('awaiting_entry', ctx, {
      headPreFormed: true,
      assemblyDurationMs: ctx.reducedMotion ? 400 : 800,
      summonDurationMs: 5600,
    });
  }
  if (!ctx.webglOk) {
    return decision('awaiting_entry', ctx, { headPreFormed: true, showMissionControl: false });
  }
  return decision('initializing', ctx, { headPreFormed: false });
}

function decision(
  phase: EntryPhase,
  ctx: EntryContext,
  overrides: Partial<EntryDecision> = {},
): EntryDecision {
  const firstVisit = !ctx.repeatVisit && !ctx.bootFast;
  const base: EntryDecision = {
    phase,
    headPreFormed: false,
    skipAssembly: ctx.bootFast || ctx.repeatVisit,
    assemblyDurationMs: firstVisit ? 4000 : ctx.reducedMotion ? 2000 : 1800,
    summonDurationMs: 5600,
    showSkip: firstVisit && phase !== 'mission_control' && phase !== 'skipped',
    showEntryPrompt: phase === 'awaiting_entry' || phase === 'greeting',
    showMissionControl: phase === 'mission_control' || phase === 'skipped' || phase === 'summoning',
    cameraMode: phase === 'mission_control' || phase === 'summoning' || phase === 'skipped' ? 'world' : 'head',
  };
  return { ...base, ...overrides };
}

export function markEntryComplete(): void {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(REPEAT_KEY, '1');
}

export function transitionEntry(
  current: EntryPhase,
  event:
    | 'scene_ready'
    | 'assembly_complete'
    | 'greeting_done'
    | 'enter_mission_control'
    | 'skip_boot'
    | 'summon_complete'
    | 'auth_required'
    | 'auth_ready'
    | 'operator_listening'
    | 'operator_thinking'
    | 'operator_speaking'
    | 'operator_idle'
    | 'error',
  ctx: EntryContext,
): EntryPhase {
  if (event === 'skip_boot') return 'skipped';
  if (event === 'error') return 'error';
  if (event === 'enter_mission_control') return 'summoning';
  if (event === 'summon_complete') return 'mission_control';
  if (ctx.campaignRunning && current !== 'mission_control' && current !== 'summoning') {
    return 'mission_control';
  }

  switch (current) {
    case 'initializing':
      if (event === 'scene_ready') return ctx.authRequired && !ctx.authReady ? 'authenticating' : 'assembling';
      break;
    case 'authenticating':
      if (event === 'auth_ready') {
        return ctx.bootSkip || ctx.bootFast ? 'awaiting_entry' : 'assembling';
      }
      break;
    case 'assembling':
      if (event === 'assembly_complete') return 'greeting';
      break;
    case 'greeting':
      if (event === 'greeting_done') return 'awaiting_entry';
      break;
    case 'awaiting_entry':
      if (event === 'operator_listening') return 'listening';
      if (event === 'operator_thinking') return 'thinking';
      if (event === 'operator_speaking') return 'speaking';
      break;
    case 'listening':
      if (event === 'operator_thinking') return 'thinking';
      if (event === 'operator_idle') return 'awaiting_entry';
      break;
    case 'thinking':
      if (event === 'operator_speaking') return 'speaking';
      if (event === 'operator_idle') return 'awaiting_entry';
      break;
    case 'speaking':
      if (event === 'greeting_done' || event === 'operator_idle') return 'awaiting_entry';
      break;
    case 'summoning':
      break;
    case 'skipped':
      return 'mission_control';
    default:
      break;
  }
  return current;
}

export function entryPhaseLabel(phase: EntryPhase): string {
  const labels: Record<EntryPhase, string> = {
    initializing: 'initializing',
    scene_loading: 'loading scene',
    assembling: 'assembling',
    greeting: 'greeting',
    awaiting_entry: 'awaiting entry',
    authenticating: 'authentication required',
    listening: 'listening',
    thinking: 'thinking',
    speaking: 'speaking',
    summoning: 'summoning mission control',
    mission_control: 'mission control live',
    error: 'error',
    skipped: 'fast path',
  };
  return labels[phase];
}

const HERO_STATE_LABELS: Record<EntryPhase, string> = {
  initializing: 'initializing',
  scene_loading: 'loading scene',
  assembling: 'assembling',
  greeting: 'greeting',
  awaiting_entry: 'awaiting entry',
  authenticating: 'authentication required',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'TTS active',
  summoning: 'summoning',
  mission_control: 'mission control live',
  error: 'error',
  skipped: 'fast path',
};

/** Single hero header: brand once + state — never repeat orchestrator tokens. */
export function heroChromeStatusLine(phase: EntryPhase): string {
  return `RedForge · ${HERO_STATE_LABELS[phase]}`;
}

export function heroChromeStateLabel(phase: EntryPhase): string {
  return HERO_STATE_LABELS[phase];
}

/** Mic/audio affordance for hero chrome — TTS vs PTT only. */
export function heroChromeMicState(phase: EntryPhase): 'active' | 'tts' | 'off' {
  if (phase === 'listening') return 'active';
  if (phase === 'speaking') return 'tts';
  return 'off';
}

export function isMissionControlLive(phase: EntryPhase): boolean {
  return phase === 'mission_control';
}

export function isHeroPhase(phase: EntryPhase): boolean {
  return !isMissionControlLive(phase) && phase !== 'skipped' && phase !== 'error';
}

/** Phases where bloom/post-FX should stay minimal (close-up bust). */
export function isHeadCloseUp(phase: EntryPhase): boolean {
  return (
    phase === 'assembling' ||
    phase === 'greeting' ||
    phase === 'awaiting_entry' ||
    phase === 'listening' ||
    phase === 'speaking' ||
    phase === 'authenticating' ||
    phase === 'summoning'
  );
}
