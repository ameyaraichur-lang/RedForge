/** Mirror shader lead/slot curves — used for onAssembled and E2E diagnostics. */

/**
 * Per-particle flight time as a fraction of the beat. Must match SHELL_FLIGHT
 * and CORE_FLIGHT in orchestrator-head.tsx.
 */
const SHELL_FLIGHT = 0.34;
const CORE_FLIGHT = 0.28;

/**
 * Arrival orders sampled across the ORDER windows in orchestrator-head.tsx:
 * silhouette sweep first, fill inward, amber face late, hot details last.
 */
const SHELL_SAMPLES: Array<{ priority: number; delay: number }> = [
  { priority: 0.06, delay: 0.35 },
  { priority: 0.26, delay: 0.62 },
  { priority: 0.43, delay: 0.2 },
  { priority: 0.6, delay: 0.78 },
  { priority: 0.72, delay: 0.42 },
  { priority: 0.82, delay: 0.15 },
  { priority: 0.89, delay: 0.58 },
];

const CORE_SAMPLES: Array<{ priority: number; delay: number }> = [
  { priority: 0.7, delay: 0.3 },
  { priority: 0.8, delay: 0.55 },
  { priority: 0.88, delay: 0.18 },
  { priority: 0.93, delay: 0.7 },
  { priority: 0.98, delay: 0.45 },
];

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function shellSlot(progress: number, priority: number, delay: number): number {
  const stagger = clamp01(priority + (delay - 0.5) * 0.09);
  return clamp01((progress - stagger * (1 - SHELL_FLIGHT)) / SHELL_FLIGHT);
}

function coreSlot(progress: number, priority: number, delay: number): number {
  const stagger = clamp01(priority + (delay - 0.5) * 0.07);
  return clamp01((progress - stagger * (1 - CORE_FLIGHT)) / CORE_FLIGHT);
}

function meanSlot(
  progress: number,
  samples: Array<{ priority: number; delay: number }>,
  slotFn: (p: number, pri: number, d: number) => number,
): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += slotFn(progress, s.priority, s.delay);
  return sum / samples.length;
}

/** 0–1 mean particle slot fill matching GPU shader curves. */
export function assemblyConvergence(progress: number): number {
  const shell = meanSlot(progress, SHELL_SAMPLES, shellSlot);
  const core = meanSlot(progress, CORE_SAMPLES, coreSlot);
  return shell * 0.55 + core * 0.45;
}

/** Progress where crown/face bands reach partial slot fill (~readable silhouette). */
export function profileReadableProgress(): number {
  for (let p = 0.28; p <= 0.6; p += 0.01) {
    if (assemblyConvergence(p) >= 0.38) return Math.round(p * 100) / 100;
  }
  return 0.5;
}

export type GpuAssemblyState = {
  progress: number;
  shellProgress: number;
  coreProgress: number;
  listen: number;
  energy: number;
  fade: number;
  convergence: number;
  /** Wall-clock ms since assembly rising edge, minus capture hold pauses. */
  assemblyElapsedMs: number;
};
