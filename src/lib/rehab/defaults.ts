// CONTOH, bukan nilai klinis.
// Every number in this file is a placeholder so the prototype runs. None of them is a
// clinical threshold. In the real product the therapist sets limits per patient, per exercise.

import type { SafetyEnvelope } from "./envelope";
import type { RepConfig } from "./reps";

export type ExerciseId = "shoulder-flexion" | "elbow-flexion";

export const EXERCISES: Record<
  ExerciseId,
  { name: string; placement: string }
> = {
  "shoulder-flexion": {
    name: "Fleksi bahu",
    placement:
      "HP di sisi luar lengan atas, layar menghadap keluar, bagian atas HP ke arah bahu.",
  },
  "elbow-flexion": {
    name: "Fleksi siku (lengan atas di meja)",
    placement:
      "Lengan atas bersandar di meja. HP di lengan bawah, layar menghadap keluar.",
  },
};

export const EXAMPLE_ENVELOPE: SafetyEnvelope = {
  maxAngleDeg: 90,
  maxVelDegPerS: 120,
  debounceMs: 300,
};

export const EXAMPLE_REPS: RepConfig = { upDeg: 30, downDeg: 10 };

/**
 * Calibration = 3 s "steady streak". A human arm is never perfectly still, so we do not ask for
 * zero motion; we ask that the gravity direction stays within a few degrees (that is what sets
 * the zero point). Tuned by testing, not from literature.
 */
export const CALIBRATION_MS = 3000;
/** 95% of samples must lie within this angle of the streak's mean gravity direction. */
export const CALIBRATION_MAX_SPREAD_DEG = 5;
/** A single sample this far off is a real movement: restart the streak instead of failing. */
export const CALIBRATION_RESET_DEG = 10;
/** Give up (and tell the user) if no steady streak happens within this time. */
export const CALIBRATION_TIMEOUT_MS = 10_000;

/** Minimum gap between two spoken cues, so the phone does not talk non-stop. Tuned by testing. */
export const CUE_GAP_MS = 2500;
