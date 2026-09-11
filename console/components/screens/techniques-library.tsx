'use client';

import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { PackBadge, Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { GATE_LEVELS, PACK_META, PACK_ORDER, TECHNIQUES, type Technique } from '@/lib/fixtures';

const GATE_TONE: Record<0 | 1 | 2, 'ok' | 'acc' | 'crit'> = { 0: 'ok', 1: 'acc', 2: 'crit' };

const columns: Column<Technique>[] = [
  { key: 'id', header: 'id', width: '88px', render: (t) => <span className="font-mono text-acc">{t.id}</span> },
  { key: 'name', header: 'name', render: (t) => <span className="text-slate-200">{t.name}</span> },
  { key: 'owasp', header: 'owasp ref', render: (t) => <span className="font-mono text-[11px] text-mut">{t.owasp}</span> },
  {
    key: 'gate',
    header: 'gate',
    value: (t) => t.gate,
    render: (t) => (
      <Badge tone={GATE_TONE[t.gate]} title={GATE_LEVELS[t.gate].label}>
        {GATE_LEVELS[t.gate].short}
      </Badge>
    ),
  },
  {
    key: 'seed',
    header: 'seed payload',
    sortable: false,
    render: (t) => (
      <code className="block max-w-md truncate font-mono text-[11px] text-mut" title={t.seed}>
        &ldquo;{t.seed}&rdquo;
      </code>
    ),
  },
  {
    key: 'lineage',
    header: 'lineage',
    sortable: false,
    render: () => <span className="font-mono text-[10px] text-dim">base · m7</span>,
  },
];

export function TechniquesLibrary() {
  return (
    <>
      <PageHeader
        title="Technique Library"
        sub="40 canonical techniques across 8 packs. Gate level encodes required autonomy: G0 autonomous, G1 ROAI scope check, G2 two-signature. Mutation lineage editing lands in M7."
        actions={<span className="font-mono text-[11px] text-mut">{TECHNIQUES.length} techniques · 8 packs</span>}
      />

      <div className="space-y-6">
        {PACK_ORDER.map((pack) => {
          const rows = TECHNIQUES.filter((t) => t.pack === pack);
          return (
            <Panel
              key={pack}
              title={`${pack} · ${PACK_META[pack].name} (${rows.length})`}
              bodyClassName="p-4"
              actions={<PackBadge pack={pack} />}
            >
              <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} />
            </Panel>
          );
        })}

        <Panel title="Mutation Lineage">
          <div className="flex items-start gap-3 rounded border border-dashed border-line-2 bg-ink-2/50 p-4">
            <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">m7 placeholder</span>
            <p className="text-[12px] leading-relaxed text-mut">
              Every technique will carry a lineage graph (seed → mutation → variant) with per-variant success rates
              and detector coverage. Until then, all rows are canonical base seeds; the lineage column reads{' '}
              <code className="font-mono text-[11px] text-dim">base</code>.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
