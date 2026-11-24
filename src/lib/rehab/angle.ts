// Segment angle from one phone: how far the limb segment has tilted away from where it was
// during calibration, measured against gravity. See docs/NOTES.md (M2) for the full reasoning.
//
// Why this is axis-free: instead of picking "the" gyro axis for a placement, we compare the
// gravity direction now with the gravity direction at calibration (angle between two vectors).
// Strap the phone a bit rotated, upside down, or on iOS vs Android with flipped signs — the angle
// between two gravity vectors is the same. The gyro is used through the same geometry.
import type { Sample } from "../sensor/types";
import { CALIBRATION_MAX_SPREAD_DEG } from "./defaults";
import { cross, DEG, dot, norm, scale, sub, unit, type Vec3 } from "./vec";

export type CalibrationResult =
  | { ok: true; g0: Vec3; spreadDeg: number; samples: number }
  | { ok: false; reason: "moved" | "too-few"; spreadDeg: number };

const accel = (s: Sample): Vec3 => ({ x: s.ax, y: s.ay, z: s.az });
const gyro = (s: Sample): Vec3 => ({ x: s.gx, y: s.gy, z: s.gz });

export const angleBetweenDeg = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * DEG;

/**
 * Mean gravity direction over a steady period. "Steady" = 95% of samples within
 * maxSpreadDeg of the mean (percentile, not max: one tremor spike must not fail it).
 */
export function calibrate(
  samples: Sample[],
  maxSpreadDeg = CALIBRATION_MAX_SPREAD_DEG,
): CalibrationResult {
  if (samples.length < 20)
    return { ok: false, reason: "too-few", spreadDeg: 0 };
  const sum = samples.reduce(
    (acc, s) => ({ x: acc.x + s.ax, y: acc.y + s.ay, z: acc.z + s.az }),
    {
      x: 0,
      y: 0,
      z: 0,
    },
  );
  const g0 = unit(sum);
  const offs = samples
    .map((s) => angleBetweenDeg(accel(s), g0))
    .sort((a, b) => a - b);
  const spreadDeg = offs[Math.floor(offs.length * 0.95)];
  if (spreadDeg > maxSpreadDeg)
    return { ok: false, reason: "moved", spreadDeg };
  return { ok: true, g0, spreadDeg, samples: samples.length };
}

export interface AngleOut {
  angleDeg: number; // fused angle from the calibrated start (always >= 0)
  tiltDeg: number; // accelerometer-only angle, for debugging
  velDegS: number; // how fast the segment rotates relative to gravity, any direction
}

/** α = 0.98 from the brief: trust the gyro for fast changes, let gravity correct the drift. */
export const ALPHA = 0.98;
/** Below this tilt the angle's direction is undefined (sin θ ≈ 0), so use tilt only. */
const SMALL_DEG = 3;

export class TiltFilter {
  private angle = 0;
  private prevT: number | null = null;
  private prevTilt = 0;
  /**
   * Browsers do not agree on the sign of rotationRate. Rather than hard-coding per platform,
   * we learn it: compare the gyro-predicted change with the accelerometer change while the
   * arm moves. Until enough evidence, the filter runs on the accelerometer only.
   */
  gyroSign: 1 | -1 | 0 = 0;
  private signEvidence = 0;
  private signVotes = 0;

  private g0: Vec3;
  private alpha: number;

  constructor(g0: Vec3, alpha = ALPHA) {
    this.g0 = g0;
    this.alpha = alpha;
  }

  update(s: Sample): AngleOut {
    const g = unit(accel(s));
    const tiltDeg = Math.acos(Math.max(-1, Math.min(1, dot(g, this.g0)))) * DEG;
    const w = scale(gyro(s), 1 / DEG); // rad/s

    // Rotation speed that actually changes the tilt: the gyro part perpendicular to gravity.
    const wPerp = sub(w, scale(g, dot(w, g)));
    const velDegS = norm(wPerp) * DEG;

    const dt = this.prevT === null ? 0 : (s.t - this.prevT) / 1000;
    this.prevT = s.t;

    if (dt <= 0 || dt > 0.1 || tiltDeg < SMALL_DEG) {
      // First sample, a gap (dropped samples), or near the start pose: trust gravity.
      this.angle = tiltDeg;
    } else {
      // Gravity seen from the phone turns opposite to the phone: dg/dt = -ω × g.
      // θ = acos(g·g0)  =>  dθ/dt = -(dg/dt · g0) / sin θ.
      const dg = scale(cross(w, g), -1);
      const predicted = (-dot(dg, this.g0) / Math.sin(tiltDeg / DEG)) * DEG; // °/s
      this.learnSign(predicted, (tiltDeg - this.prevTilt) / dt, tiltDeg);
      this.angle =
        this.gyroSign === 0
          ? tiltDeg
          : this.alpha * (this.angle + this.gyroSign * predicted * dt) +
            (1 - this.alpha) * tiltDeg;
    }
    this.prevTilt = tiltDeg;
    return { angleDeg: Math.max(0, this.angle), tiltDeg, velDegS };
  }

  private learnSign(
    predicted: number,
    observed: number,
    tiltDeg: number,
  ): void {
    // Only clear movements count (tuned by testing): slow drift and noise vote nothing.
    if (this.gyroSign !== 0 || tiltDeg < 10 || Math.abs(observed) < 20) return;
    this.signEvidence += Math.sign(predicted * observed);
    this.signVotes++;
    if (this.signVotes >= 15) this.gyroSign = this.signEvidence >= 0 ? 1 : -1;
  }
}
