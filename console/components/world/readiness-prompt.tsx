'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLive } from '@/lib/live';
import { useOperator } from '@/lib/operator-context';
import { listenPushToTalk, sttAvailable } from '@/lib/voice';

const YES_RE = /\b(yes|yeah|yep|ready|go|begin|ok|okay|sure|affirmative|enter)\b/i;
const CAMPAIGN_RE = /\b(start|launch|run|campaign|abort|confirm)\b/i;

export function ReadinessPrompt({
  onEnter,
  onSkip,
  showSkip,
  phase,
  missionControlLive,
  allowVoice,
  onListeningStart,
  onListeningEnd,
}: {
  onEnter: () => void;
  onSkip?: () => void;
  showSkip?: boolean;
  phase?: string;
  missionControlLive: boolean;
  allowVoice?: boolean;
  onListeningStart?: () => void;
  onListeningEnd?: () => void;
}) {
  const op = useOperator();
  const [heard, setHeard] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const answered = useRef(false);
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;
  const pttRef = useRef<{ stop: () => void } | null>(null);

  const enter = useCallback(() => {
    if (answered.current || missionControlLive) return;
    answered.current = true;
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'enter mission control' }));
    enterRef.current();
  }, [missionControlLive]);

  useEffect(() => {
    const onPttResult = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (!t || missionControlLive) return;
      setHeard(t);
      onListeningEnd?.();
      if (CAMPAIGN_RE.test(t)) {
        setHeard(`${t} (ignored — entry only)`);
        return;
      }
      if (YES_RE.test(t)) enter();
    };
    window.addEventListener('rf:ptt-result', onPttResult);
    return () => window.removeEventListener('rf:ptt-result', onPttResult);
  }, [enter, missionControlLive, onListeningEnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (missionControlLive) return;
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter, missionControlLive]);

  const startPtt = () => {
    if (missionControlLive || op.privacyMuted || !allowVoice) return;
    setListening(true);
    op.setMicEnabled(true);
    onListeningStart?.();
    const { stop, started } = listenPushToTalk(
      (t) => {
        setHeard(t);
        setListening(false);
        op.setMicEnabled(false);
        onListeningEnd?.();
        if (CAMPAIGN_RE.test(t)) {
          setHeard(`${t} (ignored — entry only)`);
          return;
        }
        if (YES_RE.test(t)) enter();
      },
      (active) => {
        op.setMicEnabled(active);
        if (!active) {
          setListening(false);
          pttRef.current = null;
          onListeningEnd?.();
        }
      },
    );
    if (started) pttRef.current = { stop };
    else {
      setListening(false);
      onListeningEnd?.();
    }
  };

  const stopPtt = () => {
    pttRef.current?.stop();
    pttRef.current = null;
    op.setMicEnabled(false);
    setListening(false);
    onListeningEnd?.();
  };

  const showPtt = sttAvailable() && allowVoice && phase !== 'speaking';

  return (
    <div data-readiness-phase={phase ?? 'awaiting_entry'} data-testid="readiness-prompt">
      <div className="flex flex-wrap items-center justify-center gap-3">
        {showPtt && (
          <button
            type="button"
            className="world-ctl"
            aria-label="Push to talk"
            aria-pressed={listening || phase === 'listening'}
            data-mic-state={listening || phase === 'listening' ? 'active' : 'off'}
            disabled={false}
            onMouseDown={startPtt}
            onMouseUp={stopPtt}
            onMouseLeave={stopPtt}
            onTouchStart={startPtt}
            onTouchEnd={stopPtt}
          >
            🎤 push to talk
          </button>
        )}
        <button
          type="button"
          onClick={enter}
          className="world-btn world-btn-lg"
          aria-label="Enter Mission Control"
          data-testid="enter-mission-control"
        >
          enter mission control
        </button>
        {showSkip && onSkip && (
          <button type="button" onClick={onSkip} className="world-ctl" aria-label="Skip entry animation">
            skip
          </button>
        )}
      </div>
      {heard && (
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.24em] text-dim" aria-live="polite">
          heard “{heard}”
        </p>
      )}
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.3em] text-dim">
        say “yes” · click · enter/space · never starts a campaign
      </p>
    </div>
  );
}
