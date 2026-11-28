// Per-patient overview numbers for the nurse dashboard, computed from stored session summaries.
// Pure (no DB, no React) so it is unit-tested and the same code serves phone and desktop.
//
// What this is: a work list. It answers "who should I look at first, and what changed?" from
// facts already recorded (alerts, missed days, limit breaches, "cannot do" logs).
// What this is NOT: a recovery score, a diagnosis, or a recommendation to change a program
// (AGENTS.md hard rules). Adherence (session counts) is kept apart from movement numbers.
//
// Algorithms:
// - Trend of peak angle per exercise: Theil–Sen estimator, the median of all pairwise slopes
//   (Theil 1950; Sen, J Am Stat Assoc 63:1379, 1968). Chosen over least squares because one
//   odd session (strap slipped, wrong placement) would tilt a least-squares line; Theil–Sen
//   tolerates up to ~29% outliers. Needs >= MIN_TREND_POINTS sessions.
// - Smoothness: median of the per-session SPARC medians (src/lib/rehab/sparc.ts).
// - Flags: plain rules on counts. Every threshold below is a WORKFLOW setting (when to put a
//   patient higher on the list), ILLUSTRATIVE, not clinical, and the team can change it.

export const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 28;
/** ILLUSTRATIVE workflow thresholds, not clinical. */
export const INACTIVE_DAYS = 3;
export const CANNOT_DO_FLAG = 2;
export const BREACH_RISE_MIN = 2;
export const ROM_DROP_DEG_PER_WEEK = -5;
export const MIN_TREND_POINTS = 4;

export type SessionStatus = "COMPLETED" | "CANNOT_DO" | "POSTPONED";

export interface SessionFact {
  startedAt: string;
  status: SessionStatus;
  exercise: string; // display name
  reportedBy: "PATIENT" | "CAREGIVER";
  reps: number | null;
  activeMs: number | null;
  maxAngleDeg: number | null;
  maxVelDegPerS: number | null;
  pauses: number | null;
  sparc: number | null;
  breaches: number;
}

export interface PatientFacts {
  id: string;
  displayName: string;
  pendingAlerts: number;
  exercisesWithoutEnvelope: string[];
  sessions: SessionFact[]; // last WINDOW_DAYS days, any order
}

export type FlagLevel = "high" | "medium" | "info";

export interface Flag {
  code:
    | "help"
    | "alert"
    | "inactive"
    | "never"
    | "breach-rise"
    | "cannot-do"
    | "no-envelope"
    | "rom-drop";
  level: FlagLevel;
  text: string;
}

export interface ExerciseTrend {
  exercise: string;
  sessions: number;
  latestMaxDeg: number | null;
  medianMaxDeg: number | null;
  /** Theil–Sen slope of session peak angle, degrees per week. Null with too few sessions. */
  slopeDegPerWeek: number | null;
  smoothnessSparc: number | null;
  series: { t: string; maxDeg: number }[];
}

