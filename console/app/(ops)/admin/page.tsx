import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { cn } from '@/lib/utils';
import { AUDIT_TRAIL, BUDGET_CAPS, MCP_SERVERS, ROLES } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Admin' };

function CapField({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          defaultValue={value}
          className="w-full rounded border border-line bg-ink-2 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 transition-colors hover:border-line-2 focus:border-acc/60 focus:outline-none"
        />
        <span className="w-14 shrink-0 font-mono text-[10px] text-dim">{unit}</span>
      </span>
      <span className="mt-1 block font-mono text-[9px] text-dim">{note}</span>
    </label>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Admin &amp; Control"
        sub="MCP server fleet, RBAC roles, budget caps and the immutable audit trail. Caps changes require the Admin role and are logged."
        actions={<StatusChip status="degraded" label="1 of 6 mcp degraded" />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="MCP Servers" bodyClassName="p-0" className="xl:col-span-2">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['server', 'status', 'tools', 'latency', 'version', 'note'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="sticky top-0 border-b border-line bg-ink-2 px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MCP_SERVERS.map((s) => (
                <tr key={s.name} className="border-b border-line/60 last:border-b-0 hover:bg-acc/5">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-slate-200">{s.name}</td>
                  <td className="px-4 py-2.5">
                    <StatusChip status={s.status} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-slate-300">{s.tools}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('font-mono text-[11px] tabular-nums', s.latencyMs > 300 ? 'text-warn' : 'text-mut')}>
                      {s.latencyMs}ms
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-mut">{s.version}</td>
                  <td className="px-4 py-2.5 text-mut">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="RBAC Roles">
          <ul className="space-y-3">
            {ROLES.map((r) => (
              <li key={r.name} className="rounded border border-line bg-ink-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-slate-100">{r.name}</span>
                  <span className="font-mono text-[10px] text-dim">{r.members} members</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{r.scope}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.permissions.map((p) => (
                    <Badge key={p} tone="acc">{p}</Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 font-mono text-[10px] leading-relaxed text-dim">
            two-signature quorum requires one approver + one distinct role-holder; admins cannot self-approve.
          </p>
        </Panel>

        <Panel
          title="Budget Caps"
          actions={<span className="font-mono text-[10px] text-warn">visual · not persisted</span>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CapField label="attempts / campaign" value={String(BUDGET_CAPS.attempts)} unit="attempts" note="enforced by redforge-opa" />
            <CapField label="token cap" value={BUDGET_CAPS.tokensMillions.toFixed(1)} unit="millions" note="raises require G2 two-sig" />
            <CapField label="cost cap" value={BUDGET_CAPS.costUsd.toFixed(0)} unit="usd" note="hard stop · kills mission" />
            <CapField label="concurrency" value={String(BUDGET_CAPS.concurrency)} unit="operators" note="max parallel red agents" />
            <CapField label="per-technique cap" value={String(BUDGET_CAPS.perTechnique)} unit="attempts" note="mutation ceiling per seed" />
          </div>
          <button
            type="button"
            title="Visual stub — cap writes land in M6b"
            className="mt-4 w-full rounded border border-acc/40 bg-acc/10 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-acc transition-colors hover:bg-acc/20"
          >
            save caps (2-sig required)
          </button>
        </Panel>

        <Panel title="Audit Trail" bodyClassName="p-0" className="xl:col-span-2">
          <ul className="divide-y divide-line/60">
            {AUDIT_TRAIL.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 hover:bg-acc/5">
                <span className="w-44 shrink-0 font-mono text-[11px] tabular-nums text-dim">{e.ts}</span>
                <span className="w-16 shrink-0 font-mono text-[11px] text-slate-300">{e.actor}</span>
                <span className="font-mono text-[11px] text-acc">{e.action}</span>
                <span className="ml-auto font-mono text-[11px] text-mut">{e.object}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
