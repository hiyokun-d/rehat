// "Where is the phone?" on the laptop camera, by calculation (no phone-detector model):
//  1. WHICH hand: the paired phone streams its gyro; the hand whose landmark speed correlates
//     with it over the last 1.5 s holds the phone (same idea as DeskCamera, now on Holistic).
//  2. WHERE: centred on that palm, sized from the hand (wrist -> middle knuckle).
//  3. ROTATION: the phone's own gravity vector gives its tilt in the screen plane (roll).
// All constants are tuned by testing; the roll sign is an ASSUMPTION per platform (iOS and
// Android report accelerationIncludingGravity with different signs on some versions).
import { MIN_MATCH, phoneMatch, type TimedValue } from "../gesture/phoneHand";

type Pt = { x: number; y: number };
export type Side = "l" | "r";

const WINDOW_MS = 1500;
const SWITCH_MARGIN = 0.15; // the other hand must win by this much to move the box (no flicker)
const PALM = [0, 5, 9, 13, 17];

export interface PhoneEstimate {
  side: Side;
  score: number; // correlation 0..1
  roll: number; // radians, tilt in the picture plane (0 = upright)
}

/** Tilt of an upright-ish phone from its gravity reading; ignores upside-down (+-90 deg range). */
export function rollFromGravity(g: [number, number, number]): number {
  const [x, y] = g;
  return y >= 0 ? Math.atan2(x, y) : Math.atan2(-x, -y);
}

const speed = (a: Pt[], b: Pt[], dtMs: number) => {
  let s = 0;
  for (let i = 0; i < b.length; i++)
    s += Math.hypot(b[i].x - a[i].x, b[i].y - a[i].y);
  return (s / b.length) * (1000 / Math.max(1, dtMs));
};

export class PhoneLocator {
  private series: Record<Side, TimedValue[]> = { l: [], r: [] };
  private prev: Partial<Record<Side, { pts: Pt[]; t: number }>> = {};
  current: Side | null = null;
  scores: Record<Side, number> = { l: 0, r: 0 };

  update(
    hands: Partial<Record<Side, Pt[]>>,
    t: number,
    gyro: TimedValue[],
    gravity: [number, number, number] | null,
  ) {
    for (const side of ["l", "r"] as Side[]) {
      const pts = hands[side];
      const p = this.prev[side];
      if (pts?.length) {
        this.series[side].push({ t, v: p ? speed(p.pts, pts, t - p.t) : 0 });
        this.prev[side] = { pts, t };
      } else {
        this.prev[side] = undefined;
        this.series[side] = [];
      }
      while (this.series[side].length && t - this.series[side][0].t > WINDOW_MS)
        this.series[side].shift();
      this.scores[side] = phoneMatch(this.series[side], gyro);
    }
    const best: Side = this.scores.l >= this.scores.r ? "l" : "r";
    const other: Side = best === "l" ? "r" : "l";
    if (this.scores[best] < MIN_MATCH) {
      // Keep the last hand while it is still visible: holding still is not "no phone".
      if (this.current && !hands[this.current]?.length) this.current = null;
    } else if (!this.current || !hands[this.current]?.length)
      this.current = best;
    else if (
      this.current === other &&
      this.scores[best] - this.scores[other] > SWITCH_MARGIN
    )
      this.current = best;
    if (!this.current) return null;
    return {
      side: this.current,
      score: this.scores[this.current],
      roll: gravity ? rollFromGravity(gravity) : 0,
    } satisfies PhoneEstimate;
  }
}

/** Phone rectangle in pixels around the palm: centre, size and rotation for drawing. */
export function phoneRect(
  hand: Pt[],
  P: (p: Pt) => readonly [number, number],
  roll: number,
  mirrored = true,
) {
  const pts = PALM.map((i) => P(hand[i]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const [wx, wy] = P(hand[0]);
  const [mx, my] = P(hand[9]);
  const len = Math.hypot(mx - wx, my - wy);
  // A phone is ~1.6x the wrist->knuckle length tall and half as wide (ASSUMPTION, typical sizes).
  return { cx, cy, h: len * 1.6, w: len * 0.8, angle: mirrored ? -roll : roll };
}
