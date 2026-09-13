'use client';

/**
 * Deterministic capture controls — drive full UI state from URL, not shader-only hacks.
 * ?capture=1 enables data-capture attributes; ?phase=… freezes or simulates phases.
 */

export type CaptureMode = {
  active: boolean;
  /** Camera checkpoint only — never fakes user/listening/speaking state. */
  assemblyProgress: number | null;
  summonProgress: number | null;
  hideChrome: boolean;
};

export function readCaptureMode(params: URLSearchParams): CaptureMode {
  const phase = params.get('phase');
  const capture = params.get('capture') === '1' || Boolean(params.get('assembly')) || Boolean(params.get('summon'));
  const cameraOnly = Boolean(params.get('assembly')) || Boolean(params.get('summon')) || phase === 'assembly' || phase === 'summon';
  return {
    active: capture,
    assemblyProgress: parseCaptureFloat(params.get('assembly')),
    summonProgress: parseCaptureFloat(params.get('summon')),
    hideChrome: capture && cameraOnly,
  };
}

function parseCaptureFloat(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

