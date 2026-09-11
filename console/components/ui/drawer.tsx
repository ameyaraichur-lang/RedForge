'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  widthClass?: string;
}

/** Right-side slide-over panel with overlay + Escape-to-close. */
export function Drawer({ open, onClose, title, children, widthClass = 'w-full max-w-[540px]' }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-panel shadow-glow',
          widthClass,
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 font-mono text-[13px] text-slate-100">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dim transition-colors hover:bg-ink-2 hover:text-slate-200"
            aria-label="Close drawer"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
