'use client';

// Time-travel replay (M6b+): scrub through the campaign event log like a DVR.
// The DAG/constellation re-executes to the scrub position (event prefix).

import { useEffect, useState } from 'react';
import { useLive, eventToLine } from '@/lib/live';
import { cn } from '@/lib/utils';

export function ReplayScrubber({
  position,
  onPosition,
  eventsCount,
}: {
  position: number | null;
  onPosition: (p: number | null) => void;
  eventsCount: number;
}) {
  const { events } = useLive();
  const [playing, setPlaying] = useState(false);

  // auto-advance while playing
  useEffect(() => {
    if (!playing || position === null) return;
    if (position >= eventsCount) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => onPosition(Math.min(position + 1, eventsCount)), 120);
    return () => window.clearTimeout(id);
  }, [playing, position, eventsCount, onPosition]);

  const idx = position === null ? eventsCount : position;
  const ev = events[Math.max(0, Math.min(idx - 1, events.length - 1))];
  const line = ev ? eventToLine(ev) : null;

  return (
    <div className="rounded border border-line bg-ink-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">time-travel replay</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (position === null) onPosition(Math.floor(eventsCount / 2));
              setPlaying((p) => !p);
            }}
            disabled={eventsCount === 0}
            className={cn(
              'rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]',
              playing ? 'border-acc/50 bg-acc/10 text-acc' : 'border-line bg-ink text-mut hover:text-slate-200',
              eventsCount === 0 && 'cursor-not-allowed opacity-40',
            )}
          >
            {playing ? 'pause' : 'play'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              onPosition(null);
            }}
            disabled={position === null}
            className={cn(
              'rounded border border-line bg-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mut hover:text-slate-200',
              position === null && 'cursor-not-allowed opacity-40',
            )}
          >
            live
          </button>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={eventsCount}
        value={idx}
        onChange={(e) => {
          setPlaying(false);
          const v = Number(e.target.value);
          onPosition(v >= eventsCount ? null : v);
        }}
        aria-label="Replay event position"
        className="mt-3 w-full accent-[#22d3ee]"
      />
      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[10px] text-dim">
        <span>{line ? `${line.t} ${line.who} ${line.text}`.slice(0, 72) : '—'}</span>
        <span className="tabular-nums">
          {idx}/{eventsCount}
        </span>
      </div>
    </div>
  );
}
