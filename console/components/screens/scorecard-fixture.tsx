'use client';

import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SCORE_BAND, SCORE_BANDS, SCORE_DIMS, SCORE_TOTAL } from '@/lib/fixtures';

const BAND_TONE: Record<string, { chip: string; bar: string; text: string }> = {
  crit: { chip: 'border-crit/40 bg-crit/10 text-crit', bar: 'bg-crit', text: 'text-crit' },
  warn: { chip: 'border-warn/40 bg-warn/10 text-warn', bar: 'bg-warn', text: 'text-warn' },
  acc: { chip: 'border-acc/40 bg-acc/10 text-acc', bar: 'bg-acc', text: 'text-acc' },
  ok: { chip: 'border-ok/40 bg-ok/10 text-ok', bar: 'bg-ok', text: 'text-ok' },
  okb: { chip: 'border-ok/60 bg-ok/20 text-ok', bar: 'bg-ok', text: 'text-ok' },
};

function scoreTone(score: number): { chip: string; bar: string; text: string } {
  if (score < 40) return BAND_TONE.crit;
  if (score < 55) return BAND_TONE.warn;
  if (score < 70) return BAND_TONE.acc;
  return BAND_TONE.ok;
}

// ---------------------------------------------------------------------------
// Radar (pure SVG hexagon)
// ---------------------------------------------------------------------------

function Radar() {
  const cx = 170;
  const cy = 158;
  const R = 108;
  const pt = (i: number, r: number): [number, number] => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const ring = (r: number) =>
    SCORE_DIMS.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
  const scorePoly = SCORE_DIMS.map((d, i) => pt(i, (d.score / 100) * R).map((v) => v.toFixed(1)).join(',')).join(' ');

  return (
    <svg viewBox="0 0 340 320" className="w-full max-w-[380px]" role="img" aria-label="Radar of six scorecard dimensions">
      {[25, 50, 75, 100].map((v) => (
        <polygon
          key={v}
          points={ring((v / 100) * R)}
          fill="none"
          stroke={v === 100 ? 'rgba(148,163,184,0.3)' : 'rgba(148,163,184,0.14)'}
          strokeWidth={1}
        />
      ))}
      {SCORE_DIMS.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />;
      })}
      <polygon points={scorePoly} fill="rgba(34,211,238,0.14)" stroke="#22d3ee" strokeWidth={1.6} />
      {SCORE_DIMS.map((d, i) => {
        const [x, y] = pt(i, (d.score / 100) * R);
        return <circle key={d.short} cx={x} cy={y} r={2.6} fill="#22d3ee" />;
      })}
      {SCORE_DIMS.map((d, i) => {
        const [x, y] = pt(i, R + 24);
        const anchor = Math.abs(x - cx) < 10 ? 'middle' : x > cx ? 'start' : 'end';
        return (
          <text
            key={`${d.short}-label`}
            x={x}
            y={y + 3}
            textAnchor={anchor}
            className="fill-slate-400 font-mono"
            fontSize="10"
          >
            {d.short} · {d.score}
          </text>
        );
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" className="fill-dim font-mono" fontSize="9">
        0–100
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScorecardFixture() {
  return (
    <>
      <PageHeader
        title="Security Scorecard"
        sub="Six weighted dimensions scored 0–100. Weighted total is Σ (dimension score × weight) — fixture demo baseline, not an audited result."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Dimensions · weights &amp; scores">
            <ul className="space-y-5">
              {SCORE_DIMS.map((d) => {
                const tone = scoreTone(d.score);
                return (
                  <li key={d.name}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-slate-200">{d.name}</span>
                        <Badge>weight {d.weight.toFixed(2)}</Badge>
                      </span>
                      <span className="font-mono text-[12px] tabular-nums text-slate-300">
                        <span className={cn('font-semibold', tone.text)}>{d.score}</span>
                        <span className="text-dim"> · {(d.score * d.weight).toFixed(1)} pts</span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-2">
                      <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${d.score}%` }} />
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-mut">{d.note}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Band Scale">
            <ul className="divide-y divide-line/60">
              {SCORE_BANDS.map((b) => {
                const current = b.label === SCORE_BAND.label;
                const tone = BAND_TONE[b.tone];
                return (
                  <li key={b.label} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-2.5">
                      <span className={cn('h-2.5 w-2.5 rounded-sm', tone.bar)} aria-hidden />
                      <span className="font-mono text-[12px] text-slate-300">{b.range}</span>
                      <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]', tone.chip)}>
                        {b.label}
                      </span>
                      {current && <Badge tone="acc">current</Badge>}
                    </span>
                    <span className="font-mono text-[11px] text-dim">{b.level}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Weighted Total">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[44px] font-bold leading-none text-slate-100 tabular-nums">{SCORE_TOTAL}</p>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-warn">
                  band · {SCORE_BAND.label}
                </p>
                <p className="font-mono text-[11px] text-mut">{SCORE_BAND.level}</p>
              </div>
              <Badge tone="warn" className="text-[11px]">poor</Badge>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-2">
              <div className="h-full w-full rounded-full bg-gradient-to-r from-crit via-warn to-ok opacity-70" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[9px] text-dim">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
            <p className="mt-4 rounded border border-warn/30 bg-warn/5 p-2.5 font-mono text-[10px] leading-relaxed text-warn/90">
              demo baseline — scores derived from fixture findings of campaign DEMO-2026-09 only. not an audited
              result; re-score after remediation sprints S4-01..S4-04.
            </p>
          </Panel>

          <Panel title="Radar">
            <div className="flex justify-center">
              <Radar />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
