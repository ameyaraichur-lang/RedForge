import { cn } from '@/lib/utils';

export type ChipStatus =
  | 'confirmed'
  | 'candidate'
  | 'voided'
  | 'done'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'pass'
  | 'fail'
  | 'running'
  | 'idle'
  | 'standby'
  | 'warning'
  | 'online'
  | 'degraded'
  | 'offline'
  | 'nominal'
  | 'complete'
  | 'active'
  | 'blocked'
  | 'detected'
  | 'killed'
  | 'open';

const TONES: Record<ChipStatus, string> = {
  // green
  confirmed: 'border-ok/40 bg-ok/10 text-ok',
  done: 'border-ok/40 bg-ok/10 text-ok',
  approved: 'border-ok/40 bg-ok/10 text-ok',
  pass: 'border-ok/40 bg-ok/10 text-ok',
  online: 'border-ok/40 bg-ok/10 text-ok',
  nominal: 'border-ok/40 bg-ok/10 text-ok',
  complete: 'border-ok/40 bg-ok/10 text-ok',
  running: 'border-acc/40 bg-acc/10 text-acc',
  active: 'border-acc/40 bg-acc/10 text-acc',
  // amber
  candidate: 'border-warn/40 bg-warn/10 text-warn',
  pending: 'border-warn/40 bg-warn/10 text-warn',
  warning: 'border-warn/40 bg-warn/10 text-warn',
  degraded: 'border-warn/40 bg-warn/10 text-warn',
  standby: 'border-warn/40 bg-warn/10 text-warn',
  detected: 'border-warn/40 bg-warn/10 text-warn',
  open: 'border-warn/40 bg-warn/10 text-warn',
  // red
  rejected: 'border-crit/40 bg-crit/10 text-crit',
  fail: 'border-crit/40 bg-crit/10 text-crit',
  killed: 'border-crit/40 bg-crit/10 text-crit',
  blocked: 'border-crit/40 bg-crit/10 text-crit',
  offline: 'border-crit/40 bg-crit/10 text-crit',
  // gray
  voided: 'border-line-2 bg-ink-2 text-dim',
  idle: 'border-line-2 bg-ink-2 text-dim',
};

const PULSING: ChipStatus[] = ['running', 'active'];

export function StatusChip({ status, label, className }: { status: ChipStatus; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] whitespace-nowrap',
        TONES[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full bg-current',
          PULSING.includes(status) && 'animate-pulse-dot',
        )}
      />
      {label ?? status}
    </span>
  );
}
