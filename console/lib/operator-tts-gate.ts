/** TTS guard shared by operator-dock — privacy mute must block gateway speech. */
export function shouldSpeakOperatorResult(
  voiceOn: boolean,
  privacyMuted: boolean,
  missionControlLive: boolean,
  message: string | null | undefined,
): boolean {
  return Boolean(voiceOn && !privacyMuted && missionControlLive && message);
}
