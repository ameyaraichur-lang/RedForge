/** Mirror shader lead/slot curves — used for onAssembled and E2E diagnostics. */

const SHELL_SAMPLES: Array<{ priority: number; delay: number }> = [
  { priority: 0.02, delay: 0.05 },
  { priority: 0.22, delay: 0.12 },
  { priority: 0.42, delay: 0.18 },
  { priority: 0.62, delay: 0.26 },
  { priority: 0.82, delay: 0.34 },
];

const CORE_SAMPLES: Array<{ priority: number; delay: number }> = [
  { priority: 0.02, delay: 0.05 },
  { priority: 0.25, delay: 0.14 },
  { priority: 0.45, delay: 0.21 },
  { priority: 0.65, delay: 0.28 },
  { priority: 0.82, delay: 0.35 },
];

function shellSlot(progress: number, priority: number, delay: number): number {
  const lead = Math.min(1, Math.max(0, (progress - priority * 0.1) / 0.75));
  const w = 0.52;
  return Math.min(1, Math.max(0, (lead - delay * (1 - w)) / w));
}

function coreSlot(progress: number, priority: number, delay: number): number {
  const lead = Math.min(1, Math.max(0, (progress - priority * 0.08) / 0.72));
  const w = 0.5;
  return Math.min(1, Math.max(0, (lead - delay * (1 - w)) / w));
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
  for (let p = 0.28; p <= 0.45; p += 0.01) {
    if (assemblyConvergence(p) >= 0.38) return Math.round(p * 100) / 100;
  }
  return 0.36;
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