export interface PatientOverview {
  id: string;
  displayName: string;
  priority: number;
  flags: Flag[];
  lastSessionAt: string | null;
  daysSinceLast: number | null;
  /** Sessions per day, index 0 = last 24 h, 6 = six days ago. Adherence only. */
  days7: number[];
  sessions7: number;
  sessionsPrev7: number;
  completed7: number;
  cannotDo7: number;
  postponed7: number;
  byCaregiver7: number;
  activeMinutes7: number;
  reps7: number;
  breaches7: number;
  breachesPrev7: number;
  /** Breaches per completed session in the last 7 days. */
  breachRate7: number | null;
  pendingAlerts: number;
  trends: ExerciseTrend[];
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Theil–Sen slope of y over x. Pairs with equal x are skipped. Null below `min` points. */
export function theilSen(
  pts: readonly { x: number; y: number }[],
  min = MIN_TREND_POINTS,
): number | null {
  if (pts.length < min) return null;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      if (dx !== 0) slopes.push((pts[j].y - pts[i].y) / dx);
    }
  return median(slopes);
}

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export function overview(p: PatientFacts, now = Date.now()): PatientOverview {
  const age = (s: SessionFact) => (now - Date.parse(s.startedAt)) / DAY_MS;
  const inWin = p.sessions.filter((s) => age(s) >= 0 && age(s) < WINDOW_DAYS);
  const last7 = inWin.filter((s) => age(s) < 7);
  const prev7 = inWin.filter((s) => age(s) >= 7 && age(s) < 14);

  const days7 = Array.from({ length: 7 }, () => 0);
  for (const s of last7) days7[Math.floor(age(s))]++;

  const sorted = [...inWin].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const last = sorted.at(-1) ?? null;
  const daysSinceLast = last ? Math.floor(age(last)) : null;

  const completed7 = last7.filter((s) => s.status === "COMPLETED");
  const sum = (xs: SessionFact[], f: (s: SessionFact) => number | null) =>
    xs.reduce((a, s) => a + (f(s) ?? 0), 0);
  const breaches7 = sum(last7, (s) => s.breaches);
  const breachesPrev7 = sum(prev7, (s) => s.breaches);

  // Per-exercise trend from COMPLETED sessions with a measured peak.
  const byEx = new Map<string, SessionFact[]>();
  for (const s of sorted)
    if (s.status === "COMPLETED" && s.maxAngleDeg !== null)
      byEx.set(s.exercise, [...(byEx.get(s.exercise) ?? []), s]);
  const trends: ExerciseTrend[] = [...byEx.entries()].map(([exercise, xs]) => {
    const slopePerDay = theilSen(
      xs.map((s) => ({
        x: Date.parse(s.startedAt) / DAY_MS,
        y: s.maxAngleDeg as number,
      })),
    );
    return {
      exercise,
      sessions: xs.length,
      latestMaxDeg: r1(xs.at(-1)?.maxAngleDeg ?? null),
      medianMaxDeg: r1(median(xs.map((s) => s.maxAngleDeg as number))),
      slopeDegPerWeek: slopePerDay === null ? null : r1(slopePerDay * 7),
      smoothnessSparc: (() => {
        const m = median(
          xs.map((s) => s.sparc).filter((x): x is number => x !== null),
        );
        return m === null ? null : Math.round(m * 100) / 100;
      })(),
      series: xs.map((s) => ({
        t: s.startedAt,
        maxDeg: s.maxAngleDeg as number,
      })),
    };
  });

  const flags: Flag[] = [];
  if (p.pendingAlerts > 0)
    flags.push({
      code: "alert",
      level: "high",
      text: `${p.pendingAlerts} peringatan batas belum ditangani`,
    });
  if (!last)
    flags.push({
      code: "never",
      level: "medium",
      text: `Belum ada sesi dalam ${WINDOW_DAYS} hari`,
    });
  else if ((daysSinceLast ?? 0) >= INACTIVE_DAYS)
    flags.push({
      code: "inactive",
      level: "medium",
      text: `${daysSinceLast} hari tanpa sesi`,
    });
  if (breaches7 >= BREACH_RISE_MIN && breaches7 > breachesPrev7)
    flags.push({
      code: "breach-rise",
      level: "medium",
      text: `Melewati batas ${breaches7}x minggu ini (minggu lalu ${breachesPrev7})`,
    });
  const cannot7 = last7.filter((s) => s.status === "CANNOT_DO").length;
  if (cannot7 >= CANNOT_DO_FLAG)
    flags.push({
      code: "cannot-do",
      level: "medium",
      text: `${cannot7}x "tidak bisa" minggu ini`,
    });
  for (const t of trends)
    if (
      t.slopeDegPerWeek !== null &&
      t.slopeDegPerWeek <= ROM_DROP_DEG_PER_WEEK
    )
      flags.push({
        code: "rom-drop",
        level: "info",
        text: `${t.exercise}: puncak sudut tercatat turun ${Math.abs(t.slopeDegPerWeek)}°/minggu`,
      });
  if (p.exercisesWithoutEnvelope.length)
    flags.push({
      code: "no-envelope",
      level: "info",
      text: `Belum ada batas: ${p.exercisesWithoutEnvelope.join(", ")}`,
    });

  const weight = { high: 100, medium: 10, info: 1 } as const;
  return {
    id: p.id,
    displayName: p.displayName,
    priority: flags.reduce((a, f) => a + weight[f.level], 0),
    flags,
    lastSessionAt: last?.startedAt ?? null,
    daysSinceLast,
    days7,
    sessions7: last7.length,
    sessionsPrev7: prev7.length,
    completed7: completed7.length,
    cannotDo7: cannot7,
    postponed7: last7.filter((s) => s.status === "POSTPONED").length,
    byCaregiver7: last7.filter((s) => s.reportedBy === "CAREGIVER").length,
    activeMinutes7: Math.round(sum(last7, (s) => s.activeMs) / 60_000),
    reps7: sum(last7, (s) => s.reps),
    breaches7,
    breachesPrev7,
    breachRate7: completed7.length
      ? Math.round((breaches7 / completed7.length) * 100) / 100
      : null,
    pendingAlerts: p.pendingAlerts,
    trends,
  };
}

/** Highest priority first; ties: longest without a session first, then name. */
export function sortForTriage(list: PatientOverview[]): PatientOverview[] {
  return [...list].sort(
    (a, b) =>
      b.priority - a.priority ||
      (b.daysSinceLast ?? 999) - (a.daysSinceLast ?? 999) ||
      a.displayName.localeCompare(b.displayName),
  );
}
