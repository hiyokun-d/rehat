// Mode 2 messages phone -> screen (relayed as-is).
import type { Candidate } from "./classifier";
import type { GState } from "./segmenter";

export interface GestureStatusMsg {
  state: GState;
  phase: "idle" | "calibrating" | "ready" | "paused";
  fps: number;
  delegate: "GPU" | "CPU" | null;
}

export interface GestureResultMsg {
  word: string | null; // null = "tidak dikenali" (nothing is spoken)
  reason?: string;
  candidates: Candidate[];
  latencyMs: number; // segment end -> result on the phone (negative = spoken before the hand stopped)
  early?: boolean; // recognised while the gesture was still in progress
  sentAt: number; // Date.now() on the phone (clocks are NOT synced across devices)
}

/** Phone gyro magnitude (°/s) for the laptop-camera setup; t = phone clock (ms). */
export interface GestureImuMsg {
  points: { t: number; g: number }[];
}

export { SEED_VOCAB } from "./vocab";
