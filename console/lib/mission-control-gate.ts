'use client';

/** Global gate: operator campaign actions require Mission Control live. */

let missionControlLive = false;

export function setMissionControlLive(v: boolean): void {
  missionControlLive = v;
  if (typeof window !== 'undefined') {
    (window as unknown as { __RF_MISSION_CONTROL_LIVE__?: boolean }).__RF_MISSION_CONTROL_LIVE__ = v;
    window.dispatchEvent(new CustomEvent('rf:mission-control-live', { detail: v }));
  }
}

export function isMissionControlLive(): boolean {
  return missionControlLive;
}

/** True during entry hero — campaign/operator commands blocked. */
export function isEntryLocked(): boolean {
  return !missionControlLive;
}
