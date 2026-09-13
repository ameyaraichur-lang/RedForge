import { describe, expect, it } from 'vitest';
import { shouldSpeakOperatorResult } from '@/lib/operator-tts-gate';

describe('operator TTS privacy gate', () => {
  it('blocks TTS when privacy mute is on even with voice enabled and a result', () => {
    expect(
      shouldSpeakOperatorResult(true, true, true, 'Campaign idle · 0 attempts'),
    ).toBe(false);
  });

  it('allows TTS when voice is on, unmuted, mission control live, and result present', () => {
    expect(
      shouldSpeakOperatorResult(true, false, true, 'Campaign idle · 0 attempts'),
    ).toBe(true);
  });

  it('blocks TTS before mission control is live', () => {
    expect(shouldSpeakOperatorResult(true, false, false, 'status')).toBe(false);
  });
});
