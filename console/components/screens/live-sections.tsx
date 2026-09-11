'use client';

// Live sections for Gates / Findings / Scorecard (M6b): each renders live API
// data when connected and a campaign has run, otherwise falls back to the M6a
// fixture screen. One file, three exports — pages stay thin.

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { cn } from '@/lib/utils';
import { useLive, type LiveFinding, type LiveGate } from '@/lib/live';
import { GatesConsole } from '@/components/screens/gates-console';
import { FindingsExplorer } from '@/components/screens/findings-explorer';
import ScorecardFixture from '@/components/screens/scorecard-fixture';

// ---------------------------------------------------------------- Gates

const SEV_CHIP: Record<string, import('@/components/ui/status-chip').ChipStatus> = {
  Critical: 'killed', High: 'warning', Medium: 'open', Low: 'standby', Info: 'standby',
};
const STATUS_CHIP: Record<string, import('@/components/ui/status-chip').ChipStatus> = {
  Confirmed: 'confirmed', Candidate: 'open', Voided: 'standby',
};

export function GatesScreen() {
  const { connected, status, refreshGates, signGate } = useLive();
  const [gates, setGates] = useState<LiveGate[]>([]);
  const running = status?.running ?? false;

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = async () => {
      const g = await refreshGates();
      if (alive) setGates(g);
    };
    void load();
    const id = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [connected, running, refreshGates, status?.events]);

  if (!connected || gates.length === 0) return <GatesConsole />;

  return (
    <>
      <PageHeader
        title="Gatekeeper Console · LIVE"
        sub={`${gates.length} gate requests from ${status?.campaign_id ?? 'campaign'} · auto-approved by demo two-person rule (operator + red lead) · countersign below`}
      />
      <div className="space-y-4">
        {gates.map((g) => (
          <Panel key={g.id} title={`${g.id} · ${g.kind}`}
            actions={<StatusChip status={g.decided ? 'confirmed' : 'warning'} label={g.decided ? 'decided' : 'awaiting signatures'} />}>
            <div className="space-y-3">
              <p className="font-mono text-[11px] leading-relaxed text-mut">{g.justification || 'sensitive technique under ROAI scope'}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.technique_ids.map((t) => <Badge key={t} tone="crit">{t}</Badge>)}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">signatures</span>
                {g.approvals.length === 0 && <span className="font-mono text-[11px] text-dim">none</span>}
                {g.approvals.map((a) => (
                  <span key={a} className="rounded border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[10px] text-ok">{a}</span>
                ))}
                <div className="ml-auto flex gap-2">
                  <button type="button" onClick={() => void signGate(g.id, 'console-operator')}
                    className="rounded border border-line bg-ink-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mut hover:border-acc/50 hover:text-acc">
                    sign · operator
                  </button>
                  <button type="button" onClick={() => void signGate(g.id, 'console-red-lead')}
                    className="rounded border border-line bg-ink-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mut hover:border-acc/50 hover:text-acc">
                    sign · red lead
                  </button>
                </div>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Findings

export function FindingsScreen() {
  const { connected, status, refreshFindings } = useLive();
  const [findings, setFindings] = useState<LiveFinding[]>([]);
  const total = status?.findings_total ?? 0;

  useEffect(() => {
    if (!connected || total === 0) return;
    let alive = true;
    void refreshFindings().then((f) => {
      if (alive) setFindings(f);
    });
    return () => {
      alive = false;
    };
  }, [connected, total, refreshFindings]);

  if (!connected || findings.length === 0) return <FindingsExplorer />;

  return (
    <>
      <PageHeader
        title="Findings Explorer · LIVE"
        sub={`${findings.length} findings from ${status?.campaign_id ?? 'campaign'} · ${status?.findings_confirmed ?? 0} confirmed · every row carries transcript + verdict evidence`}
      />
      <Panel title="Confirmed register" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                <th className="px-4 py-2.5">id</th>
                <th className="px-4 py-2.5">technique</th>
                <th className="px-4 py-2.5">title</th>
                <th className="px-4 py-2.5">severity</th>
                <th className="px-4 py-2.5">status</th>
                <th className="px-4 py-2.5">conf</th>
                <th className="px-4 py-2.5">evidence</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id} className="border-b border-line/50 hover:bg-acc/5">
                  <td className="px-4 py-2 font-mono text-[11px] text-acc">{f.id}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-300">{f.technique_id}</td>
                  <td className="max-w-[280px] truncate px-4 py-2 text-[12px] text-slate-200">{f.title}</td>
                  <td className="px-4 py-2"><StatusChip status={SEV_CHIP[f.severity] ?? 'open'} label={f.severity} /></td>
                  <td className="px-4 py-2"><StatusChip status={STATUS_CHIP[f.status] ?? 'open'} label={f.status} /></td>
                  <td className="px-4 py-2 font-mono text-[11px] tabular-nums text-slate-300">{f.confidence.toFixed(2)}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-dim">
                    {f.evidence.map((e) => e.kind).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ------------------------------------------------------------ Scorecard

const DIM_SHORT: Record<string, string> = {
  'Injection Resistance': 'inj',
  'Data Protection': 'data',
  'Agency & Tool Control': 'agen',
  'Output Safety': 'out',
  'Availability & Cost Resilience': 'res',
  'Regulatory Evidence Readiness': 'reg',
};

export function ScorecardScreen() {
  const { connected, status } = useLive();
  const sc = status?.scorecard ?? null;

  if (!connected || !sc || !sc.contributions) return <ScorecardFixture />;

  const tone = (v: number) =>
    v < 40 ? 'bg-crit' : v < 60 ? 'bg-warn' : v < 75 ? 'bg-acc' : 'bg-ok';

  return (
    <>
      <PageHeader
        title="Security Scorecard · LIVE"
        sub={`derived by policy engine (OPA path) from ${status?.findings_total ?? 0} findings · campaign ${status?.campaign_id ?? '—'}`}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Dimensions · live">
          <ul className="space-y-5">
            {Object.entries(sc.contributions).map(([name, pts]) => {
              const actual = sc.actuals?.[name];
              const v = actual ?? pts;
              return (
                <li key={name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-slate-200">{name}</span>
                    <span className="font-mono text-[12px] tabular-nums text-slate-300">
                      <span className={cn('font-semibold', v < 40 ? 'text-crit' : v < 60 ? 'text-warn' : 'text-ok')}>{v.toFixed(0)}</span>
                      <span className="text-dim"> · {pts.toFixed(1)} pts</span>
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-2">
                    <div className={cn('h-full rounded-full', tone(v))} style={{ width: `${Math.min(100, v)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Weighted Total">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[44px] font-bold leading-none text-slate-100 tabular-nums">{sc.total}</p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-warn">band · {sc.band}</p>
              {sc.maturity && <p className="font-mono text-[11px] text-mut">{sc.maturity}</p>}
            </div>
            <Badge tone={sc.total < 40 ? 'crit' : sc.total < 60 ? 'warn' : 'ok'} className="text-[11px]">{sc.band.toLowerCase()}</Badge>
          </div>
          <p className="mt-4 rounded border border-acc/30 bg-acc/5 p-2.5 font-mono text-[10px] leading-relaxed text-acc/90">
            live result — feeds the EU AI Act Art 15 dossier. regenerate the report from mission control to export.
          </p>
        </Panel>
      </div>
    </>
  );
}
