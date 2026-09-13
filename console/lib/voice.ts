'use client';

import { voiceStt, voiceTts } from '@/lib/operator';

export type VoiceEnergyState = {
  speaking: boolean;
  energy: number;
  adapter: 'browser' | 'simulated' | 'openai_compat' | 'none';
};

let energyListeners: Array<(s: VoiceEnergyState) => void> = [];
let audioCtx: AudioContext | null = null;

export function onVoiceEnergy(cb: (s: VoiceEnergyState) => void): () => void {
  energyListeners.push(cb);
  return () => {
    energyListeners = energyListeners.filter((x) => x !== cb);
  };
}

function emitEnergy(s: VoiceEnergyState) {
  for (const cb of energyListeners) cb(s);
}

export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function sttAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__RF_SIMULATE_STT__ === true) return true;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition || window.MediaRecorder);
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** WebAudio RMS envelope during playback — drives viseme-compatible head energy. */
export async function analyzePlaybackEnergy(blob: Blob, onEnergy: (e: number) => void): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;
  const buf = await blob.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  const src = ctx.createBufferSource();
  src.buffer = audio;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.frequencyBinCount);
    const startedAt = ctx.currentTime;
    src.start();
    emitEnergy({ speaking: true, energy: 0.5, adapter: 'openai_compat' });
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        emitEnergy({ speaking: false, energy: 0, adapter: 'openai_compat' });
        resolve();
      };
      const tick = () => {
        if (done) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const e = Math.min(1, rms * 4);
        onEnergy(e);
        emitEnergy({ speaking: true, energy: e, adapter: 'openai_compat' });
        if (ctx.currentTime < startedAt + audio.duration) {
          requestAnimationFrame(tick);
        } else {
          finish();
        }
      };
      requestAnimationFrame(tick);
      src.onended = finish;
    });
}

export function speak(text: string, opts?: { rate?: number; pitch?: number }): void {
  if (!ttsAvailable()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 1.02;
    u.pitch = opts?.pitch ?? 0.92;
    u.lang = 'en-US';
    u.onstart = () => emitEnergy({ speaking: true, energy: 0.7, adapter: 'browser' });
    u.onend = () => emitEnergy({ speaking: false, energy: 0, adapter: 'browser' });
    synth.speak(u);
  } catch {
    emitEnergy({ speaking: false, energy: 0, adapter: 'none' });
  }
}

export async function speakViaGateway(text: string): Promise<void> {
  const resp = await voiceTts(text);
  if (resp?.audio_b64) {
    const mime = resp.mime_type || 'audio/mpeg';
    const blob = await fetch(`data:${mime};base64,${resp.audio_b64}`).then((r) => r.blob());
    await analyzePlaybackEnergy(blob, () => {});
    return;
  }
  if (resp?.adapter === 'simulated') {
    emitEnergy({ speaking: true, energy: resp.viseme_energy, adapter: 'simulated' });
    await new Promise((r) => window.setTimeout(r, resp.duration_ms || 500));
    emitEnergy({ speaking: false, energy: 0, adapter: 'simulated' });
    return;
  }
  speak(text);
}

export function stopSpeaking(): void {
  if (ttsAvailable()) window.speechSynthesis.cancel();
  emitEnergy({ speaking: false, energy: 0, adapter: 'none' });
}

async function recordOnce(maxMs = 8000): Promise<{ b64: string; mime: string } | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  return new Promise((resolve) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const buf = await blob.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      resolve({ b64, mime: rec.mimeType || 'audio/webm' });
    };
    rec.start();
    window.setTimeout(() => rec.stop(), maxMs);
  });
}

/** Push-to-talk: MediaRecorder → server STT, browser STT fallback. */
export function listenPushToTalk(
  onResult: (transcript: string) => void,
  onState?: (listening: boolean) => void,
): { stop: () => void; started: boolean } {
  onState?.(true);
  let stopped = false;

  const finish = () => {
    if (!stopped) onState?.(false);
    stopped = true;
  };

  const simulateStt =
    typeof window !== 'undefined' &&
    (window as unknown as { __RF_SIMULATE_STT__?: boolean }).__RF_SIMULATE_STT__ === true;

  if (typeof window !== 'undefined' && window.MediaRecorder && !simulateStt) {
    void (async () => {
      try {
        const rec = await recordOnce(6000);
        if (rec && !stopped) {
          const resp = await voiceStt({ audioB64: rec.b64, mimeType: rec.mime });
          if (resp?.transcript) onResult(resp.transcript);
        }
      } catch {
        if (simulateStt && !stopped) {
          const resp = await voiceStt({ simulateTranscript: 'yes' });
          if (resp?.transcript) onResult(resp.transcript);
        }
      } finally {
        finish();
      }
    })();
    return {
      stop: finish,
      started: true,
    };
  }

  if (simulateStt) {
    const w = window as unknown as { __RF_SIMULATE_STT_DELAY_MS?: number; __RF_SIMULATE_STT_TEXT?: string };
    const delayMs = typeof w.__RF_SIMULATE_STT_DELAY_MS === 'number' ? w.__RF_SIMULATE_STT_DELAY_MS : 450;
    const transcript = typeof w.__RF_SIMULATE_STT_TEXT === 'string' ? w.__RF_SIMULATE_STT_TEXT : 'yes';
    void voiceStt({ simulateTranscript: transcript }).then((resp) => {
      window.setTimeout(() => {
        if (!stopped && resp?.transcript) onResult(resp.transcript);
        finish();
      }, delayMs);
    });
    return { stop: finish, started: true };
  }

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
  if (Ctor) {
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript;
      if (t) onResult(t);
    };
    rec.onend = finish;
    rec.onerror = finish;
    rec.start();
    return { stop: () => rec.stop(), started: true };
  }

  finish();
  return { stop: finish, started: false };
}

export async function listenSimulated(transcript: string): Promise<string> {
  const resp = await voiceStt({ simulateTranscript: transcript });
  return resp?.transcript ?? transcript;
}

export function listenOnce(
  onResult: (transcript: string) => void,
  onEnd?: () => void,
): boolean {
  const { started, stop } = listenPushToTalk(
    (t) => {
      onResult(t);
      stop();
    },
    (listening) => {
      if (!listening) onEnd?.();
    },
  );
  return started;
}
