'use client';

// JARVIS briefing bar (M6b+): the swarm TALKS. Briefings from the live API are
// toasted and spoken (Web Speech, keyless D3). Mounted once in the root layout.

import { useEffect, useRef, useState } from 'react';
import { useLive } from '@/lib/live';
import { speak } from '@/lib/voice';
import { cn } from '@/lib/utils';

type Toast = { id: number; text: string };

export function BriefingBar() {
  const { connected, lastBriefing, voiceOn } = useLive();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<string | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!lastBriefing) return;
    const key = `${lastBriefing.ts}:${lastBriefing.text}`;
    if (seen.current === key) return;
    seen.current = key;
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, text: lastBriefing.text }]);
    if (voiceOn) speak(lastBriefing.text);
    const timer = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [lastBriefing, voiceOn]);

  if (!connected) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[380px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded border border-acc/40 bg-ink/95 px-4 py-3 shadow-glow backdrop-blur',
            'animate-[hudmaterialize_.45s_ease-out]',
          )}
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-acc">redforge briefing</p>
          <p className="mt-1 font-mono text-[12px] leading-relaxed text-slate-200">{t.text}</p>
        </div>
      ))}
    </div>
  );
}
