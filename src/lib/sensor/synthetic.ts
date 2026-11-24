// SYNTHETIC data for unit tests and a no-phone demo. Not a measurement of anyone.
// Models a segment rotating about the phone's z axis (e.g. shoulder flexion with the phone on
// the outer upper arm): gravity turns in the phone's x-y plane, gyro z reports the rate.
import type { Sample } from "./types";

export interface SyntheticOpts {
  hz?: number;
  stillMs?: number; // still period first (for calibration)
  reps?: number;
  peakDeg?: number;
  repMs?: number;
  gyroSign?: 1 | -1; // simulate a browser that reports the opposite rotation sign
  accelSign?: 1 | -1; // simulate a browser that reports gravity with the opposite sign
  noise?: number; // accel noise, m/s²
  seed?: number;
}

export function syntheticFlexion(o: SyntheticOpts = {}): Sample[] {
  const hz = o.hz ?? 60;
  const stillMs = o.stillMs ?? 3500;
  const reps = o.reps ?? 3;
  const peak = o.peakDeg ?? 80;
  const repMs = o.repMs ?? 3000;
  const gs = o.gyroSign ?? 1;
  const as = o.accelSign ?? 1;
  let seed = o.seed ?? 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const noise = o.noise ?? 0.05;
  const total = stillMs + reps * repMs;
  const out: Sample[] = [];
  for (let t = 0; t <= total; t += 1000 / hz) {
    const k = t < stillMs ? 0 : ((t - stillMs) % repMs) / repMs;
    // Smooth up-and-back: 0 -> peak -> 0 per rep.
    const theta =
      ((peak * (1 - Math.cos(2 * Math.PI * k))) / 2) * (Math.PI / 180);
    const dtheta =
      t < stillMs
        ? 0
        : ((peak * Math.PI * Math.sin(2 * Math.PI * k)) / repMs) * 1000; // °/s
    out.push({
      t,
      ax: as * 9.81 * Math.sin(theta) + noise * rand(),
      ay: as * 9.81 * Math.cos(theta) + noise * rand(),
      az: noise * rand(),
      gx: 0.2 * rand(),
      gy: 0.2 * rand(),
      gz: gs * dtheta + 0.2 * rand(),
    });
  }
  return out;
}
