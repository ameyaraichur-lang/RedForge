import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { PackBadge, Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { cn } from '@/lib/utils';
import { TARGETS, type TargetEntry } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Target Registry' };

const HEALTH_STATUS: Record<TargetEntry['health'], 'nominal' | 'degraded' | 'standby' | 'offline'> = {
  nominal: 'nominal',
  degraded: 'degraded',
  standby: 'standby',
  offline: 'offline',
};

function critTone(v: number): string {
  if (v >= 85) return 'bg-crit';
  if (v >= 70) return 'bg-warn';
  if (v >= 50) return 'bg-acc';
  return 'bg-ok';
}

function TargetCard({ t }: { t: TargetEntry }) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-md border bg-panel p-4 transition-colors hover:border-line-2',
        t.demo ? 'border-acc/50 shadow-glow' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-mono text-[13px] font-semibold text-slate-100">{t.name}</h3>
            {t.demo && <Badge tone="acc">demo · active</Badge>}
          </div>
          <p className="mt-0.5 text-[12px] text-mut">
            {t.cls} · <span className="font-mono text-[11px]">{t.iface}</span>
          </p>
        </div>
        <StatusChip status={HEALTH_STATUS[t.health]} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {t.packs.map((p) => (
          <PackBadge key={p} pack={p} />
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">criticality</span>
          <span className="font-mono text-[11px] tabular-nums text-slate-300">{t.criticality}/100</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-2">
          <div className={cn('h-full rounded-full', critTone(t.criticality))} style={{ width: `${t.criticality}%` }} />
        </div>
      </div>

      <p className="mt-4 border-l-2 border-warn/50 pl-3 text-[11.5px] leading-relaxed text-mut">{t.prodSafety}</p>

      <p className="mt-3 border-t border-line pt-2.5 font-mono text-[10px] text-dim">{t.id}</p>
    </div>
  );
}

export default function TargetsPage() {
  return (
    <>
      <PageHeader
        title="Target Registry"
        sub="10 target classes from the RedForge blueprint plus the active demo target. Criticality drives gate levels; prod-safety notes constrain pack execution in production."
        actions={<StatusChip status="nominal" label="9 nominal · 1 degraded · 1 standby" />}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TARGETS.map((t) => (
          <TargetCard key={t.id} t={t} />
        ))}
      </div>

      <Panel title="Registry Notes">
        <ul className="space-y-2 text-[12px] leading-relaxed text-mut">
          <li className="border-l-2 border-acc/50 pl-3">
            The demo target (demo-shop-assistant) fronts a synthetic order corpus — findings never touch real customer
            data; canary auto-reversal is armed for any payment-affecting tool call.
          </li>
          <li className="border-l-2 border-warn/50 pl-3">
            rf-gateway (criticality 95) is the rate-limit backbone: CON-003 retry-storm testing is staging-only by
            policy.
          </li>
          <li className="border-l-2 border-line pl-3">
            ft-classifier is degraded (model registry migration); MEM pack runs resume when provenance signing is
            restored.
          </li>
        </ul>
      </Panel>
    </>
  );
}
