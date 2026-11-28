// SPARC (spectral arc length): a movement-smoothness number for one movement (one rep).
//
// Source: Balasubramanian, Melendez-Calderon, Roby-Brami, Burdet. "On the analysis of movement
// smoothness." J NeuroEng Rehabil 12:112 (2015), doi:10.1186/s12984-015-0090-9. The parameters
// below (zero-padding 4, cut-off 10 Hz, amplitude threshold 0.05) are the paper's defaults.
// Why SPARC and not "count the velocity peaks" (Rohrer 2002): the 2015 review shows peak counts
// and jerk-based measures are sensitive to noise and movement duration; SPARC is the one they
// recommend as valid, consistent and robust. Melendez-Calderon et al. (2021) add that SPARC is
// valid on gyroscope ANGULAR velocity (what we have), not on velocity integrated from an
// accelerometer (which drifts, and which we never compute).
//
// Reading the number: it is always negative; closer to 0 = smoother. One minimum-jerk movement
// (the textbook smooth reach) gives -1.40 with these parameters (tests/live.test.ts); the same
// movement split into 3 sub-movements gives -2.84. This is DESCRIPTIVE only. It is not a recovery score, not a diagnosis,
// and the app never acts on it: the therapist decides what it means for this patient.

const PAD_LEVEL = 4;
const CUTOFF_HZ = 10;
const AMP_THRESHOLD = 0.05;
/** Resample rate: phones deliver uneven intervals; the FFT needs a uniform grid. */
export const SPARC_FS = 50;

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** SPARC of a uniformly sampled speed profile (any unit; it is normalised). */
export function sparc(speed: ArrayLike<number>, fs: number): number | null {
  const len = speed.length;
  if (len < 4) return null;
  const nfft = 2 ** (Math.ceil(Math.log2(len)) + PAD_LEVEL);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < len; i++) re[i] = speed[i];
  fft(re, im);

  // Magnitude spectrum up to the cut-off, normalised to its maximum.
  const df = fs / nfft;
  const kMax = Math.floor(CUTOFF_HZ / df);
  const mag: number[] = [];
  let peak = 0;
  for (let k = 0; k <= kMax && k < nfft; k++) {
    const m = Math.hypot(re[k], im[k]);
    mag.push(m);
    if (m > peak) peak = m;
  }
  if (peak === 0) return null;
  for (let k = 0; k < mag.length; k++) mag[k] /= peak;

  // Adaptive cut-off: keep the band from the first to the last bin above the threshold.
  let first = -1;
  let last = -1;
  for (let k = 0; k < mag.length; k++)
    if (mag[k] >= AMP_THRESHOLD) {
      if (first < 0) first = k;
      last = k;
    }
  if (first < 0 || last <= first) return null;
  const span = (last - first) * df;
  let arc = 0;
  for (let k = first + 1; k <= last; k++) {
    const dfNorm = df / span;
    const dm = mag[k] - mag[k - 1];
    arc += Math.sqrt(dfNorm * dfNorm + dm * dm);
  }
  return -arc;
}

/**
 * Linear resampling of (t ms, v) points onto a uniform grid at `fs` Hz. Phones report uneven
 * sample intervals (docs/NOTES.md), so we never assume a fixed rate.
 */
export function resample(
  points: readonly (readonly [number, number])[],
  fs = SPARC_FS,
): number[] {
  if (points.length < 2) return points.map((p) => p[1]);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const step = 1000 / fs;
  const out: number[] = [];
  let j = 0;
  for (let t = t0; t <= t1; t += step) {
    while (j < points.length - 2 && points[j + 1][0] < t) j++;
    const [ta, va] = points[j];
    const [tb, vb] = points[j + 1];
    const w = tb === ta ? 0 : (t - ta) / (tb - ta);
    out.push(va + (vb - va) * Math.min(1, Math.max(0, w)));
  }
  return out;
}

/** SPARC of one rep from raw (t ms, angular speed °/s) samples. */
export function repSparc(
  points: readonly (readonly [number, number])[],
): number | null {
  const v = resample(points, SPARC_FS);
  const s = sparc(v, SPARC_FS);
  return s === null ? null : Math.round(s * 100) / 100;
}
