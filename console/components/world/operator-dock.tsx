'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useOperator } from '@/lib/operator-context';
import { useLive } from '@/lib/live';
import { shouldSpeakOperatorResult } from '@/lib/operator-tts-gate';
import { listenPushToTalk, speakViaGateway, sttAvailable } from '@/lib/voice';
import { cn } from '@/lib/utils';

const PHASE_META: Record<string, { label: string; cls: string }> = {
  idle: { label: 'online', cls: 'text-acc' },
  listening: { label: 'listening', cls: 'text-acc animate-pulse' },
  thinking: { label: 'thinking', cls: 'text-warn' },
  speaking: { label: 'speaking', cls: 'text-ok animate-pulse' },
  awaiting_confirmation: { label: 'confirm required', cls: 'text-warn' },
  success: { label: 'success', cls: 'text-ok' },
  error: { label: 'error', cls: 'text-crit' },
};

const AUTH_META: Record<string, { label: string; cls: string }> = {
  initializing: { label: 'initializing', cls: 'text-dim animate-pulse' },
  authenticated: { label: 'online', cls: 'text-acc' },
  unauthenticated: { label: 'login required', cls: 'text-warn' },
  error: { label: 'auth error', cls: 'text-crit' },
};

export function OperatorDock({ visible, missionControlLive = true }: { visible: boolean; missionControlLive?: boolean }) {
  const op = useOperator();
  const { voiceOn } = useLive();
  const [text, setText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pttRef = useRef<{ stop: () => void } | null>(null);

  const phaseMeta = PHASE_META[op.phase] ?? PHASE_META.idle;
  const authMeta = AUTH_META[op.authStatus] ?? AUTH_META.initializing;
  const commandsEnabled = op.authStatus === 'authenticated' && missionControlLive;

  const onPttDown = useCallback(() => {
    if (op.privacyMuted || !missionControlLive) return;
    op.setMicEnabled(true);
    const { stop, started } = listenPushToTalk(
      (t) => void op.submitText(t, 'voice'),
      (listening) => {
        op.setMicEnabled(listening);
        if (!listening) pttRef.current = null;
      },
    );
    if (started) pttRef.current = { stop };
  }, [op, missionControlLive]);

  const onPttUp = useCallback(() => {
    pttRef.current?.stop();
    pttRef.current = null;
    op.setMicEnabled(false);
  }, [op]);

  const speakKey = op.lastResult?.message ? `${op.transcript.length}:${op.lastResult.message}` : null;
  useEffect(() => {
    const message = op.lastResult?.message;
    if (!speakKey || !shouldSpeakOperatorResult(voiceOn, op.privacyMuted, missionControlLive, message)) return;
    setSpeaking(true);
    void speakViaGateway(message!).finally(() => setSpeaking(false));
  }, [speakKey, op.lastResult, voiceOn, op.privacyMuted, missionControlLive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!visible) return null;

  const plan = op.plan;
  const displayPhase = speaking ? 'speaking' : op.phase;
  const meta = commandsEnabled ? (PHASE_META[displayPhase] ?? phaseMeta) : authMeta;

  return (
    <aside
      className="absolute bottom-4 right-4 z-40 flex w-[min(440px,calc(100vw-2rem))] flex-col gap-2 rounded-lg border border-acc/30 bg-ink/92 p-3 shadow-glow backdrop-blur-md"
      aria-label="Operator command dock"
      role="region"
      data-operator-phase={displayPhase}
      data-operator-auth={op.authStatus}
    >
      <div className="flex items-center gap-2 border-b border-line/60 pb-2">
        <span
          className={cn('font-mono text-[10px] uppercase tracking-[0.18em]', meta.cls)}
          aria-live="polite"
          data-testid="operator-phase"
        >
          {meta.label}
        </span>
        {op.session?.demo_labeled && (
          <span className="rounded border border-warn/40 px-1 font-mono text-[8px] uppercase text-warn">
            demo auth
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-[9px] text-dim">
          {speaking
            ? 'tts active · mic off'
            : op.micEnabled
              ? '🎤 mic on'
              : op.privacyMuted
                ? '🔇 muted'
                : 'mic off'}
        </span>
      </div>

      {!missionControlLive && (
        <p className="font-mono text-[10px] text-warn" data-testid="operator-entry-locked">
          Entry in progress — commands unlock after Mission Control is live.
        </p>
      )}
      {op.authStatus === 'initializing' && (
        <p className="font-mono text-[10px] text-dim" data-testid="operator-auth-hint">
          Establishing operator session…
        </p>
      )}
      {op.authStatus === 'unauthenticated' && (
        <p className="font-mono text-[10px] text-warn" data-testid="operator-auth-hint">
          Secure mode — login required before operator commands.
        </p>
      )}
      {op.authStatus === 'error' && op.authError && (
        <p className="font-mono text-[10px] text-crit" data-testid="operator-auth-hint">
          {op.authError}
        </p>
      )}

      {plan && commandsEnabled && (
        <div className="rounded border border-line/40 bg-panel/60 p-2 font-mono text-[10px] leading-relaxed text-mut">
          <p>
            <span className="text-dim">step </span>
            {plan.current_step ?? 'idle'}
            {plan.running && <span className="text-ok"> · running</span>}
          </p>
          {plan.blockers.length > 0 && (
            <p className="text-warn">blockers: {plan.blockers.join('; ')}</p>
          )}
          <p className="text-dim">next: {plan.next_action}</p>
        </div>
      )}

      {op.pendingConfirmation && (
        <div className="rounded border border-warn/50 bg-warn/10 p-2" role="alertdialog" aria-label="Confirm action">
          <p className="font-mono text-[11px] text-warn">{op.pendingConfirmation.summary}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="world-btn text-[10px]" onClick={() => void op.confirmPending()}>
              confirm
            </button>
            <button type="button" className="world-ctl text-[10px]" onClick={op.cancelPending}>
              cancel
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[100px] overflow-y-auto font-mono text-[10px] leading-relaxed" aria-live="polite" aria-label="Operator transcript">
        {op.transcript.slice(-8).map((t) => (
          <p key={t.id} className={cn('mb-0.5', t.from === 'you' ? 'text-slate-300' : t.from === 'system' ? 'text-warn' : 'text-acc')}>
            {t.from === 'you' ? '› ' : t.from === 'system' ? '⚠ ' : '◆ '}
            {t.text}
          </p>
        ))}
      </div>

      {op.lastResult?.message && (
        <p
          className="sr-only"
          data-testid="operator-last-result"
          aria-live="polite"
        >
          {op.lastResult.message}
        </p>
      )}

      {op.audit.length > 0 && (
        <div className="max-h-[72px] overflow-y-auto rounded border border-line/30 bg-panel/40 p-1.5 font-mono text-[9px] text-dim" aria-label="Operator audit trail">
          {op.audit.slice(-4).map((a) => (
            <p key={a.id}>
              {a.ts.slice(11, 19)} · {a.action} · {a.decision}
            </p>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-line/60 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!commandsEnabled) return;
          void op.submitText(text);
          setText('');
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            commandsEnabled
              ? 'status · start campaign on TGT-04 · open findings…'
              : op.authStatus === 'initializing'
                ? 'initializing operator session…'
                : 'login required for operator commands'
          }
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-100 outline-none placeholder:text-dim"
          aria-label="Operator text command"
          disabled={!commandsEnabled}
        />
        <button type="submit" className="world-ctl text-[9px]" aria-label="Send command" disabled={!commandsEnabled}>
          send
        </button>
        <button
          type="button"
          className={cn('world-ctl text-[9px]', op.micEnabled && 'border-acc text-acc')}
          aria-label="Push to talk"
          aria-pressed={op.micEnabled}
          onMouseDown={onPttDown}
          onMouseUp={onPttUp}
          onMouseLeave={onPttUp}
          onTouchStart={onPttDown}
          onTouchEnd={onPttUp}
          disabled={!commandsEnabled || op.privacyMuted}
        >
          {sttAvailable() ? 'ptt' : 'ptt*'}
        </button>
        <button
          type="button"
          className="world-ctl text-[9px]"
          aria-label="Toggle privacy mute"
          aria-pressed={op.privacyMuted}
          onClick={() => op.setPrivacyMuted(!op.privacyMuted)}
        >
          {op.privacyMuted ? 'unmute' : 'mute'}
        </button>
      </form>

      <nav className="flex flex-wrap gap-2 border-t border-line/40 pt-2 font-mono text-[9px] uppercase tracking-[0.12em]">
        <Link href="/mission" className="text-acc hover:underline">
          ops · mission
        </Link>
        <Link href="/findings" className="text-acc hover:underline">
          findings
        </Link>
        <Link href="/gates" className="text-acc hover:underline">
          gates
        </Link>
        <Link href="/dossier" className="text-acc hover:underline">
          dossier
        </Link>
      </nav>
    </aside>
  );
}
