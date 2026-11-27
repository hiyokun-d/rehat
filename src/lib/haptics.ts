// Vibration cue (escalation L1: "voice or vibration cue"). Android Chrome supports it;
// iPhone Safari has no navigator.vibrate, so there the voice cue is the only cue.
// The pattern is a UI choice (noticeable, short), not a clinical number.
const CUE_PATTERN = [200, 100, 200];

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

export function vibrateCue(): void {
  if (canVibrate()) navigator.vibrate(CUE_PATTERN);
}
