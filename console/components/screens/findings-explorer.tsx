'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Panel } from '@/components/ui/panel';
import { Drawer } from '@/components/ui/drawer';
import { Badge, PackBadge, SeverityBadge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { KV } from '@/components/ui/kv';
import { Icon } from '@/components/icon';
import { cn, pct } from '@/lib/utils';
import {
  FINDINGS,
  PACK_ORDER,
  TECHNIQUES,
  type Finding,
  type FindingStatus,
  type Pack,
  type Severity,
} from '@/lib/fixtures';

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  children,
  tone = 'acc',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'acc' | 'warn' | 'crit' | 'ok';
}) {
  const activeTone = {
    acc: 'border-acc/60 bg-acc/15 text-acc',
    warn: 'border-warn/60 bg-warn/15 text-warn',
    crit: 'border-crit/60 bg-crit/15 text-crit',
    ok: 'border-ok/60 bg-ok/15 text-ok',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
        active ? activeTone : 'border-line bg-ink-2 text-mut hover:border-line-2 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

// ---------------------------------------------------------------------------
// Confidence mini-bar
// ---------------------------------------------------------------------------

function ConfBar({ value }: { value: number }) {
  const tone = value >= 0.85 ? 'bg-ok' : value >= 0.7 ? 'bg-acc' : value >= 0.5 ? 'bg-warn' : 'bg-dim';
  return (
    <span className="inline-flex items-center gap-2" title={`combined confidence ${pct(value)}`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-ink-2">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${value * 100}%` }} />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-slate-300">{pct(value, 0)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drawer contents
// ---------------------------------------------------------------------------

const EVIDENCE_TONE: Record<string, string> = {
  transcript: 'text-acc border-acc/30 bg-acc/10',
  verdict: 'text-violet-300 border-violet-400/30 bg-violet-400/10',
  artifact: 'text-ok border-ok/30 bg-ok/10',
  metric: 'text-warn border-warn/30 bg-warn/10',
};

function FindingDrawerBody({ finding }: { finding: Finding }) {
  const technique = TECHNIQUES.find((t) => t.id === finding.technique);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <StatusChip status={finding.status.toLowerCase() as 'confirmed' | 'candidate' | 'voided'} />
        <PackBadge pack={finding.pack} />
        {finding.judge.escalated && <Badge tone="crit">escalated</Badge>}
      </div>

      <section>
        <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">narrative</h3>
        <p className="text-[13px] leading-relaxed text-slate-300">{finding.narrative}</p>
      </section>

      <section className="rounded border border-line bg-ink-2 p-3">
        <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
          judge verdict · combined {pct(finding.judge.combined)}
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] text-slate-200">rule detector</span>
              <span className="font-mono text-[10px] text-mut">{finding.judge.rule.detector}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-panel">
                <span className="block h-full rounded-full bg-acc" style={{ width: `${finding.judge.rule.score * 100}%` }} />
              </span>
              <span className="font-mono text-[10px] text-mut">score {pct(finding.judge.rule.score)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {finding.judge.rule.signals.map((s) => (
                <Badge key={s} tone="acc">{s}</Badge>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] text-slate-200">llm judge</span>
              <span className="font-mono text-[10px] text-mut">{finding.judge.llm.model}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={finding.judge.llm.verdict === 'attack-consistent' ? 'crit' : finding.judge.llm.verdict === 'benign' ? 'ok' : 'warn'}>
                {finding.judge.llm.verdict}
              </Badge>
              <span className="font-mono text-[10px] text-mut">confidence {pct(finding.judge.llm.confidence)}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-mut">{finding.judge.llm.rationale}</p>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-3 font-mono text-[11px]">
            <span className="text-dim">combined score</span>
            <span className="text-slate-100">{pct(finding.judge.combined)}</span>
          </div>
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-dim">escalated</span>
            <span className={finding.judge.escalated ? 'text-crit' : 'text-dim'}>{finding.judge.escalated ? 'yes · 2-sig notify' : 'no'}</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">evidence</h3>
        <ul className="space-y-1.5">
          {finding.evidence.map((e) => (
            <li key={e.ref} className="flex items-center gap-2.5">
              <span
                className={cn(
                  'w-[76px] shrink-0 rounded border px-1.5 py-0.5 text-center font-mono text-[9px] uppercase tracking-[0.1em]',
                  EVIDENCE_TONE[e.kind],
                )}
              >
                {e.kind}
              </span>
              <code className="min-w-0 truncate font-mono text-[11px] text-slate-300">{e.ref}</code>
            </li>
          ))}
        </ul>
      </section>

      {finding.killChain && (
        <section>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">kill chain</h3>
          <ol className="flex flex-wrap items-center gap-1.5">
            {finding.killChain.map((k, i) => (
              <li key={k.step} className="flex items-center gap-1.5">
                {i > 0 && <Icon name="arrow-right" className="h-3 w-3 text-dim" />}
                <StatusChip status={k.status} label={k.step} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="border-t border-line pt-4">
        <KV
          rows={[
            ['technique', <span key="t" className="text-slate-200">{finding.technique} · {technique?.name}</span>],
            ['target', finding.target],
            ['round', `R${finding.round}`],
            ['observed', finding.ts],
          ]}
        />
      </section>

      <div className="flex gap-2 border-t border-line pt-4">
        <button
          type="button"
          title="Visual stub — wired in M6b"
          className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-mut transition-colors hover:border-line-2 hover:text-slate-200"
        >
          <Icon name="external" className="h-3 w-3" /> open transcript
        </button>
        <button
          type="button"
          title="Visual stub — wired in M6b"
          className="inline-flex items-center gap-1.5 rounded border border-line bg-ink-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-mut transition-colors hover:border-line-2 hover:text-slate-200"
        >
          <Icon name="download" className="h-3 w-3" /> export json
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

export function FindingsExplorer() {
  const [packs, setPacks] = useState<Set<Pack>>(new Set());
  const [sevs, setSevs] = useState<Set<Severity>>(new Set());
  const [statuses, setStatuses] = useState<Set<FindingStatus>>(new Set());
  const [selected, setSelected] = useState<Finding | null>(null);

  const filtered = useMemo(
    () =>
      FINDINGS.filter(
        (f) =>
          (packs.size === 0 || packs.has(f.pack)) &&
          (sevs.size === 0 || sevs.has(f.severity)) &&
          (statuses.size === 0 || statuses.has(f.status)),
      ),
    [packs, sevs, statuses],
  );

  const columns: Column<Finding>[] = [
    {
      key: 'id',
      header: 'id',
      width: '100px',
      render: (f) => <span className="font-mono text-acc">{f.id}</span>,
    },
    {
      key: 'technique',
      header: 'technique',
      value: (f) => f.technique,
      render: (f) => (
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-slate-200">{f.technique}</span>
          <span className="hidden truncate text-[12px] text-mut 2xl:inline">
            {TECHNIQUES.find((t) => t.id === f.technique)?.name}
          </span>
        </span>
      ),
    },
    { key: 'pack', header: 'pack', value: (f) => f.pack, render: (f) => <PackBadge pack={f.pack} /> },
    { key: 'severity', header: 'severity', value: (f) => ['Critical', 'High', 'Medium', 'Low'].indexOf(f.severity), render: (f) => <SeverityBadge severity={f.severity} /> },
    { key: 'status', header: 'status', render: (f) => <StatusChip status={f.status.toLowerCase() as 'confirmed' | 'candidate' | 'voided'} /> },
    { key: 'confidence', header: 'confidence', align: 'right', value: (f) => f.confidence, render: (f) => <ConfBar value={f.confidence} /> },
    { key: 'target', header: 'target', render: (f) => <span className="font-mono text-[11px] text-mut">{f.target}</span> },
    { key: 'round', header: 'rnd', align: 'center', width: '52px', render: (f) => <span className="font-mono text-[11px] text-dim">R{f.round}</span> },
  ];

  const counts = {
    confirmed: FINDINGS.filter((f) => f.status === 'Confirmed').length,
    candidate: FINDINGS.filter((f) => f.status === 'Candidate').length,
    voided: FINDINGS.filter((f) => f.status === 'Voided').length,
  };

  return (
    <>
      <PageHeader
        title="Findings Explorer"
        sub="Adjudicated results across all packs. Click a row for narrative, judge breakdown, evidence chain and kill-chain."
        actions={
          <span className="font-mono text-[11px] text-mut">
            {FINDINGS.length} findings · <span className="text-ok">{counts.confirmed} confirmed</span> ·{' '}
            <span className="text-warn">{counts.candidate} candidate</span> ·{' '}
            <span className="text-dim">{counts.voided} voided</span>
          </span>
        }
      />

      <Panel
        title="Filters"
        actions={
          packs.size + sevs.size + statuses.size > 0 ? (
            <button
              type="button"
              onClick={() => {
                setPacks(new Set());
                setSevs(new Set());
                setStatuses(new Set());
              }}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim transition-colors hover:text-slate-200"
            >
              clear all
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">pack</span>
            {PACK_ORDER.map((p) => (
              <FilterChip key={p} active={packs.has(p)} onClick={() => setPacks((s) => toggle(s, p))}>
                {p}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">severity</span>
            {(['Critical', 'High', 'Medium', 'Low'] as Severity[]).map((s) => (
              <FilterChip
                key={s}
                tone="crit"
                active={sevs.has(s)}
                onClick={() => setSevs((set) => toggle(set, s))}
              >
                {s}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">status</span>
            {(['Confirmed', 'Candidate', 'Voided'] as FindingStatus[]).map((s) => (
              <FilterChip
                key={s}
                tone="ok"
                active={statuses.has(s)}
                onClick={() => setStatuses((set) => toggle(set, s))}
              >
                {s}
              </FilterChip>
            ))}
          </div>
        </div>
      </Panel>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(f) => f.id}
        onRowClick={setSelected}
        initialSort={{ key: 'severity', dir: 'asc' }}
        maxHeight="max-h-[620px]"
      />

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? selected.id : ''}>
        {selected && <FindingDrawerBody finding={selected} />}
      </Drawer>
    </>
  );
}
