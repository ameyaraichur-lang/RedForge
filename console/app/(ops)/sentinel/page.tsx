import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusChip } from '@/components/ui/status-chip';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';
import { CI_GATE, DRIFT, PACK_META, REGRESSION_SERIES } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Sentinel' };

// ---------------------------------------------------------------------------
// Regression timeline (SVG)
// ---------------------------------------------------------------------------

const TL_W = 820;
const TL_H = 190;
const PAD_X = 70;
const PAD_TOP = 42;
const PAD_BOTTOM = 44;

function Timeline() {
  const totals = REGRESSION_SERIES.map((r) => r.total);
  const min = Math.min(...totals) - 1;
  const max = Math.max(...totals) + 1;
  const x = (i: number) => PAD_X + (i / (REGRESSION_SERIES.length - 1)) * (TL_W - PAD_X * 2);
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (TL_H - PAD_TOP - PAD_BOTTOM);
  const pts = REGRESSION_SERIES.map((r, i) => [x(i), y(r.total)] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${TL_W} ${TL_H}`} className="w-full" role="img" aria-label="Weighted score across versions">
      {/* gridlines */}
      {[40, 42.5, 45, 47.5].map((v) => (
        <g key={v}>
          <line x1={PAD_X - 10} y1={y(v)} x2={TL_W - PAD_X + 10} y2={y(v)} stroke="rgba(148,163,184,0.1)" strokeWidth={1} />
          <text x={PAD_X - 16} y={y(v) + 3} textAnchor="end" className="fill-dim font-mono" fontSize="9">
            {v}
          </text>
        </g>
      ))}
      <path d={line} fill="none" stroke="#22d3ee" strokeWidth={1.8} />
      {pts.map(([px, py], i) => {
        const r = REGRESSION_SERIES[i];
        const last = i === REGRESSION_SERIES.length - 1;
        const delta = i > 0 ? r.total - REGRESSION_SERIES[i - 1].total : null;
        return (
          <g key={r.version}>
            <circle cx={px} cy={py} r={last ? 5 : 4} fill={last ? '#22d3ee' : '#0a0e14'} stroke="#22d3ee" strokeWidth={1.5} />
            <text x={px} y={py - 12} textAnchor="middle" className={cn('font-mono', last ? 'fill-acc' : 'fill-slate-300')} fontSize="11" fontWeight={last ? 700 : 400}>
              {r.total.toFixed(1)}
            </text>
            <text x={px} y={TL_H - 22} textAnchor="middle" className="fill-slate-400 font-mono" fontSize="10">
              {r.version}
            </text>
            <text x={px} y={TL_H - 9} textAnchor="middle" className="fill-dim font-mono" fontSize="9">
              {r.date}
            </text>
            {delta !== null && (
              <text x={px} y={py + 20} textAnchor="middle" className={delta >= 0 ? 'fill-ok font-mono' : 'fill-crit font-mono'} fontSize="9">
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SentinelPage() {
  return (
    <>
      <PageHeader
        title="Sentinel"
        sub="Regression watch across scored versions, per-pack drift, and the CI quality gate that blocks releases on technique regressions."
        actions={<StatusChip status="running" label="watching v1.2.0" />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Regression Timeline · weighted score" bodyClassName="p-2">
            <Timeline />
            <ul className="grid grid-cols-1 gap-1.5 px-3 pb-2 sm:grid-cols-2 lg:grid-cols-3">
              {REGRESSION_SERIES.map((r) => (
                <li key={r.version} className="font-mono text-[10px] text-dim">
                  <span className="text-slate-300">{r.version}</span> · {r.note}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Drift Scorecard · Δ over last 5 runs" bodyClassName="p-0">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {['pack', 'name', 'Δ score', 'trend (5 runs)'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-line bg-ink-2 px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DRIFT.map((d) => (
                  <tr key={d.pack} className="border-b border-line/60 last:border-b-0 hover:bg-acc/5">
                    <td className="px-4 py-2 font-mono text-[11px] font-semibold text-slate-200">{d.pack}</td>
                    <td className="px-4 py-2 text-mut">{PACK_META[d.pack].name}</td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'font-mono text-[11px] tabular-nums',
                          d.delta > 0 ? 'text-ok' : d.delta < 0 ? 'text-crit' : 'text-dim',
                        )}
                      >
                        {d.delta > 0 ? '+' : ''}
                        {d.delta.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Sparkline data={d.trend} width={110} height={20} tone={d.delta < 0 ? '#f87171' : '#34d399'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="CI Quality Gate"
            actions={
              <StatusChip status={CI_GATE.last === 'PASS' ? 'pass' : 'fail'} label={`last gate · ${CI_GATE.last}`} />
            }
          >
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full border-2 font-mono text-[13px] font-bold',
                  CI_GATE.last === 'PASS' ? 'border-ok/60 bg-ok/10 text-ok' : 'border-crit/60 bg-crit/10 text-crit',
                )}
              >
                {CI_GATE.last}
              </span>
              <div className="space-y-1 font-mono text-[11px]">
                <p className="text-slate-200">
                  {CI_GATE.checks.passed}/{CI_GATE.checks.total} checks green
                </p>
                <p className="text-dim">commit {CI_GATE.commit} · {CI_GATE.ts}</p>
                <p className="text-dim">duration {CI_GATE.duration}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3 font-mono text-[10px] leading-relaxed">
              <p className="text-warn">
                last FAIL · {CI_GATE.prevFail.version} ({CI_GATE.prevFail.ts})
              </p>
              <p className="text-mut">regressions: {CI_GATE.prevFail.regressions.join(', ')}</p>
            </div>
            <button
              type="button"
              title="Visual stub — CI trigger wired in M6b"
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded border border-line bg-ink-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mut transition-colors hover:border-line-2 hover:text-slate-200"
            >
              <Icon name="play" className="h-3 w-3" /> re-run gate
            </button>
          </Panel>

          <Panel title="Watch Rules">
            <ul className="space-y-2 text-[12px] leading-relaxed text-mut">
              <li className="flex gap-2"><Badge tone="crit">block</Badge> any technique regression &gt; 2 pts between versions</li>
              <li className="flex gap-2"><Badge tone="warn">flag</Badge> pack drift &lt; -0.5 over 5 runs</li>
              <li className="flex gap-2"><Badge tone="acc">notify</Badge> judge disagreement rate &gt; 12%</li>
              <li className="flex gap-2"><Badge tone="ok">pass</Badge> 41/41 technique tests green on pinned targets</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
