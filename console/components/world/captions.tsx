'use client';

// Voice & command presence (D8 phase 5) — briefing lines surface as large
// caption pop-ins in the reel grammar ("ONLINE AND LISTENING SIR"), spoken via
// keyless Web Speech when voice is on; copilot commands echo as a lowercase
// typewriter line under the core.

import { useEffect, useRef, useState } from 'react';
import { useLive, type LiveEvent } from '@/lib/live';
import { speak } from '@/lib/voice';
import { cn } from '@/lib/utils';

type Caption = { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'crit' };

function captionFor(e: LiveEvent): Caption | null {
  const id = e.seq ?? Math.random();
  switch (e.type) {
    case 'campaign_start':
      return { id, text: 'campaign launched · all packs · 3 rounds', tone: 'info' };
    case 'gate_approved':
      return { id, text: `gate ${e.gate_level ?? 'G1'} cleared · ${e.technique_id ?? ''}`, tone: 'ok' };
    case 'gate_denied':
      return { id, text: 'gate denied · sandbox only', tone: 'crit' };
    case 'chain':
      return { id, text: 'kill chain assembled', tone: 'warn' };
    case 'scorecard': {
      const sc = e.scorecard as { total?: number; band?: string } | undefined;
      return { id, text: `security score ${sc?.total ?? '?'} · ${sc?.band ?? '?'}`, tone: 'info' };
    }
    case 'campaign_end':
      return { id, text: `campaign complete · ${e.stopped_reason ?? ''}`, tone: 'ok' };
    case 'budget_exhausted':
      return { id, text: 'budget exhausted · campaign halted', tone: 'crit' };
    default:
      return null;
  }
}

export function WorldCaptions({ events, running }: { events: LiveEvent[]; running: boolean }) {
  const { voiceOn, lastBriefing } = useLive();
  const seen = useRef<number>(0);
  const [caption, setCaption] = useState<Caption | null>(null);
  const timer = useRef<number>(0);
  const briefSeen = useRef<string>('');

  const show = (c: Caption, speakIt: boolean) => {
    setCaption(c);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCaption(null), 3400);
    if (speakIt) speak(c.text);
  };

  // event-derived captions (escalations override everything — reel grammar)
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (typeof e.seq === 'number' && e.seq <= seen.current) break;
      if (e.type === 'verdict' && e.escalated) {
        show({ id: e.seq ?? Math.random(), text: `escalation · ${e.tech_id} · human review`, tone: 'crit' }, voiceOn);
      }
    }
    const lastSeq = events.length ? (typeof events[events.length - 1].seq === 'number' ? (events[events.length - 1].seq as number) : 0) : 0;
    if (lastSeq > seen.current) {
      for (const e of events) {
        if (typeof e.seq === 'number' && e.seq > seen.current) {
          const c = captionFor(e);
          if (c) show(c, voiceOn);
        }
      }
      seen.current = lastSeq;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, voiceOn]);

  // briefing captions (from the api briefing feed)
  useEffect(() => {
    if (lastBriefing && lastBriefing.ts !== briefSeen.current) {
      briefSeen.current = lastBriefing.ts;
      show({ id: Date.now(), text: lastBriefing.text, tone: 'info' }, voiceOn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBriefing, voiceOn]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center gap-2" aria-live="polite">
      {caption && (
        <p
          key={caption.id}
          className={cn(
            'world-caption font-mono uppercase',
            caption.tone === 'ok' && 'world-caption-ok',
            caption.tone === 'warn' && 'world-caption-warn',
            caption.tone === 'crit' && 'world-caption-crit',
          )}
        >
          {caption.text}
        </p>
      )}
      {!caption && !running && (
        <p className="world-caption-idle font-mono uppercase">redforge online and listening</p>
      )}
    </div>
  );
}

export function CommandEcho() {
  const [text, setText] = useState<string | null>(null);
  const [shown, setShown] = useState('');
  const timer = useRef<number>(0);

  useEffect(() => {
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (!detail) return;
      window.clearTimeout(timer.current);
      setText(detail.toLowerCase());
    };
    window.addEventListener('rf:command', onCmd);
    return () => window.removeEventListener('rf:command', onCmd);
  }, []);

  useEffect(() => {
    if (text === null) return;
    setShown('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 34);
    timer.current = window.setTimeout(() => setText(null), 3600);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(30%+52px)] z-30 flex justify-center">
      {text !== null && (
        <p className="world-cmd-echo font-mono">
          › {shown}
          <span className="world-cursor" aria-hidden />
        </p>
      )}
    </div>
  );
}
