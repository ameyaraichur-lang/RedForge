import { cn } from '@/lib/utils';
import { clamp } from '@/lib/utils';

type Tone = 'acc' | 'ok' | 'warn' | 'crit';

const BARS: Record<Tone, string> = {
  acc: 'bg-acc',
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
};

function toneFor(fraction: number): Tone {
  if (fraction >= 0.9) return 'crit';
  if (fraction >= 0.75) return 'warn';
  return 'acc';
}

interface MeterProps {
  value: number;
  max: number;
  label: string;
  display?: string;
  tone?: Tone;
  className?: string;
}

/** Horizontal usage meter with label + right-read value. */
export function Meter({ value, max, label, display, tone, className }: MeterProps) {
  const fraction = clamp(value / max, 0, 1);
  const t = tone ?? toneFor(fraction);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{label}</span>
        <span className="font-mono text-[11px] text-slate-300">
          {display ?? `${Math.round(fraction * 100)}%`}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-2"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={cn('h-full rounded-full transition-[width]', BARS[t])} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
