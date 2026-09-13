'use client';

/** Single monotonic summon wall-clock anchor — shared by FSM, camera, capture hold, diagnostics. */

export const SUMMON_DURATION_MS = 5600;
export const SUMMON_DURATION_S = SUMMON_DURATION_MS / 1000;

declare global {
  interface Window {
    __RF_SUMMON_ANCHOR_MS__?: number | null;
    __RF_SUMMON_HOLD_MS__?: number;
    __RF_SUMMON_HOLDING__?: boolean;
    __RF_SUMMON_HOLD_SINCE__?: number;
    /** Capture: hold anchor at t=0 before enter click (set by Playwright init/eval). */
    __RF_SUMMON_PRE_ARM__?: boolean;
    __RF_SUMMON_SET_HOLD__?: (hold: boolean) => void;
    __RF_SUMMON_RESET__?: () => void;
    /** Atomic capture resync — hold, reset anchor to now, release hold. */
    __RF_SUMMON_ARM__?: () => void;
    /** Live summon diagnostics for capture (not rAF-throttled). */
    __RF_SUMMON_LIVE__?: () => ReturnType<typeof getSummonDiagnostics>;
    /** Seek summon progress while held — deterministic capture frames. */
    __RF_SUMMON_SEEK__?: (t: number) => void;
    __RF_SUMMON_DIAG__?: {
      anchorMs: number | null;
      elapsedMs: number;
      t: number;
      holdMs: number;
      holding: boolean;
      durationMs: number;
      hud?: number;
      planets?: number;
    };
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function resetSummonAnchor(now = nowMs(), opts?: { preserveHold?: boolean }): void {
  if (typeof window === 'undefined') return;
  const preserveHold = opts?.preserveHold === true;
  const wasHolding = window.__RF_SUMMON_HOLDING__;
  const holdMs = window.__RF_SUMMON_HOLD_MS__ ?? 0;
  window.__RF_SUMMON_ANCHOR_MS__ = now;
  if (preserveHold && wasHolding) {
    window.__RF_SUMMON_HOLD_MS__ = holdMs;
    window.__RF_SUMMON_HOLDING__ = true;
    window.__RF_SUMMON_HOLD_SINCE__ = now;
  } else {
    window.__RF_SUMMON_HOLD_MS__ = 0;
    window.__RF_SUMMON_HOLDING__ = false;
    window.__RF_SUMMON_HOLD_SINCE__ = undefined;
  }
}

export function clearSummonAnchor(): void {
  if (typeof window === 'undefined') return;
  window.__RF_SUMMON_ANCHOR_MS__ = null;
  window.__RF_SUMMON_HOLD_MS__ = 0;
  window.__RF_SUMMON_HOLDING__ = false;
  window.__RF_SUMMON_HOLD_SINCE__ = undefined;
}

export function startSummonAnchor(now = nowMs()): void {
  if (typeof window === 'undefined') return;
  if (window.__RF_SUMMON_ANCHOR_MS__ == null) resetSummonAnchor(now);
}

function refreshSummonDiag(): void {
  if (typeof window === 'undefined') return;
  window.__RF_SUMMON_DIAG__ = getSummonDiagnostics();
}

export function setSummonHold(holding: boolean, now = nowMs()): void {
  if (typeof window === 'undefined') return;
  if (holding) {
    if (!window.__RF_SUMMON_HOLDING__) {
      window.__RF_SUMMON_HOLDING__ = true;
      window.__RF_SUMMON_HOLD_SINCE__ = now;
    }
  } else if (window.__RF_SUMMON_HOLDING__ && window.__RF_SUMMON_HOLD_SINCE__ != null) {
    window.__RF_SUMMON_HOLD_MS__ =
      (window.__RF_SUMMON_HOLD_MS__ ?? 0) + (now - window.__RF_SUMMON_HOLD_SINCE__);
    window.__RF_SUMMON_HOLDING__ = false;
    window.__RF_SUMMON_HOLD_SINCE__ = undefined;
  }
  refreshSummonDiag();
}

export function getSummonElapsedMs(now = nowMs()): number {
  if (typeof window === 'undefined') return 0;
  const anchor = window.__RF_SUMMON_ANCHOR_MS__;
  if (anchor == null) return 0;
  let holdMs = window.__RF_SUMMON_HOLD_MS__ ?? 0;
  if (window.__RF_SUMMON_HOLDING__ && window.__RF_SUMMON_HOLD_SINCE__ != null) {
    holdMs += now - window.__RF_SUMMON_HOLD_SINCE__;
  }
  return Math.max(0, now - anchor - holdMs);
}

export function getSummonProgress(now = nowMs()): number {
  return Math.min(1, getSummonElapsedMs(now) / SUMMON_DURATION_MS);
}

export function getSummonDiagnostics(now = nowMs()) {
  const elapsedMs = getSummonElapsedMs(now);
  const t = Math.min(1, elapsedMs / SUMMON_DURATION_MS);
  return {
    anchorMs: typeof window !== 'undefined' ? (window.__RF_SUMMON_ANCHOR_MS__ ?? null) : null,
    elapsedMs,
    t,
    holdMs: typeof window !== 'undefined' ? (window.__RF_SUMMON_HOLD_MS__ ?? 0) : 0,
    holding: typeof window !== 'undefined' ? Boolean(window.__RF_SUMMON_HOLDING__) : false,
    durationMs: SUMMON_DURATION_MS,
  };
}

export function installSummonCaptureHooks(): void {
  if (typeof window === 'undefined') return;
  window.__RF_SUMMON_SET_HOLD__ = (hold) => setSummonHold(hold);
  /** Reset anchor only while summoning — safe for capture resync after hold. */
  window.__RF_SUMMON_RESET__ = () => {
    if (window.__RF_SUMMON_ANCHOR_MS__ == null) return;
    resetSummonAnchor(undefined, { preserveHold: Boolean(window.__RF_SUMMON_HOLDING__) });
  };
  /** Reset anchor to now and keep hold engaged — capture releases explicitly. */
  window.__RF_SUMMON_ARM__ = () => {
    const now = nowMs();
    window.__RF_SUMMON_ANCHOR_MS__ = now;
    window.__RF_SUMMON_HOLD_MS__ = 0;
    setSummonHold(true, now);
  };
  window.__RF_SUMMON_LIVE__ = () => getSummonDiagnostics();
  window.__RF_SUMMON_SEEK__ = (t: number) => {
    const anchor = window.__RF_SUMMON_ANCHOR_MS__;
    if (anchor == null) return;
    const clamped = Math.max(0, Math.min(1, t));
    const elapsed = clamped * SUMMON_DURATION_MS;
    const now = nowMs();
    window.__RF_SUMMON_HOLD_MS__ = Math.max(0, now - anchor - elapsed);
    window.__RF_SUMMON_HOLDING__ = true;
    window.__RF_SUMMON_HOLD_SINCE__ = now;
    refreshSummonDiag();
    if (typeof document !== 'undefined') {
      const root = document.querySelector<HTMLElement>('main[data-entry-phase]');
      publishSummonDiagnostics(root, clamped, {});
    }
  };
}

export function isSummonComplete(now = nowMs()): boolean {
  const elapsed = getSummonElapsedMs(now);
  const t = getSummonProgress(now);
  return t >= 1 && elapsed >= SUMMON_DURATION_MS - 1;
}

export function publishSummonDiagnostics(
  root: HTMLElement | null,
  t: number,
  extras: Record<string, string>,
): void {
  const diag = getSummonDiagnostics();
  if (typeof window !== 'undefined') {
    window.__RF_SUMMON_DIAG__ = diag;
  }
  if (!root) return;
  root.setAttribute('data-summon-t', t.toFixed(3));
  root.setAttribute(
    'data-summon-anchor-ms',
    diag.anchorMs != null ? String(Math.round(diag.anchorMs)) : '',
  );
  root.setAttribute('data-summon-elapsed-ms', String(Math.round(diag.elapsedMs)));
  root.setAttribute('data-summon-hold-ms', String(Math.round(diag.holdMs)));
  for (const [k, v] of Object.entries(extras)) {
    root.setAttribute(k, v);
  }
}
