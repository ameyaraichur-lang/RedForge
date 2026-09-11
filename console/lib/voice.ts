'use client';

// JARVIS voice layer (M6b+) — keyless by design (D3): browser-native Web Speech.
// TTS via speechSynthesis; STT via (webkit)SpeechRecognition when present.
// Everything degrades silently — voice is never required to operate the console.

export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function sttAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function speak(text: string, opts?: { rate?: number; pitch?: number }): void {
  if (!ttsAvailable()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // one voice at a time — JARVIS never talks over itself
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 1.02;
    u.pitch = opts?.pitch ?? 0.92;
    u.lang = 'en-US';
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export function stopSpeaking(): void {
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

export function listenOnce(
  onResult: (transcript: string) => void,
  onEnd?: () => void,
): boolean {
  if (!sttAvailable()) return false;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      })
    | undefined;
  if (!Ctor) return false;
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.onresult = (e) => {
    const t = e.results?.[0]?.[0]?.transcript;
    if (t) onResult(t);
  };
  rec.onend = () => onEnd?.();
  rec.onerror = () => onEnd?.();
  rec.start();
  return true;
}
