// Faster signing with the phone in the signing hand.
// The camera alone ends a sign only when the hand leaves the picture (lower your hand, then
// ~8 frames = 270-530 ms on a 15-30 FPS webcam). The phone's gyro runs at 60-100 Hz and sees
// the hand stop directly, so a short pause is enough: no need to drop the hand between signs,
// which is what makes signing a sentence possible.
//
// MotionGate: gyro magnitude stream -> "start" / "end" events, with hysteresis and an adaptive
// rest level. GatedClip: keeps a short pre-roll of camera frames so a sign's first frames are
// not lost, and collects frames between start and end. All numbers are *tuned by testing*.

export interface GateConfig {
  startDegS: number; // floor: moving above this (°/s)
  stopDegS: number; // floor: still below this (°/s)
  noiseMult: number; // thresholds also scale with the measured rest noise
  startMs: number; // must move this long to start (ignores bumps)
  stillMs: number; // must be still this long to end the sign
  minSignMs: number; // shorter = ignored
  maxSignMs: number; // longer = cut anyway
  initialNoise: number; // rest level guess before any is measured (same unit as the input)
}

export const DEFAULT_GATE: GateConfig = {
  startDegS: 40,
  stopDegS: 20,
  noiseMult: 3,
  startMs: 60,
  stillMs: 180,
  minSignMs: 250,
  maxSignMs: 4000,
  initialNoise: 5,
};

/**
 * Same gate fed by the CAMERA instead of a phone: input = hand speed in picture heights per
 * second (mean landmark movement, so finger movement counts too). Webcam frames come every
 * 33-66 ms, so "still" needs a few frames. *Tuned by testing* on synthetic data only.
 */
export const CAMERA_GATE: GateConfig = {
  startDegS: 0.25,
  stopDegS: 0.1,
  noiseMult: 3,
  startMs: 60,
  stillMs: 200,
  minSignMs: 250,
  maxSignMs: 4000,
  initialNoise: 0.03,
};

type Pts = { x: number; y: number }[] | undefined;

/** Hand speed (picture heights/s): mean movement of the 21 hand points, faster hand wins. */
export function handSpeed(
  prev: { l: Pts; r: Pts },
  cur: { l: Pts; r: Pts },
  dtS: number,
): number {
  if (dtS <= 0) return 0;
  let best = 0;
  for (const k of ["l", "r"] as const) {
    const a = prev[k];
    const b = cur[k];
    if (!a?.length || !b?.length) continue;
    let sum = 0;
    for (let i = 0; i < b.length; i++)
      sum += Math.hypot(b[i].x - a[i].x, b[i].y - a[i].y);
    best = Math.max(best, sum / b.length / dtS);
  }
  return best;
}

export type GateEvent =
  | { kind: "start"; t: number }
  | { kind: "end"; t: number; stillSince: number; durationMs: number }
  | { kind: "discard"; t: number; reason: "too-short" | "too-long" };

export class MotionGate {
  cfg: GateConfig;
  moving = false;
  private noise: number; // running estimate of the rest level
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private startedAt = 0;
  last = 0; // latest gyro value, for the UI meter

  constructor(cfg: GateConfig = DEFAULT_GATE) {
    this.cfg = cfg;
    this.noise = cfg.initialNoise;
  }

  get thresholds() {
    return {
      start: Math.max(this.cfg.startDegS, this.noise * this.cfg.noiseMult),
      stop: Math.max(this.cfg.stopDegS, this.noise * this.cfg.noiseMult * 0.5),
    };
  }

  push(t: number, gyroDegS: number): GateEvent | null {
    this.last = gyroDegS;
    const { start, stop } = this.thresholds;
    if (!this.moving) {
      // Learn the rest level only while still (slow average, so a sign does not raise it).
      if (gyroDegS < start) this.noise += 0.02 * (gyroDegS - this.noise);
      if (gyroDegS >= start) {
        this.aboveSince ??= t;
        if (t - this.aboveSince >= this.cfg.startMs) {
          this.moving = true;
          this.startedAt = this.aboveSince;
          this.belowSince = null;
          return { kind: "start", t: this.aboveSince };
        }
      } else this.aboveSince = null;
      return null;
    }
    if (t - this.startedAt > this.cfg.maxSignMs)
      return this.reset({ kind: "discard", t, reason: "too-long" });
    if (gyroDegS < stop) {
      this.belowSince ??= t;
      if (t - this.belowSince >= this.cfg.stillMs) {
        const durationMs = this.belowSince - this.startedAt;
        if (durationMs < this.cfg.minSignMs)
          return this.reset({ kind: "discard", t, reason: "too-short" });
        return this.reset({
          kind: "end",
          t,
          stillSince: this.belowSince,
          durationMs,
        });
      }
    } else this.belowSince = null;
    return null;
  }

  private reset(ev: GateEvent): GateEvent {
    this.moving = false;
    this.aboveSince = null;
    this.belowSince = null;
    return ev;
  }
}

/** Camera frames: a short ring buffer (pre-roll) + the frames of the sign in progress. */
export class GatedClip<F> {
  private ring: { t: number; f: F }[] = [];
  frames: F[] = [];
  collecting = false;
  prerollMs: number;

  constructor(prerollMs = 200) {
    this.prerollMs = prerollMs;
  }

  push(t: number, f: F) {
    if (this.collecting) this.frames.push(f);
    this.ring.push({ t, f });
    while (this.ring.length && t - this.ring[0].t > this.prerollMs)
      this.ring.shift();
  }

  /** Sign started at `since` (may be slightly in the past): seed with the pre-roll. */
  start(since: number) {
    this.collecting = true;
    this.frames = this.ring
      .filter((x) => x.t >= since - this.prerollMs)
      .map((x) => x.f);
  }

  end(): F[] {
    const out = this.frames;
    this.frames = [];
    this.collecting = false;
    return out;
  }
}
