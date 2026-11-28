// Multi-phone fusion, placements, live message parsing, SPARC and session quality, security
// helpers. All pure; no network.
import { describe, expect, test } from "bun:test";
import {
  duplicateDisagreement,
  fuseJoint,
  jointsFor,
  MAX_AGE_MS,
  type SegmentReading,
} from "../src/lib/live/fusion";
import {
  isPlacement,
  normalizePlacement,
  placementLabel,
} from "../src/lib/live/placement";
import { parseLiveMsg, patientTopic } from "../src/lib/live/protocol";
import { sessionQuality } from "../src/lib/rehab/quality";
import { DEFAULT_CONFIG } from "../src/lib/rehab/session";
import { repSparc, resample, sparc } from "../src/lib/rehab/sparc";
import { SessionRecorder } from "../src/lib/rehab/summary";
import { isCrossSiteWrite, securityHeaders } from "../src/lib/security/headers";

const r = (
  deviceId: string,
  segment: SegmentReading["placement"]["segment"],
  side: "L" | "R",
  angleDeg: number,
  receivedAt = 1000,
  phase = "running",
): SegmentReading => ({
  deviceId,
  placement: { segment, side },
  angleDeg,
  phase,
  receivedAt,
});

describe("fusion: two phones -> joint estimate (experiment)", () => {
  test("elbow = forearm tilt - upper arm tilt", () => {
    const out = fuseJoint(
      r("a", "upper-arm", "R", 10),
      r("b", "forearm", "R", 70),
      1000,
    );
    expect(out).toEqual({
      status: "ok",
      angleDeg: 60,
      proximalDeg: 10,
      distalDeg: 70,
    });
  });
  test("never negative", () => {
    const out = fuseJoint(
      r("a", "upper-arm", "R", 40),
      r("b", "forearm", "R", 30),
      1000,
    );
    expect(out.status === "ok" && out.angleDeg).toBe(0);
  });
  test("missing, stale and not-running are reported, not guessed", () => {
    expect(fuseJoint(undefined, r("b", "forearm", "R", 30), 1000).status).toBe(
      "missing",
    );
    expect(
      fuseJoint(
        r("a", "upper-arm", "R", 0, 0),
        r("b", "forearm", "R", 30, 1000),
        MAX_AGE_MS + 1,
      ).status,
    ).toBe("stale");
    expect(
      fuseJoint(
        r("a", "upper-arm", "R", 0, 1000, "paused"),
        r("b", "forearm", "R", 30),
        1000,
      ).status,
    ).toBe("not-running");
  });
  test("left and right sides never mix", () => {
    const joints = jointsFor(
      [r("a", "upper-arm", "L", 0), r("b", "forearm", "R", 50)],
      1000,
    );
    expect(joints.map((j) => [j.joint.id, j.side, j.result.status])).toEqual([
      ["elbow", "L", "missing"],
      ["elbow", "R", "missing"],
      ["wrist", "R", "missing"],
    ]);
  });
  test("a patient with phones on arm AND leg gets both joints", () => {
    const joints = jointsFor(
      [
        r("a", "upper-arm", "R", 5),
        r("b", "forearm", "R", 50),
        r("c", "thigh", "L", 0),
        r("d", "shank", "L", 30),
      ],
      1000,
    ).filter((j) => j.result.status === "ok");
    expect(joints.map((j) => `${j.joint.id}:${j.side}`).sort()).toEqual([
      "elbow:R",
      "knee:L",
    ]);
  });
  test("two phones on the same segment: disagreement is surfaced", () => {
    const d = duplicateDisagreement(
      [r("a", "forearm", "R", 40), r("b", "forearm", "R", 55)],
      1000,
    );
    expect(d[0].diffDeg).toBe(15);
  });
});

describe("placement", () => {
  test("axial segments have no side; limbs always have one", () => {
    expect(normalizePlacement({ segment: "head", side: "L" })).toEqual({
      segment: "head",
      side: "C",
    });
    expect(normalizePlacement({ segment: "forearm", side: "C" })).toEqual({
      segment: "forearm",
      side: "R",
    });
    expect(placementLabel({ segment: "forearm", side: "L" })).toBe(
      "Lengan bawah kiri",
    );
  });
  test("rejects junk", () => {
    expect(isPlacement({ segment: "tail", side: "L" })).toBe(false);
    expect(isPlacement(null)).toBe(false);
    expect(isPlacement({ segment: "thigh", side: "R" })).toBe(true);
  });
});

