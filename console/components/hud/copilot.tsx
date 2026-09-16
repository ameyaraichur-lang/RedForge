'use client';

// Console Copilot — routes voice and keyboard through the server-side operator service.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLive } from '@/lib/live';
import { useOperator } from '@/lib/operator-context';
import { listenOnce, speak, speakViaGateway, sttAvailable } from '@/lib/voice';
import { cn } from '@/lib/utils';

const QUICK_COMMANDS = [
  { id: 'status', label: 'Situation briefing', hint: 'report status' },
  { id: 'start', label: 'Start bounded campaign', hint: 'requires confirmation' },
  { id: 'abort', label: 'Abort campaign', hint: 'requires confirmation' },
  { id: 'findings', label: 'Open Findings Explorer', hint: 'navigate' },
  { id: 'mission', label: 'Open Mission Control', hint: 'navigate' },
  { id: 'gates', label: 'Open Gatekeeper Console', hint: 'navigate' },
  { id: 'dossier', label: 'Open Regulatory Dossier', hint: 'navigate' },
  { id: 'world', label: 'Orchestrator World View', hint: 'navigate' },
];

const PHRASE_MAP: Record<string, string> = {
  status: 'report status',
  start: 'start campaign',
  abort: 'abort campaign',
  findings: 'open findings',
  mission: 'open mission',
  gates: 'open gates',
  dossier: 'open dossier',
  world: 'open world',
};

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const live = useLive();
  const operator = useOperator();
  const say = useCallback(
    (t: string) => {
      if (!live.voiceOn || operator.privacyMuted) return;
      void speakViaGateway(t).catch(() => speak(t));
    },
    [live.voiceOn, operator.privacyMuted],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const scored = q
    ? QUICK_COMMANDS.filter(
        (c) =>
          c.label.toLowerCase().includes(q.toLowerCase()) ||
          c.hint.toLowerCase().includes(q.toLowerCase()),
      )
    : QUICK_COMMANDS;

  const runPhrase = async (phrase: string) => {
    const result = await operator.submitText(phrase, 'text');
    if (result?.ok && result.data?.route && typeof result.data.route === 'string') {
      router.push(result.data.route);
    }
    if (result?.message) say(result.message);
  };

  const execute = (id: string, label: string) => {
    void runPhrase(PHRASE_MAP[id] ?? label);
  };

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    void runPhrase(text);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-full border border-acc/40 bg-ink/95 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-acc shadow-glow backdrop-blur transition-colors hover:border-acc hover:bg-acc/10"
        aria-label="Open Console Copilot"
      >
        ⌘K copilot
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-20 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-lg border border-acc/40 bg-ink shadow-glow"
        style={{ animation: 'hudmaterialize .3s ease-out' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Console Copilot command bar"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-acc">copilot</span>
          <span className="font-mono text-[10px] text-dim">· audited operator api</span>
          <span className="ml-auto font-mono text-[10px] text-dim">esc to close</span>
        </div>
        <div className="max-h-[200px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed" aria-live="polite">
          {operator.transcript.slice(-6).map((l) => (
            <p key={l.id} className={cn('mb-1', l.from === 'you' ? 'text-slate-300' : 'text-acc')}>
              {l.from === 'you' ? '› ' : '◆ '}
              {l.text}
            </p>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="report status · start campaign on TGT-DEMO · open findings…"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-slate-100 outline-none placeholder:text-dim"
            aria-label="Copilot command input"
          />
          {sttAvailable() && (
            <button
              type="button"
              onClick={() =>
                listenOnce((t) => {
                  setQ(t);
                  void runPhrase(t);
                })
              }
              className="rounded border border-line px-2 py-1 font-mono text-[10px] uppercase text-mut hover:border-acc/50 hover:text-acc"
              aria-label="Speak command"
            >
              mic
            </button>
          )}
        </div>
        <ul className="max-h-[240px] overflow-y-auto border-t border-line">
          {scored.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => execute(c.id, c.label)}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left hover:bg-acc/5"
              >
                <span className="font-mono text-[12px] text-slate-200">{c.label}</span>
                {c.hint && <span className="shrink-0 font-mono text-[10px] text-dim">{c.hint}</span>}
              </button>
            </li>
          ))}
          {scored.length === 0 && (
            <li className="px-4 py-3 font-mono text-[11px] text-dim">no matching command</li>
          )}
        </ul>
      </div>
    </div>
  );
}
