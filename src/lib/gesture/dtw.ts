// Dynamic time warping (Sakoe & Chiba 1978) over our 2-channel frames.
// Every segment is first resampled to the same length so a slow and a fast "halo" compare well,
// and so DTW cost is the same for every comparison (32 x 32 cells).
//
// Speed (see docs/NOTES.md, "faster recognition"):
//  - frames are packed into flat Float32Arrays once (no per-cell array allocations);
//  - two rolling rows instead of a full matrix;
//  - early abandoning (UCR suite, Rakthanmanon et al. KDD 2012): once a whole row is already
//    more expensive than `abandonAbove`, the final cost can only be higher, so stop.
//  - open-end mode (Tormene et al. 2009): match a *partial* gesture against the best-fitting
//    *prefix* of a template, so a word can be recognised before the hand stops.
import { FACE_DIM } from "./face";
import type { Frame } from "./features";

export const RESAMPLE_N = 32;
/** A frame with a hand vs one without: fixed cost (hand present is itself information). */
const MISSING_HAND_COST = 2;
const HAND_DIM = 63;
const IMU_DIM = 6;
const SQRT21 = Math.sqrt(21);

export function resample(frames: Frame[], n = RESAMPLE_N): Frame[] {
  if (frames.length === 0) return [];
  const out: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i * (frames.length - 1)) / Math.max(1, n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(frames.length - 1, lo + 1);
    const k = pos - lo;
    const a = frames[lo];
    const b = frames[hi];
    const lerp = (x: number[], y: number[]) =>
      x.map((v, j) => v + (y[j] - v) * k);
    out.push({
      t: a.t + (b.t - a.t) * k,
      imu: lerp(a.imu, b.imu),
      // Interpolate hands only when both frames have one; otherwise take the nearer frame.
      hand: a.hand && b.hand ? lerp(a.hand, b.hand) : k < 0.5 ? a.hand : b.hand,
      face: a.face && b.face ? lerp(a.face, b.face) : k < 0.5 ? a.face : b.face,
    });
  }
  return out;
}

export interface Weights {
  hand: number;
  imu: number; // 0 when the phone is propped on a stand (camera only)
  face?: number; // 0 / absent = face ignored
}

/** Frames as flat typed arrays: what the DTW inner loop actually reads. */
export interface Packed {
  n: number;
  durationMs: number;
  hand: Float32Array; // n * 63
  imu: Float32Array; // n * 6
  has: Uint8Array; // 1 = hand visible in this frame
  face: Float32Array; // n * FACE_DIM
  hasFace: Uint8Array;
}

export function pack(frames: Frame[]): Packed {
  const n = frames.length;
  const p: Packed = {
    n,
    durationMs: n > 1 ? frames[n - 1].t - frames[0].t : 0,
    hand: new Float32Array(n * HAND_DIM),
    imu: new Float32Array(n * IMU_DIM),
    has: new Uint8Array(n),
    face: new Float32Array(n * FACE_DIM),
    hasFace: new Uint8Array(n),
  };
  frames.forEach((f, i) => {
    p.imu.set(f.imu, i * IMU_DIM);
    if (f.hand) {
      p.hand.set(f.hand, i * HAND_DIM);
      p.has[i] = 1;
    }
    if (f.face) {
      p.face.set(f.face, i * FACE_DIM);
      p.hasFace[i] = 1;
    }
  });
  return p;
}

function cellCost(
  a: Packed,
  i: number,
  b: Packed,
  j: number,
  w: Weights,
): number {
  let hand = 0;
  if (w.hand) {
    if (a.has[i] && b.has[j]) {
      let s = 0;
      const ai = i * HAND_DIM;
      const bj = j * HAND_DIM;
      for (let k = 0; k < HAND_DIM; k++) {
        const d = a.hand[ai + k] - b.hand[bj + k];
        s += d * d;
      }
      hand = Math.sqrt(s) / SQRT21; // per-landmark scale
    } else if (a.has[i] || b.has[j]) hand = MISSING_HAND_COST;
  }
  let imu = 0;
  if (w.imu) {
    let s = 0;
    const ai = i * IMU_DIM;
    const bj = j * IMU_DIM;
    for (let k = 0; k < IMU_DIM; k++) {
      const d = a.imu[ai + k] - b.imu[bj + k];
      s += d * d;
    }
    imu = Math.sqrt(s);
  }
  // Face is optional: compared only when both frames have one, never penalised when missing
  // (face tracking may be off, or the face briefly hidden by the signing hand).
  let face = 0;
  if (w.face && a.hasFace[i] && b.hasFace[j]) {
    let s = 0;
    const ai = i * FACE_DIM;
    const bj = j * FACE_DIM;
    for (let k = 0; k < FACE_DIM; k++) {
      const d = a.face[ai + k] - b.face[bj + k];
      s += d * d;
    }
    face = Math.sqrt(s / FACE_DIM);
  }
  return w.hand * hand + w.imu * imu + (w.face ?? 0) * face;
}

export interface DtwResult {
  cost: number; // cost per step of the best path (Infinity if abandoned)
  progress: number; // open-end: fraction of the template matched (1 for closed-end)
}

/**
 * DTW with a Sakoe-Chiba band (fraction of length).
 * openEnd: `a` may match only a prefix of `b` (a gesture still in progress).
 */
export function dtwPacked(
  a: Packed,
  b: Packed,
  w: Weights,
  opts: { band?: number; openEnd?: boolean; abandonAbove?: number } = {},
): DtwResult {
  const {
    band = 0.25,
    openEnd = false,
    abandonAbove = Number.POSITIVE_INFINITY,
  } = opts;
  const n = a.n;
  const m = b.n;
  const INF = Number.POSITIVE_INFINITY;
  if (!n || !m) return { cost: INF, progress: 0 };
  const r = Math.max(
    1,
    Math.ceil(band * Math.max(n, m)),
    openEnd ? 0 : Math.abs(n - m),
  );
  // Any path's cumulative cost only grows, and the final normaliser is at most n + m,
  // so (row minimum) / (n + m) is a lower bound of the final normalised cost.
  const abandonRaw = abandonAbove * (n + m);
  let prev = new Float64Array(m + 1).fill(INF);
  let cur = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    let rowMin = INF;
    const lo = Math.max(1, i - r);
    const hi = Math.min(m, i + r);
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(prev[j], cur[j - 1], prev[j - 1]);
      if (best === INF) continue;
      const v = cellCost(a, i - 1, b, j - 1, w) + best;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > abandonRaw) return { cost: INF, progress: 0 };
    [prev, cur] = [cur, prev];
  }
  if (!openEnd) return { cost: prev[m] / (n + m), progress: 1 };
  let bestCost = INF;
  let bestJ = 0;
  for (let j = 1; j <= m; j++) {
    const c = prev[j] / (n + j);
    if (c < bestCost) {
      bestCost = c;
      bestJ = j;
    }
  }
  return { cost: bestCost, progress: bestJ / m };
}

/** Convenience wrapper on unpacked frames (tests, one-off comparisons). */
export function dtw(a: Frame[], b: Frame[], w: Weights, band = 0.25): number {
  return dtwPacked(pack(a), pack(b), w, { band }).cost;
}
