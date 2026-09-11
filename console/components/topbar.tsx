'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icon';
import { StatusChip } from '@/components/ui/status-chip';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';

function UtcClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    function tick() {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setNow(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`);
    }
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-1.5 font-mono text-[12px] tabular-nums text-slate-300">
      <Icon name="clock" className="h-3.5 w-3.5 text-dim" />
      {now ?? '--:--:--Z'}
    </span>
  );
}

export function TopBar() {
  const { connected, connecting, status, hudMode, setHudMode, voiceOn, setVoiceOn } = useLive();
  const s = status;
  const running = s?.running ?? false;

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-4 border-b border-line bg-ink/90 px-6 backdrop-blur">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            connecting ? 'bg-warn animate-pulse' : connected ? 'bg-ok shadow-[0_0_8px_#34d399]' : 'bg-crit',
          )}
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
          {connecting ? 'connecting' : connected ? 'live api' : 'offline · fixtures'}
        </span>
      </div>

      {s?.campaign_id && (
        <span className="hidden font-mono text-[11px] text-slate-300 md:inline">{s.campaign_id}</span>
      )}

      <div className="hidden items-center gap-2 lg:flex">
        <StatusChip status={running ? 'running' : s?.stopped_reason === 'completed' ? 'confirmed' : 'standby'}
          label={running ? 'campaign running' : s?.stopped_reason === 'completed' ? 'campaign complete' : 'idle'} />
        {s && (s.findings_total > 0 || running) && (
          <StatusChip status={s.findings_confirmed > 0 ? 'confirmed' : 'open'}
            label={`${s.findings_confirmed}/${s.findings_total} findings`} />
        )}
        {s?.scorecard && (
          <StatusChip status={s.scorecard.total < 40 ? 'killed' : s.scorecard.total < 60 ? 'warning' : 'confirmed'}
            label={`score ${s.scorecard.total}`} />
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <a
          href="/world"
          className="flex items-center gap-2 rounded border border-violet-400/60 bg-violet-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300 transition-colors hover:bg-violet-400/20"
          aria-label="Enter World View"
        >
          ✦ world view
        </a>
        <button
          type="button"
          onClick={() => setVoiceOn(!voiceOn)}
          className={cn(
            'rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
            voiceOn ? 'border-acc/60 bg-acc/10 text-acc' : 'border-line bg-ink-2 text-dim hover:text-mut',
          )}
          aria-pressed={voiceOn}
          aria-label="Toggle voice briefings"
        >
          voice {voiceOn ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => setHudMode(!hudMode)}
          className={cn(
            'rounded border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
            hudMode
              ? 'border-acc bg-acc/15 text-acc shadow-glow'
              : 'border-line bg-ink-2 text-mut hover:border-line-2 hover:text-slate-200',
          )}
          aria-pressed={hudMode}
          aria-label="Toggle HUD mode"
        >
          {hudMode ? 'hud mode' : 'ops mode'}
        </button>
        <UtcClock />
      </div>
    </header>
  );
}
