'use client';

import { useMemo } from 'react';
import { type LiveEvent } from '@/lib/live';
import { formatCapsClamped, type CapsClamped } from '@/lib/targets';

export function CampaignStartFeedback({ events }: { events: LiveEvent[] }) {
  const start = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].type === 'campaign_start') return events[i];
    }
    return null;
  }, [events]);

  if (!start) return null;

  const clamped = (start.caps_clamped ?? {}) as CapsClamped;
  const lines = formatCapsClamped(clamped);
  const auth = start.authorization as Record<string, string> | null | undefined;

  if (lines.length === 0 && !auth) return null;

  return (
    <div
      className="rounded border border-warn/40 bg-warn/5 px-3 py-2.5 font-mono text-[11px] text-warn"
      role="status"
      data-testid="campaign-start-feedback"
    >
      {lines.length > 0 && (
        <>
          <p className="uppercase tracking-[0.12em] text-[10px]">budget caps reduced for asset criticality</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-mut">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      {auth && (
        <p className="mt-2 text-mut">
          authorization · owner {auth.owner} · ref {auth.reference || '—'} · valid until {auth.not_after}
        </p>
      )}
    </div>
  );
}
