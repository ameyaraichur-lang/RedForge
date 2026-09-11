import type { ReactNode } from 'react';

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        {sub && <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-mut">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
