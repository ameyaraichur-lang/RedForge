'use client';

// Minimal hero-phase UI — caption + entry controls only (no dock/logs/instruments).

import type { EntryPhase } from '@/lib/entry-fsm';
import { heroChromeMicState, heroChromeStateLabel } from '@/lib/entry-fsm';

export function HeroEntryChrome({
  phase,
  caption,
  children,
  summonFade = 1,
}: {
  phase: EntryPhase;
  caption: string;
  children?: React.ReactNode;
  /** Fade hero CTA during late summon before HUD handoff. */
  summonFade?: number;
}) {
  const stateLabel = heroChromeStateLabel(phase);
  const micState = heroChromeMicState(phase);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex flex-col"
      data-hero-chrome="1"
      style={{ opacity: summonFade, transition: summonFade < 1 ? 'opacity 0.35s ease-out' : undefined }}
    >
      <div className="flex flex-col items-center gap-1.5 pt-6">
        <p
          className="hero-entry-status font-mono uppercase"
          data-hero-phase={phase}
          data-hero-status={`RedForge · ${stateLabel}`}
          data-mic-state={micState}
          aria-live="polite"
        >
          <span className="hero-entry-brand">RedForge</span>
          <span className="hero-entry-sep" aria-hidden="true">
            ·
          </span>
          <span className="hero-entry-state">{stateLabel}</span>
        </p>
        {phase === 'listening' && (
          <p
            className="hero-entry-audio-badge hero-entry-audio-badge--mic font-mono uppercase"
            data-audio-badge="mic-on"
            aria-hidden="true"
          >
            mic on
          </p>
        )}
        {phase === 'speaking' && (
          <p
            className="hero-entry-audio-badge hero-entry-audio-badge--tts font-mono uppercase"
            data-audio-badge="tts-active"
            aria-hidden="true"
          >
            speaker active
          </p>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-end pb-8">
        <p className="hero-entry-caption pointer-events-none mb-6 max-w-[90vw] text-center font-mono uppercase" aria-live="polite">
          {caption}
        </p>
        <div className="pointer-events-auto">{children}</div>
      </div>
    </div>
  );
}
