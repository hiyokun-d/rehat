import { describe, expect, test } from "bun:test";
import { calibrate } from "../src/lib/rehab/angle";
import { EnvelopeChecker } from "../src/lib/rehab/envelope";
import { RepCounter } from "../src/lib/rehab/reps";
import { RehabSession } from "../src/lib/rehab/session";
import { syntheticFlexion } from "../src/lib/sensor/synthetic";

function run(samples: ReturnType<typeof syntheticFlexion>) {
  const s = new RehabSession();
  s.beginCalibration();
  for (const x of samples) s.sample(x);
  return { s };
}

describe("calibration", () => {
  test("accepts a still phone", () => {
    expect(calibrate(syntheticFlexion({ reps: 0, stillMs: 3000 })).ok).toBe(
      true,
    );
  });
  test("accepts normal hand tremor (small noise)", () => {
    // ~0.3 m/s² noise on gravity ≈ 2° jitter: a human arm, not a table.
    expect(
      calibrate(syntheticFlexion({ reps: 0, stillMs: 3000, noise: 0.6 })).ok,
    ).toBe(true);
  });
  test("rejects a moving phone", () => {
    expect(calibrate(syntheticFlexion({ stillMs: 0, reps: 1 }))).toMatchObject({
      ok: false,
      reason: "moved",
    });
  });
});

describe("steady-streak calibration in a session", () => {
  test("movement first, then still: succeeds without a retry", () => {
    const s = new RehabSession();
    s.beginCalibration();
    const moving = syntheticFlexion({ stillMs: 0, reps: 1, repMs: 2000 });
    const still = syntheticFlexion({ reps: 0, stillMs: 3500 }).map((x) => ({
      ...x,
      t: x.t + 2100,
    }));
    const results = [...moving, ...still]
      .map((x) => s.sample(x).calibration)
      .filter(Boolean);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(s.phase).toBe("running");
  });
  test("never still: fails after the timeout", () => {
    const s = new RehabSession();
    s.beginCalibration();
    const r = syntheticFlexion({ stillMs: 0, reps: 5, repMs: 2500 })
      .map((x) => s.sample(x).calibration)
      .filter(Boolean);
    expect(r[0]?.ok).toBe(false);
    expect(s.phase).toBe("idle");
  });
});

describe("angle + reps on synthetic flexion", () => {
  for (const gyroSign of [1, -1] as const) {
    for (const accelSign of [1, -1] as const) {
      test(`gyroSign=${gyroSign} accelSign=${accelSign}: peak ~80°, 3 reps`, () => {
        const { s } = run(
          syntheticFlexion({ gyroSign, accelSign, peakDeg: 80, reps: 3 }),
        );
        const snap = s.snapshot();
        expect(snap.reps).toBe(3);
        expect(Math.abs(snap.maxAngleDeg - 80)).toBeLessThan(3);
        expect(snap.gyroSign).not.toBe(0);
      });
    }
  }
});

describe("envelope", () => {
  test("fires once per episode, only after debounce", () => {
    const e = new EnvelopeChecker({
      maxAngleDeg: 50,
      maxVelDegPerS: 1000,
      debounceMs: 300,
    });
    expect(e.update(0, 60, 0)).toBeNull();
    expect(e.update(200, 60, 0)).toBeNull();
    expect(e.update(310, 60, 0)).toMatchObject({
      kind: "angle",
      value: 60,
      limit: 50,
    });
    expect(e.update(400, 61, 0)).toBeNull(); // same episode
    expect(e.update(500, 40, 0)).toBeNull(); // back inside: re-arm
    expect(e.update(600, 60, 0)).toBeNull();
    expect(e.update(950, 60, 0)).not.toBeNull();
  });
  test("a short spike does not fire", () => {
    const e = new EnvelopeChecker({
      maxAngleDeg: 50,
      maxVelDegPerS: 1000,
      debounceMs: 300,
    });
    expect(e.update(0, 70, 0)).toBeNull();
    expect(e.update(100, 70, 0)).toBeNull();
    expect(e.update(150, 30, 0)).toBeNull();
    expect(e.update(500, 70, 0)).toBeNull();
  });
  test("session reports an angle breach on synthetic data", () => {
    const s = new RehabSession({
      exercise: "shoulder-flexion",
      envelope: { maxAngleDeg: 60, maxVelDegPerS: 1000, debounceMs: 200 },
      reps: { upDeg: 30, downDeg: 10 },
    });
    s.beginCalibration();
    const breaches = syntheticFlexion({ peakDeg: 80, reps: 2 })
      .map((x) => s.sample(x).breach)
      .filter(Boolean);
    expect(breaches.length).toBe(2);
  });
});

describe("reps hysteresis", () => {
  test("noise around one threshold does not double count", () => {
    const r = new RepCounter({ upDeg: 30, downDeg: 10 });
    for (const a of [0, 29, 31, 29, 31, 29, 31, 12, 11, 9, 11, 9]) r.update(a);
    expect(r.count).toBe(1);
  });
});

describe("sensor lost", () => {
  test("pauses a running session and resumes", () => {
    const s = new RehabSession();
    s.beginCalibration();
    for (const x of syntheticFlexion({ reps: 0, stillMs: 3200 })) s.sample(x);
    expect(s.phase).toBe("running");
    s.status("lost");
    expect(s.phase).toBe("paused");
    s.resume();
    expect(s.phase).toBe("running");
  });
});
