import { describe, expect, test } from "bun:test";
import {
  DAY_MS,
  overview,
  type SessionFact,
  sortForTriage,
  theilSen,
} from "../src/lib/care/triage";

const NOW = Date.parse("2026-11-28T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();
const ses = (daysAgo: number, p: Partial<SessionFact> = {}): SessionFact => ({
  startedAt: at(daysAgo),
  status: "COMPLETED",
  exercise: "Fleksi bahu",
  reportedBy: "PATIENT",
  reps: 10,
  activeMs: 120_000,
  maxAngleDeg: 80,
  maxVelDegPerS: 90,
  pauses: 0,
  sparc: -1.6,
  breaches: 0,
  ...p,
});
const base = {
  id: "p",
  displayName: "P",
  pendingAlerts: 0,
  exercisesWithoutEnvelope: [],
};

describe("Theil–Sen trend", () => {
  test("ignores one outlier that would tilt least squares", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x }));
    pts[5] = { x: 5, y: -100 }; // one broken session
    expect(theilSen(pts)).toBe(2);
  });
  test("needs enough points", () => {
    expect(
      theilSen([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });
});

describe("overview", () => {
  test("adherence counts stay separate from movement numbers", () => {
    const o = overview(
      {
        ...base,
        sessions: [
          ses(0.2),
          ses(1.5, { status: "CANNOT_DO", maxAngleDeg: null }),
          ses(1.6, { status: "CANNOT_DO", maxAngleDeg: null }),
          ses(8),
          ses(30), // outside the 28-day window
        ],
      },
      NOW,
    );
    expect(o.sessions7).toBe(3);
    expect(o.sessionsPrev7).toBe(1);
    expect(o.days7).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(o.cannotDo7).toBe(2);
    expect(o.flags.map((f) => f.code)).toContain("cannot-do");
    expect(o.trends[0].sessions).toBe(2); // only COMPLETED with a measured peak
  });

  test("weekly trend of peak angle from Theil–Sen", () => {
    const sessions = [21, 14, 7, 0].map((d, i) =>
      ses(d, { maxAngleDeg: 60 + i * 7 }),
    );
    const o = overview({ ...base, sessions }, NOW);
    expect(o.trends[0].slopeDegPerWeek).toBe(7);
    expect(o.trends[0].latestMaxDeg).toBe(81);
  });

  test("falling peaks are flagged as information, never as a judgement", () => {
    const sessions = [21, 14, 7, 0].map((d, i) =>
      ses(d, { maxAngleDeg: 90 - i * 10 }),
    );
    const f = overview({ ...base, sessions }, NOW).flags.find(
      (x) => x.code === "rom-drop",
    );
    expect(f?.level).toBe("info");
  });

  test("pending alerts outrank inactivity, which outranks nothing", () => {
    const a = overview(
      {
        ...base,
        id: "a",
        displayName: "A",
        pendingAlerts: 1,
        sessions: [ses(0)],
      },
      NOW,
    );
    const b = overview(
      { ...base, id: "b", displayName: "B", sessions: [ses(5)] },
      NOW,
    );
    const c = overview(
      { ...base, id: "c", displayName: "C", sessions: [ses(0)] },
      NOW,
    );
    expect(b.flags.map((f) => f.code)).toEqual(["inactive"]);
    expect(sortForTriage([c, b, a]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("breach rise only when it actually rose", () => {
    const up = overview(
      {
        ...base,
        sessions: [
          ses(1, { breaches: 2 }),
          ses(2, { breaches: 1 }),
          ses(9, { breaches: 1 }),
        ],
      },
      NOW,
    );
    expect(up.breaches7).toBe(3);
    expect(up.breachRate7).toBe(1.5);
    expect(up.flags.some((f) => f.code === "breach-rise")).toBe(true);
    const flat = overview(
      { ...base, sessions: [ses(1, { breaches: 2 }), ses(9, { breaches: 3 })] },
      NOW,
    );
    expect(flat.flags.some((f) => f.code === "breach-rise")).toBe(false);
  });

  test("no sessions at all", () => {
    const o = overview({ ...base, sessions: [] }, NOW);
    expect(o.daysSinceLast).toBeNull();
    expect(o.flags[0].code).toBe("never");
  });
});
