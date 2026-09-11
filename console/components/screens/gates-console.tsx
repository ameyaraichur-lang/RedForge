'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';
import { APPROVAL_LOG, GATE_REQUESTS, type ApprovalLogRow, type GateRequest } from '@/lib/fixtures';

const KIND_TONE: Record<GateRequest['kind'], string> = {
  prod_attack: 'border-crit/40 bg-crit/10 text-crit',
  budget_raise: 'border-warn/40 bg-warn/10 text-warn',
  tool_action: 'border-acc/40 bg-acc/10 text-acc',
};

const SIGNERS = {
  sig1: { name: 'R. Vale', role: 'Ops Officer' },
  sig2: { name: 'M. Ito', role: 'Compliance' },
};

interface RequestState {
  sig1: boolean;
  sig2: boolean;
  approved: boolean;
}

function SignButton({
  signed,
  onClick,
  name,
  role,
  disabled,
}: {
  signed: boolean;
  onClick: () => void;
  name: string;
  role: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={signed || disabled}
      className={cn(
        'flex flex-1 items-center gap-2.5 rounded border px-3 py-2.5 text-left transition-colors',
        signed
          ? 'border-ok/50 bg-ok/10'
          : disabled
            ? 'cursor-not-allowed border-line bg-ink-2 opacity-50'
            : 'border-line bg-ink-2 hover:border-acc/60 hover:bg-acc/10',
      )}
    >
      <Icon name={signed ? 'check' : 'signature'} className={signed ? 'text-ok' : 'text-mut'} />
      <span className="min-w-0">
        <span className={cn('block font-mono text-[11px] font-semibold', signed ? 'text-ok' : 'text-slate-200')}>
          {signed ? `signed · ${name}` : `sign · ${name}`}
        </span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-dim">{role}</span>
      </span>
    </button>
  );
}

function GateRequestCard({ req }: { req: GateRequest }) {
  const [state, setState] = useState<RequestState>({ sig1: false, sig2: false, approved: false });
  const bothSigned = state.sig1 && state.sig2;

  return (
    <Panel
      title={`${req.id} · ${req.kind}`}
      actions={
        state.approved ? (
          <StatusChip status="approved" label="approved" />
        ) : (
          <StatusChip status="pending" label="awaiting 2-sig" />
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]', KIND_TONE[req.kind])}>
            {req.kind}
          </span>
          <span className="text-[13px] font-medium text-slate-200">{req.title}</span>
        </div>

        <p className="font-mono text-[11px] text-dim">
          requested by {req.requestedBy} · {req.ts}
        </p>

        <ul className="space-y-1.5">
          {req.detail.map((d) => (
            <li key={d} className="flex gap-2 text-[12px] leading-relaxed text-mut">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-dim" aria-hidden />
              {d}
            </li>
          ))}
        </ul>

        {req.techniques && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">techniques</span>
            {req.techniques.map((t) => (
              <Badge key={t} tone="crit">{t}</Badge>
            ))}
          </div>
        )}

        <div className="rounded border border-line bg-ink-2 p-3">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            roai scope check
          </h4>
          <ul className="space-y-1.5">
            {req.roai.map((r) => (
              <li key={r.label} className="flex items-baseline gap-2.5">
                <Icon
                  name={r.pass ? 'check' : 'x'}
                  className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', r.pass ? 'text-ok' : 'text-crit')}
                />
                <span className="text-[12px] text-slate-300">{r.label}</span>
                <span className="ml-auto hidden truncate pl-2 font-mono text-[10px] text-dim md:block">{r.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <SignButton
            signed={state.sig1}
            disabled={state.approved}
            name={SIGNERS.sig1.name}
            role={SIGNERS.sig1.role}
            onClick={() => setState((s) => ({ ...s, sig1: true }))}
          />
          <SignButton
            signed={state.sig2}
            disabled={state.approved}
            name={SIGNERS.sig2.name}
            role={SIGNERS.sig2.role}
            onClick={() => setState((s) => ({ ...s, sig2: true }))}
          />
        </div>

        <button
          type="button"
          disabled={!bothSigned || state.approved}
          onClick={() => setState((s) => ({ ...s, approved: true }))}
          className={cn(
            'w-full rounded border px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors',
            state.approved
              ? 'cursor-default border-ok/50 bg-ok/10 text-ok'
              : bothSigned
                ? 'border-ok/60 bg-ok/15 text-ok hover:bg-ok/25'
                : 'cursor-not-allowed border-line bg-ink-2 text-dim',
          )}
        >
          {state.approved ? `approved · ${req.id} released to executor` : 'approve request (2 of 2 signatures)'}
        </button>
      </div>
    </Panel>
  );
}

export function GatesConsole() {
  const [extraLog, setExtraLog] = useState<ApprovalLogRow[]>([]);

  const columns: Column<ApprovalLogRow>[] = [
    { key: 'id', header: 'id', render: (r) => <span className="font-mono text-acc">{r.id}</span> },
    { key: 'kind', header: 'kind', render: (r) => <Badge tone={r.kind === 'prod_attack' ? 'crit' : r.kind === 'budget_raise' ? 'warn' : 'acc'}>{r.kind}</Badge> },
    { key: 'decision', header: 'decision', render: (r) => <StatusChip status={r.decision === 'Approved' ? 'approved' : r.decision === 'Rejected' ? 'rejected' : 'voided'} label={r.decision} /> },
    { key: 'sig1', header: 'signature 1', render: (r) => <span className="font-mono text-[11px] text-slate-300">{r.sig1}</span> },
    { key: 'sig2', header: 'signature 2', render: (r) => <span className="font-mono text-[11px] text-slate-300">{r.sig2}</span> },
    { key: 'ts', header: 'timestamp', align: 'right', render: (r) => <span className="font-mono text-[11px] text-dim">{r.ts}</span> },
  ];

  // observe approvals: simplest approach — render log with the fixture rows plus any client-approved ids
  const logRows = [...extraLog, ...APPROVAL_LOG];

  return (
    <>
      <PageHeader
        title="Gatekeeper Console"
        sub="G1/G2 requests requiring two-signature approval. Every request passes the ROAI scope check before signatures are accepted. Approvals on this page are local UI state (fixture)."
        actions={<StatusChip status="open" label="3 pending" />}
      />

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        {GATE_REQUESTS.map((req) => (
          <GateRequestCard key={req.id} req={req} />
        ))}
      </div>

      <Panel
        title="Approvals Log"
        bodyClassName="p-4"
        actions={
          <button
            type="button"
            onClick={() =>
              setExtraLog((l) => [
                {
                  id: 'GR-0017',
                  kind: 'prod_attack' as const,
                  decision: 'Approved' as const,
                  sig1: 'R. Vale',
                  sig2: 'M. Ito',
                  ts: '2026-09-10T10:44Z',
                },
                ...l,
              ])
            }
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim transition-colors hover:text-slate-200"
            title="Fixture helper: simulate approving GR-0017 from the card above"
          >
            + simulate gr-0017 approval
          </button>
        }
      >
        <DataTable columns={columns} rows={logRows} rowKey={(r) => `${r.id}-${r.ts}`} initialSort={{ key: 'ts', dir: 'desc' }} />
      </Panel>
    </>
  );
}
