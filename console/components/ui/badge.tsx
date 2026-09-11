import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Pack } from '@/lib/fixtures';

const PACK_TONES: Record<Pack, string> = {
  PIN: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  EXF: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  OUT: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  AGE: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  MEM: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  CON: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  HAL: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300',
  SUP: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
};

const TONES = {
  default: 'border-line bg-ink-2 text-mut',
  acc: 'border-acc/30 bg-acc/10 text-acc',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  crit: 'border-crit/30 bg-crit/10 text-crit',
};

export type BadgeTone = keyof typeof TONES;

/** Small uppercase mono chip. */
export function Badge({
  children,
  tone = 'default',
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Pack-colored badge (PIN/EXF/...). */
export function PackBadge({ pack, className }: { pack: Pack; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]',
        PACK_TONES[pack],
        className,
      )}
    >
      {pack}
    </span>
  );
}

/** Severity-colored badge. */
export function SeverityBadge({ severity }: { severity: 'Critical' | 'High' | 'Medium' | 'Low' }) {
  const tone: BadgeTone =
    severity === 'Critical' ? 'crit' : severity === 'High' ? 'warn' : severity === 'Medium' ? 'acc' : 'default';
  return <Badge tone={tone}>{severity}</Badge>;
}
