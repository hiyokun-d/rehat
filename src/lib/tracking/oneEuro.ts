// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff rises with
// speed. Still hand -> heavy smoothing (no webcam jitter); fast hand -> light smoothing (no lag).
// Used for DRAWING only: the recognisers get raw landmarks, as they were trained/recorded.

const alpha = (cutoffHz: number, dtS: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

export interface OneEuroConfig {
  minCutoff: number; // Hz, smoothing when still (lower = smoother)
  beta: number; // how fast the cutoff rises with speed (higher = less lag)
  dCutoff: number; // Hz, smoothing of the speed estimate
}

/** Tuned by testing for normalised image coordinates (0..1), not from the paper. */
export const DEFAULT_ONE_EURO: OneEuroConfig = {
  minCutoff: 1.5,
  beta: 8,
  dCutoff: 1,
};

export class OneEuro {
  cfg: OneEuroConfig;
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(cfg: OneEuroConfig = DEFAULT_ONE_EURO) {
    this.cfg = cfg;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null || !Number.isFinite(this.x)) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.cfg.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

type P = { x: number; y: number };

/** One Euro per point and axis, for a whole landmark set (e.g. a hand). Resets when it disappears. */
export class PointsSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];

  smooth<T extends P>(pts: T[] | undefined, tMs: number): T[] | undefined {
    if (!pts?.length) {
      for (const f of [...this.fx, ...this.fy]) f.reset();
      return pts;
    }
    return pts.map((p, i) => {
      if (!Number.isFinite(p.x)) return p; // sparse face arrays (mirror) keep NaN holes
      this.fx[i] ??= new OneEuro();
      this.fy[i] ??= new OneEuro();
      return {
        ...p,
        x: this.fx[i].filter(p.x, tMs),
        y: this.fy[i].filter(p.y, tMs),
      };
    });
  }
}
