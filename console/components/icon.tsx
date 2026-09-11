import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type IconName =
  | 'command'
  | 'mission'
  | 'findings'
  | 'scorecard'
  | 'dossier'
  | 'gates'
  | 'targets'
  | 'techniques'
  | 'sentinel'
  | 'admin'
  | 'check'
  | 'x'
  | 'alert'
  | 'play'
  | 'pause'
  | 'clock'
  | 'flame'
  | 'arrow-right'
  | 'download'
  | 'signature'
  | 'chevron-down'
  | 'external'
  | 'dot';

const PATHS: Record<IconName, ReactNode> = {
  command: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
  mission: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  findings: <path d="M4 6h16M4 12h16M4 18h9" />,
  scorecard: (
    <>
      <path d="M5 19a9 9 0 1 1 14 0" />
      <path d="M12 14l3.5-4.5" />
      <circle cx="12" cy="14" r="1" />
    </>
  ),
  dossier: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h7M9 16h7" />
    </>
  ),
  gates: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  targets: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5V18c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.5" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  techniques: (
    <>
      <path d="M10 3h4M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  sentinel: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  admin: (
    <>
      <path d="M4 7h9M19 7h1M4 17h3M13 17h7" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4M12 17.2v.3" />
    </>
  ),
  play: <path d="M7 5v14l12-7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  flame: <path d="M12 3c1.5 3.5-2.5 4.5-2.5 7.5a4 4 0 0 0 8 .5C17.5 7 13 7 12 3zM9.5 20.5c-1.5-1-2.5-2.5-2.5-4" />,
  'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />,
  signature: <path d="m4 20 4-1L20 7l-3-3L5 16z" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  external: <path d="M14 4h6v6M20 4 11 13M9 5H5v14h14v-4" />,
  dot: <circle cx="12" cy="12" r="4" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-4 w-4 shrink-0', className)}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
