import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PanelProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Titled card surface — the base unit of the ops layout. */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn('rounded-md border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex min-h-[38px] items-center justify-between gap-3 border-b border-line px-4 py-2">
          {title ? (
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mut">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
