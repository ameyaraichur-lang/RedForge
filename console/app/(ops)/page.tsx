import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Sparkline } from '@/components/ui/sparkline';
import { Meter } from '@/components/ui/meter';
import { StatusChip, type ChipStatus } from '@/components/ui/status-chip';
import { cn } from '@/lib/utils';
import { fmtCompact } from '@/lib/utils';
import {
  BUDGET,
  CAMPAIGN,
  KPIS,
  RECENT_EVENTS,
  SWARM,
  type EventItem,
  type Kpi,
  type SwarmAgent,
} from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Command Center' };

const KPI_TONE_TEXT: Record<Kpi['tone'], string> = {
  acc: 'text-acc',
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
};
const KPI_TONE_STROKE: Record<Kpi['tone'], string> = {
  acc: '#22d3ee',
  ok: '#34d399',
  warn: '#fbbf24',
  crit: '#f87171',
};

function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <div className="rounded-md border border-line bg-panel p-4 transition-colors hover:border-line-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">{kpi.label}</p>
          <p className={cn('mt-2 font-mono text-[28px] font-semibold leading-none tracking-tight', KPI_TONE_TEXT[kpi.tone])}>
            {kpi.value}
          </p>
          <p className="mt-2 font-mono text-[11px] text-mut">{kpi.sub}</p>
        </div>
        <Sparkline data={kpi.trend} width={80} height={30} tone={KPI_TONE_STROKE[kpi.tone]} className="mt-1" />
      </div>
    </div>
  );
}

const AGENT_STATUS: Record<SwarmAgent['status'], ChipStatus> = {
  running: 'running',
  idle: 'idle',
  warning: 'warning',
  standby: 'standby',
};

function SwarmRow({ agent }: { agent: SwarmAgent }) {
  return (
    <li className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-b-0 hover:bg-acc/5">
      <StatusChip status={AGENT_STATUS[agent.status]} label={agent.status} className="w-[84px] justify-center" />
      <span className="w-24 shrink-0 font-mono text-[12px] font-medium text-slate-200">{agent.id}</span>
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-dim sm:block sm:w-16">
        {agent.role}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-mut">{agent.task}</span>
      <Sparkline data={agent.load} width={72} height={18} tone="#64748b" className="shrink-0" />
    </li>
  );
}

const EVENT_DOT: Record<EventItem['level'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-acc',
};

export default function CommandCenterPage() {
  return (
    <>
      <PageHeader
        title="Command Center"
        sub={`Campaign ${CAMPAIGN.id} · round ${CAMPAIGN.round} · target ${CAMPAIGN.target} · started ${CAMPAIGN.started}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => (
          <KpiTile key={k.label} kpi={k} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          title="Swarm Health · 14 agents"
          className="xl:col-span-2"
          bodyClassName="p-0"
          actions={<StatusChip status="running" label="10 running" />}
        >
          <ul>
            {SWARM.map((a) => (
              <SwarmRow key={a.id} agent={a} />
            ))}
          </ul>
        </Panel>

        <div className="space-y-6">
          <Panel title="Budget">
            <div className="space-y-5">
              {BUDGET.map((b) => (
                <Meter
                  key={b.label}
                  label={b.label}
                  value={b.used}
                  max={b.cap}
                  display={
                    b.unit === 'usd'
                      ? `$${b.used.toFixed(2)} / $${b.cap.toFixed(2)}`
                      : b.unit === 'tokens'
                        ? `${fmtCompact(b.used)} / ${fmtCompact(b.cap)}`
                        : `${b.used} / ${b.cap}`
                  }
                />
              ))}
              <p className="border-t border-line pt-3 font-mono text-[10px] text-dim">
                caps enforced by redforge-opa · raises require G2 two-signature
              </p>
            </div>
          </Panel>

          <Panel title="Mission State">
            <div className="space-y-2 font-mono text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-dim">state</span>
                <StatusChip status="running" label="running · R3" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dim">attack window</span>
                <span className="text-slate-300">10:00–12:00Z</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dim">operator concurrency</span>
                <span className="text-slate-300">3 of 6</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dim">canary rollback</span>
                <StatusChip status="confirmed" label="armed" />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Recent Events" bodyClassName="p-0" actions={<span className="font-mono text-[10px] text-dim">last 60 min</span>}>
        <ul className="divide-y divide-line/60">
          {RECENT_EVENTS.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-acc/5">
              <span className="w-20 shrink-0 font-mono text-[11px] tabular-nums text-dim">{e.ts}</span>
              <span className={cn('mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full', EVENT_DOT[e.level])} aria-hidden />
              <span className="text-[12px] text-slate-300">{e.text}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
