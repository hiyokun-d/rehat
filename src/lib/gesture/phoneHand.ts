// Laptop-camera setup: which of the visible hands holds the phone?
// Idea: the phone's gyro moves exactly when the holding hand moves. Correlate each hand's
// landmark speed with the phone's gyro magnitude over the last ~1.5 s; the best match (if
// clearly positive) is the phone hand. Pure functions so they can be tested.
import type { Landmark } from "./features";

export interface TimedValue {
  t: number; // ms, laptop clock
  v: number;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Value of `series` nearest to time t (series sorted by t). */
export function nearest(series: TimedValue[], t: number): number {
  let best = series[0];
  for (const p of series)
    if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best?.v ?? 0;
}

/** Correlation of one hand's speed series with the phone's gyro series. */
export function phoneMatch(
  handSpeed: TimedValue[],
  gyro: TimedValue[],
): number {
  if (handSpeed.length < 5 || gyro.length < 5) return 0;
  return pearson(
    handSpeed.map((p) => p.v),
    handSpeed.map((p) => nearest(gyro, p.t)),
  );
}

/** Below this, we do not claim to know which hand holds the phone. Tuned by testing. */
export const MIN_MATCH = 0.4;

/** Box around the palm (wrist + finger bases), grown so it covers a phone held in it. */
export function palmBox(lm: Landmark[], grow = 0.6) {
  const idx = [0, 1, 5, 9, 13, 17];
  const xs = idx.map((i) => lm[i].x);
  const ys = idx.map((i) => lm[i].y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const gw = (x1 - x0) * grow;
  const gh = (y1 - y0) * grow;
  return { x: x0 - gw / 2, y: y0 - gh / 2, w: x1 - x0 + gw, h: y1 - y0 + gh };
}