describe("live protocol", () => {
  test("one topic per patient", () => {
    expect(patientTopic("abc")).toBe("patient:abc");
  });
  test("parses only well-formed messages", () => {
    expect(
      parseLiveMsg({ type: "state", from: "d1", t: 1, payload: {} }),
    ).not.toBeNull();
    for (const bad of [
      null,
      "x",
      { type: "", from: "d", t: 1, payload: {} },
      { type: "s", from: "", t: 1, payload: {} },
      { type: "s", from: "d", t: Number.NaN, payload: {} },
      { type: "s", from: "d", t: 1, payload: null },
      { type: "x".repeat(65), from: "d", t: 1, payload: {} },
    ])
      expect(parseLiveMsg(bad)).toBeNull();
  });
});

// Minimum-jerk speed profile: the textbook "perfectly smooth" single movement.
const minJerk = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return 30 * t ** 2 * (1 - t) ** 2;
  });

describe("SPARC (Balasubramanian et al. 2015)", () => {
  test("matches an independent DFT of the paper's algorithm (-1.4013 for minimum jerk)", () => {
    // Reference value computed with a plain-Python DFT port of the paper's smoothness.py
    // (scratch check, 28 Nov 2026); agrees to 1e-15.
    expect(sparc(minJerk(100), 50) as number).toBeCloseTo(-1.40128, 4);
    const o = minJerk(50);
    expect(sparc([...o, ...o, ...o], 50) as number).toBeCloseTo(-2.84328, 4);
  });
  test("the same movement made of 3 sub-movements is less smooth", () => {
    const one = minJerk(50);
    const three = [...one, ...one, ...one];
    expect(sparc(three, 50) as number).toBeLessThan(
      sparc(minJerk(150), 50) as number,
    );
  });
  test("resample handles uneven phone timestamps", () => {
    const v = resample(
      [
        [0, 0],
        [7, 7],
        [30, 30],
        [40, 40],
      ],
      100,
    );
    expect(v).toEqual([0, 10, 20, 30, 40]);
  });
  test("too little data gives null, not a number", () => {
    expect(repSparc([[0, 1]])).toBeNull();
    expect(sparc([0, 0, 0, 0, 0], 50)).toBeNull();
  });
});

describe("session quality (descriptive only)", () => {
  test("needs at least 3 reps", () => {
    const q = sessionQuality([{ atMs: 1, peakDeg: 80, durMs: 1000 }]);
    expect(q.consistencyCv).toBeNull();
    expect(q.peakTrendDeg).toBeNull();
  });
  test("trend = late reps vs early reps", () => {
    const reps = [90, 90, 90, 80, 70, 70].map((p, i) => ({
      atMs: i,
      peakDeg: p,
      durMs: 1000,
      sparc: -1.4,
    }));
    const q = sessionQuality(reps);
    expect(q.peakTrendDeg).toBe(-20);
    expect(q.smoothnessSparc).toBe(-1.4);
    expect(q.consistencyCv).toBeGreaterThan(0);
  });
  test("the recorder stores a SPARC per rep", () => {
    const rec = new SessionRecorder({
      id: "s",
      deviceId: "d",
      deviceLabel: "x",
      exercise: "shoulder-flexion",
      source: "replay",
      config: DEFAULT_CONFIG,
      batteryStart: null,
      reportedBy: "patient",
    });
    // One rep: up to 60° and back, 2 s, 50 Hz.
    for (let i = 0; i <= 100; i++) {
      const t = i * 20;
      const ang = 60 * Math.sin((Math.PI * i) / 100);
      const vel = Math.abs((60 * Math.PI * Math.cos((Math.PI * i) / 100)) / 2);
      rec.sample(t, ang, vel, i === 100);
    }
    const s = rec.finish(null);
    expect(s.repList).toHaveLength(1);
    expect(typeof s.repList[0].sparc).toBe("number");
  });
});

describe("security helpers", () => {
  test("cross-site writes are refused, same-site and reads pass", () => {
    expect(
      isCrossSiteWrite("POST", "https://evil.example", "rehat.app", []),
    ).toBe(true);
    expect(isCrossSiteWrite("POST", "https://rehat.app", "rehat.app", [])).toBe(
      false,
    );
    expect(
      isCrossSiteWrite("GET", "https://evil.example", "rehat.app", []),
    ).toBe(false);
    expect(
      isCrossSiteWrite("PUT", "https://rehat-lac.vercel.app", "x", [
        "https://rehat-lac.vercel.app",
      ]),
    ).toBe(false);
    expect(isCrossSiteWrite("DELETE", "not a url", "rehat.app", [])).toBe(true);
  });
  test("production headers: CSP locks connections to self + Supabase, HSTS on", () => {
    const h = Object.fromEntries(
      securityHeaders({
        dev: false,
        supabaseUrl: "https://abc.supabase.co",
      }).map((x) => [x.key, x.value]),
    );
    expect(h["Content-Security-Policy"]).toContain(
      "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co;",
    );
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).not.toContain(" 'unsafe-eval'");
    expect(h["Strict-Transport-Security"]).toBeDefined();
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });
});
