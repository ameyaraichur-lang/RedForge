'use client';

// The readiness ritual (D9 / WV2-3): the Orchestrator asks if the operator is
// ready — answered by voice (optional mic button → Web Speech) or the glass
// YES button (always present; serves no-mic browsers and E2E). Nothing else
// in the world loads until the answer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLive } from '@/lib/live';
import { listenOnce, speak, sttAvailable } from '@/lib/voice';

const YES_RE = /\b(yes|yeah|yep|ready|go|begin|start|ok|okay|sure|affirmative)\b/i;

export function ReadinessPrompt({ onYes }: { onYes: () => void }) {
  const { voiceOn } = useLive();
  const [heard, setHeard] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const answered = useRef(false);
  const yesRef = useRef(onYes);
  yesRef.current = onYes;

  const answer = useCallback(() => {
    if (answered.current) return;
    answered.current = true;
    window.dispatchEvent(new CustomEvent('rf:command', { detail: 'ready' }));
    yesRef.current();
  }, []);

  useEffect(() => {
    const line = 'RedForge online. All systems nominal. Are you ready to begin?';
    if (voiceOn) speak(line);
  }, [voiceOn]);

  const byVoice = () => {
    setListening(true);
    const started = listenOnce(
      (t) => {
        setHeard(t);
        setListening(false);
        if (YES_RE.test(t)) answer();
      },
      () => setListening(false),
    );
    if (!started) setListening(false);
  };

  return (
    <div className="absolute bottom-10 left-1/2 z-30 w-[520px] -translate-x-1/2 text-center">
      <p className="world-caption font-mono uppercase" aria-live="polite">
        {listening ? 'listening…' : heard ? `heard “${heard}”` : 'redforge online · are you ready to begin?'}
      </p>
      <div className="mt-5 flex items-center justify-center gap-3">
        {sttAvailable() && (
          <button type="button" onClick={byVoice} className="world-ctl" aria-label="Answer by voice">
            🎤 answer by voice
          </button>
        )}
        <button type="button" onClick={answer} className="world-btn world-btn-lg" aria-label="Yes, initialize mission">
          yes — initialize mission
        </button>
      </div>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.3em] text-dim">
        say “yes” or click · the swarm assembles on your word
      </p>
    </div>
  );
}
