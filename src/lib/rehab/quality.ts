// Descriptive movement-quality summary of ONE session, for the therapist / nurse to read.
//
// Hard rules (AGENTS.md): these are descriptions, not a recovery score, not a diagnosis, and they
// never change the program. Adherence is shown elsewhere and never mixed in here.
//
// What each number is and where it comes from:
// - smoothness: median SPARC over reps (see sparc.ts; Balasubramanian et al. 2015). Median, not
//   mean, so one interrupted rep does not dominate.
// - consistency: coefficient of variation (SD / mean) of each rep's peak angle. Low = the reps
//   reached a similar height. Plain statistics, no clinical cut-off.
// - trend: median peak of the last third of reps minus median peak of the first third. A drop
//   late in a session is something a therapist may want to look at (e.g. fatigue), but the app
//   does not say why it happened.
// Minimum reps for each figure: 3 (anything less is not a pattern). Tuned by judgement, not
// from literature.
import type { RepRecord } from "./summary";

export interface SessionQuality {
  reps: number;
  smoothnessSparc: number | null;
  consistencyCv: number | null;
  peakTrendDeg: number | null;
  medianPeakDeg: number | null;
  medianRepMs: number | null;
}

const MIN_REPS = 3;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const r2 = (x: number | null) =>
  x === null ? null : Math.round(x * 100) / 100;

export function sessionQuality(reps: readonly RepRecord[]): SessionQuality {
  const n = reps.length;
  const peaks = reps.map((r) => r.peakDeg);
  const sparcs = reps
    .map((r) => r.sparc)
    .filter((x): x is number => typeof x === "number");

  let cv: number | null = null;
  let trend: number | null = null;
  if (n >= MIN_REPS) {
    const mean = peaks.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(peaks.reduce((a, p) => a + (p - mean) ** 2, 0) / n);
    cv = mean > 0 ? sd / mean : null;
    const third = Math.max(1, Math.floor(n / 3));
    const a = median(peaks.slice(0, third));
    const b = median(peaks.slice(n - third));
    trend = a !== null && b !== null ? b - a : null;
  }
  return {
    reps: n,
    smoothnessSparc: sparcs.length >= MIN_REPS ? r2(median(sparcs)) : null,
    consistencyCv: r2(cv),
    peakTrendDeg: r1(trend),
    medianPeakDeg: r1(median(peaks)),
    medianRepMs: median(reps.map((r) => r.durMs)),
  };
}
