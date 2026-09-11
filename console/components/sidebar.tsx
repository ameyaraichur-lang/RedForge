'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/icon';

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Command', icon: 'command' },
  { href: '/mission', label: 'Mission', icon: 'mission' },
  { href: '/world', label: '✦ World', icon: 'sentinel' },
  { href: '/findings', label: 'Findings', icon: 'findings' },
  { href: '/scorecard', label: 'Scorecard', icon: 'scorecard' },
  { href: '/dossier', label: 'Dossier', icon: 'dossier' },
  { href: '/gates', label: 'Gates', icon: 'gates' },
  { href: '/targets', label: 'Targets', icon: 'targets' },
  { href: '/techniques', label: 'Techniques', icon: 'techniques' },
  { href: '/sentinel', label: 'Sentinel', icon: 'sentinel' },
  { href: '/admin', label: 'Admin', icon: 'admin' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-line bg-ink-2">
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rotate-45 border border-acc bg-acc/30" aria-hidden />
          <span className="font-mono text-[13px] font-bold tracking-[0.22em] text-slate-100">REDFORGE</span>
        </div>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          console · ops mode
          <br />
          v0.8.0-m8-ritual
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary">
        <ul>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 border-l-2 px-4 py-[7px] font-mono text-[12px] transition-colors',
                    active
                      ? 'border-acc bg-acc/10 text-acc'
                      : 'border-transparent text-mut hover:border-line-2 hover:bg-panel/60 hover:text-slate-200',
                  )}
                >
                  <Icon name={item.icon} className="h-[15px] w-[15px]" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-1.5 border-t border-line px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">operator</p>
        <p className="font-mono text-[11px] text-slate-300">a.meya · admin</p>
        <p className="font-mono text-[10px] text-dim">session 2-sig capable</p>
      </div>
    </aside>
  );
}
