// Spoken cues via the Web Speech API (on-device voices, no network on iOS/Android).
// iOS refuses speechSynthesis until it has been used inside a user tap, so unlock() must be
// called synchronously in the "Mulai" click handler.

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

/** First on-device voice for a language prefix ("id", "en"). */
export function voiceFor(prefix: string): SpeechSynthesisVoice | null {
  const voices = synth()?.getVoices() ?? [];
  return (
    voices.find((v) =>
      v.lang.toLowerCase().replace("_", "-").startsWith(prefix),
    ) ?? null
  );
}

export const indonesianVoice = () => voiceFor("id");

/** Voices load asynchronously on some browsers; resolve once they are there (or after 1.5 s). */
export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  if (s.getVoices().length) return Promise.resolve(s.getVoices());
  return new Promise((resolve) => {
    const done = () => resolve(s.getVoices());
    s.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export function unlockSpeech(): void {
  const s = synth();
  if (!s) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  s.speak(u);
}

/** Speak now, cutting off anything still queued: a stale cue is worse than none. */
export function speak(text: string, lang: "id-ID" | "en-US" = "id-ID"): void {
  const s = synth();
  if (!s) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voice = voiceFor(lang.slice(0, 2));
  if (voice) u.voice = voice;
  s.speak(u);
}
