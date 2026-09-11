import type { ReactNode } from 'react';

/** Dense key-value rows (dl-based). */
export function KV({ rows, className }: { rows: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-1.5 ${className ?? ''}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{k}</dt>
          <dd className="font-mono text-[12px] text-slate-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
