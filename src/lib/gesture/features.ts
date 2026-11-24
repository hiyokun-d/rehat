// Per-frame features for Mode 2. Two channels:
//  - free hand (camera): 21 landmarks made position- and size-invariant = 63 numbers, or null
//    when no hand is visible (a mask, not zeros: "no hand" must not look like "hand at origin").
//  - holding hand (phone IMU): gravity direction (3) + gyro (3), scaled to similar ranges.
import type { Sample } from "../sensor/types";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Frame {
  t: number; // ms
  hand: number[] | null; // 63 values or null
  imu: number[]; // 6 values
  /** Optional face channel (face.ts): absent/null when face tracking is off or no face seen. */
  face?: number[] | null;
}

/** Gyro °/s divided by this to land roughly in -1..1 for normal hand motion. Tuned by testing. */
const GYRO_SCALE = 200;

/**
 * Wrist at the origin, scaled by wrist -> middle-finger MCP (landmark 9) so hand size and
 * distance to the camera drop out; left hands mirrored so both hands look alike.
 */
export function normalizeHand(lm: Landmark[], handedness: string): number[] {
  const w = lm[0];
  const m = lm[9];
  const s = Math.hypot(m.x - w.x, m.y - w.y, m.z - w.z) || 1;
  const mirror = handedness === "Left" ? -1 : 1;
  return lm.flatMap((p) => [
    (mirror * (p.x - w.x)) / s,
    (p.y - w.y) / s,
    (p.z - w.z) / s,
  ]);
}

export function imuFeatures(s: Sample | null): number[] {
  if (!s) return [0, 0, 0, 0, 0, 0];
  const g = Math.hypot(s.ax, s.ay, s.az) || 1;
  return [
    s.ax / g,
    s.ay / g,
    s.az / g,
    s.gx / GYRO_SCALE,
    s.gy / GYRO_SCALE,
    s.gz / GYRO_SCALE,
  ];
}

/** Mean speed of all landmarks in image units per second (for "is the hand moving"). */
export function landmarkSpeed(
  prev: Landmark[] | null,
  cur: Landmark[] | null,
  dtMs: number,
): number {
  if (!prev || !cur || dtMs <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < cur.length; i++)
    sum += Math.hypot(cur[i].x - prev[i].x, cur[i].y - prev[i].y);
  return (sum / cur.length) * (1000 / dtMs);
}
