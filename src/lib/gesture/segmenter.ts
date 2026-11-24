// Decides when a gesture starts and ends, from "motion energy" relative to a rest baseline:
//   REST -> SIGNING -> ENDED -> (classify) -> COOLDOWN -> REST
// Energy = gyro magnitude / rest gyro noise + landmark speed / rest landmark speed.
// All thresholds are relative to the per-session rest calibration and tuned by testing.
import type { Frame } from "./features";

export type GState = "rest" | "signing" | "ended" | "cooldown";

export interface Baseline {
  gyroDegS: number; // typical gyro magnitude at rest
  handSpeed: number; // typical landmark speed at rest
}

export interface SegmenterConfig {
  startRatio: number; // energy above (startRatio x rest) counts as moving
  startMs: number; // must keep moving this long to start (filters twitches)
  endMs: number; // must be still this long to end
  minMs: number; // shorter segments are ignored
  maxMs: number; // longer segments are ignored
  cooldownMs: number; // pause after a segment before listening again
}

export const DEFAULT_SEGMENTER: SegmenterConfig = {
  startRatio: 3,
  startMs: 150,
  endMs: 400,
  minMs: 250,
  maxMs: 4000,
  cooldownMs: 500,
};

/** Floors so a perfectly still rest (e.g. phone on a table) does not make every tremor "motion". */
const GYRO_FLOOR = 3; // °/s
const SPEED_FLOOR = 0.02; // image widths per second

export function motionEnergy(
  gyroDegS: number,
  handSpeed: number,
  b: Baseline,
  useImu: boolean,
): number {
  const hand = handSpeed / Math.max(b.handSpeed, SPEED_FLOOR);
  if (!useImu) return hand;
  return gyroDegS / Math.max(b.gyroDegS, GYRO_FLOOR) + hand;
}

export type SegmentEvent =
  | { kind: "segment"; frames: Frame[]; endedAt: number }
  | { kind: "discarded"; reason: "too-short" | "too-long"; durationMs: number };

export class Segmenter {
  state: GState = "rest";
  cfg: SegmenterConfig;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private buf: Frame[] = [];
  private pre: Frame[] = []; // frames since energy first rose, kept so the start is not cut off
  private cooldownUntil = 0;

  constructor(cfg: SegmenterConfig = DEFAULT_SEGMENTER) {
    this.cfg = cfg;
  }

  /** Frames of the gesture in progress (empty unless signing). Read-only: do not mutate. */
  get current(): Frame[] {
    return this.state === "signing" ? this.buf : [];
  }

  /** `energy` is motionEnergy(); threshold is 1 + startRatio scaled: >= startRatio means moving. */
  push(f: Frame, energy: number): SegmentEvent | null {
    const moving = energy >= this.cfg.startRatio;
    const t = f.t;

    if (this.state === "cooldown" || this.state === "ended") {
      if (t >= this.cooldownUntil) this.state = "rest";
      else return null;
    }

    if (this.state === "rest") {
      if (!moving) {
        this.aboveSince = null;
        this.pre = [];
        return null;
      }
      this.aboveSince ??= t;
      this.pre.push(f);
      if (t - this.aboveSince >= this.cfg.startMs) {
        this.state = "signing";
        this.buf = this.pre;
        this.pre = [];
        this.belowSince = null;
      }
      return null;
    }

    // signing
    this.buf.push(f);
    if (moving) this.belowSince = null;
    else this.belowSince ??= t;

    const start = this.buf[0].t;
    if (t - start > this.cfg.maxMs) return this.finish(t, "too-long");
    if (this.belowSince !== null && t - this.belowSince >= this.cfg.endMs) {
      const belowAt = this.belowSince;
      this.buf = this.buf.filter((x) => x.t <= belowAt); // drop the still tail
      return this.finish(t);
    }
    return null;
  }

  private finish(t: number, forced?: "too-long"): SegmentEvent {
    const frames = this.buf;
    const durationMs = frames.length
      ? frames[frames.length - 1].t - frames[0].t
      : 0;
    this.buf = [];
    this.aboveSince = null;
    this.belowSince = null;
    this.state = "ended";
    this.cooldownUntil = t + this.cfg.cooldownMs;
    if (forced) return { kind: "discarded", reason: forced, durationMs };
    if (durationMs < this.cfg.minMs)
      return { kind: "discarded", reason: "too-short", durationMs };
    return { kind: "segment", frames, endedAt: t };
  }
}
