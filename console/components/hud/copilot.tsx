'use client';

// Console Copilot (M6b+): ⌘K natural-language command core. Rule-based intent
// matching over the live API + navigation — the same MCP-first surface the
// swarm uses, exposed conversationally. Voice input via Web Speech (D3 keyless).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLive } from '@/lib/live';
import { listenOnce, speak, sttAvailable } from '@/lib/voice';
import { cn } from '@/lib/utils';

type Command = {
  id: string;
  match: string[];
  label: string;
  hint?: string;
  run: (ctx: { router: ReturnType<typeof useRouter>; live: ReturnType<typeof useLive>; say: (t: string) => void }) => void;
};

const COMMANDS: Command[] = [
  {
    id: 'start',
    match: ['start', 'launch', 'run campaign', 'begin', 'attack'],
    label: 'Start campaign (all packs · 3 rounds)',
    hint: 'runs the full swarm against the vulnerable demo target',
    run: ({ live, say }) => {
      void live.start(null, 3);
      say('Campaign launching. All packs, three bounded rounds. I will brief you on progress.');
    },
  },
  {
    id: 'abort',
    match: ['abort', 'stop', 'kill', 'halt'],
    label: 'Abort running campaign',
    hint: 'kill switch — halts operators, freezes budget, seals evidence',
    run: ({ live, say }) => {
      void live.abort();
      say('Campaign aborted. Operators halted, evidence sealed.');
    },
  },
  {
    id: 'brief',
    match: ['brief', 'status', 'sitrep', 'report', 'how is'],
    label: 'Situation briefing (spoken)',
    run: ({ live, say }) => {
      const s = live.status;
      if (!s) return say('No campaign data yet. Start a campaign first.');
      say(
        `Situation: ${s.running ? 'campaign running' : `campaign ${s.stopped_reason ?? 'idle'}`}. ` +
          `${s.attempts} attempts, ${s.verdicts} verdicts, ${s.successes} successful hits. ` +
          `${s.findings_total} findings, ${s.findings_confirmed} confirmed.` +
          (s.scorecard ? ` Security score ${s.scorecard.total}, band ${s.scorecard.band}.` : ''),
      );
    },
  },
  {
    id: 'world',
    match: ['world', 'jarvis view', 'cinematic', 'constellation view'],
    label: 'Enter World View (cinematic 3D)',
    hint: 'the full-screen swarm world — core orb, constellation, instruments',
    run: ({ router, say }) => {
      say('Entering the world.');
      router.push('/world');
    },
  },
  {
    id: 'hud',
    match: ['hud', 'hologram', '3d'],
    label: 'Toggle HUD mode',
    run: ({ live, say }) => {
      live.setHudMode(!live.hudMode);
      say(live.hudMode ? 'Switching to Ops Mode.' : 'HUD Mode engaged.');
    },
  },
  {
    id: 'voice',
    match: ['voice', 'speak', 'mute', 'sound', 'talk'],
    label: 'Toggle voice briefings',
    run: ({ live, say }) => {
      live.setVoiceOn(!live.voiceOn);
      say(live.voiceOn ? 'Voice muted.' : 'Voice active.');
    },
  },
  {
    id: 'findings',
    match: ['finding', 'vulnerab', 'issue'],
    label: 'Open Findings Explorer',
    run: ({ router, say }) => {
      say('Opening findings.');
      router.push('/findings');
    },
  },
  { id: 'mission', match: ['mission', 'control', 'dag', 'swarm'], label: 'Open Mission Control', run: ({ router }) => router.push('/mission') },
  { id: 'score', match: ['score', 'posture'], label: 'Open Scorecard', run: ({ router }) => router.push('/scorecard') },
  { id: 'gates', match: ['gate', 'approv'], label: 'Open Gatekeeper Console', run: ({ router }) => router.push('/gates') },
  { id: 'dossier', match: ['dossier', 'compliance', 'regulat', 'ai act', 'iso'], label: 'Open Regulatory Dossier', run: ({ router }) => router.push('/dossier') },
  { id: 'targets', match: ['target'], label: 'Open Target Registry', run: ({ router }) => router.push('/targets') },
  { id: 'techniques', match: ['technique', 'payload', 'attack list'], label: 'Open Technique Library', run: ({ router }) => router.push('/techniques') },
];

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [log, setLog] = useState<{ from: 'you' | 'jarvis'; text: string }[]>([
    { from: 'jarvis', text: 'RedForge online. Ask me to start a campaign, brief you, or open any screen.' },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const live = useLive();
  const say = useCallback((t: string) => {
    setLog((l) => [...l.slice(-6), { from: 'jarvis', text: t }]);
    if (live.voiceOn) speak(t);
  }, [live.voiceOn]);

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
    ? COMMANDS.filter((c) => c.match.some((m) => q.toLowerCase().includes(m) || c.label.toLowerCase().includes(q.toLowerCase())))
    : COMMANDS;

  const execute = (c: Command) => {
    setLog((l) => [...l.slice(-6), { from: 'you', text: c.label }]);
    window.dispatchEvent(new CustomEvent('rf:command', { detail: c.label }));
    c.run({ router, live, say });
  };

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    setLog((l) => [...l.slice(-6), { from: 'you', text }]);
    window.dispatchEvent(new CustomEvent('rf:command', { detail: text }));
    const c = COMMANDS.find((cmd) => cmd.match.some((m) => text.toLowerCase().includes(m)));
    if (c) c.run({ router, live, say });
    else say("I don't have that command yet. Try: start campaign, abort, brief me, open findings, HUD on.");
    setQ('');
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-20 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-lg border border-acc/40 bg-ink shadow-glow"
        style={{ animation: 'hudmaterialize .3s ease-out' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Console Copilot command bar"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-acc">copilot</span>
          <span className="font-mono text-[10px] text-dim">· rule-based nlu · mcp-first surface</span>
          <span className="ml-auto font-mono text-[10px] text-dim">esc to close</span>
        </div>
        <div className="max-h-[200px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
          {log.map((l, i) => (
            <p key={i} className={cn('mb-1', l.from === 'you' ? 'text-slate-300' : 'text-acc')}>
              {l.from === 'you' ? '› ' : '◆ '}{l.text}
            </p>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="start campaign · brief me · abort · hud on · open findings…"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-slate-100 outline-none placeholder:text-dim"
            aria-label="Copilot command input"
          />
          {sttAvailable() && (
            <button
              type="button"
              onClick={() => listenOnce((t) => setQ(t))}
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
                onClick={() => execute(c)}
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
