import { describe, expect, test } from "bun:test";
import { shouldPauseOnBreach } from "../src/lib/rehab/envelope";
import { RehabSession } from "../src/lib/rehab/session";
import {
  makeExport,
  parseImport,
  SessionRecorder,
  TRACE_HZ,
} from "../src/lib/rehab/summary";
import { roomFromQr } from "../src/lib/relay/protocol";
import {
  decodePacket,
  encodePacket,
  seqGap,
} from "../src/lib/sensor/blePacket";
import { syntheticFlexion } from "../src/lib/sensor/synthetic";

/** Runs a synthetic session through the real pipeline and the recorder, like usePhoneSession. */
function record(reps: number, peakDeg: number) {
  const session = new RehabSession();
  session.beginCalibration();
  let rec: SessionRecorder | null = null;
  for (const s of syntheticFlexion({ reps, peakDeg, stillMs: 3500 })) {
    const r = session.sample(s);
    if (r.calibration?.ok)
      rec = new SessionRecorder({
        id: "s1",
        deviceId: "d1",
        deviceLabel: "test",
        exercise: session.config.exercise,
        source: "replay",
        config: session.config,
        batteryStart: 0.8,
        reportedBy: "caregiver",
      });
    if (r.breach) rec?.breach(r.breach);
    const snap = session.snapshot();
    if (session.phase === "running")
      rec?.sample(s.t, snap.angleDeg, snap.velDegS, !!r.rep);
  }
  return { rec, session };
}

describe("session summary", () => {
  test("counts the same reps as the session and keeps each peak", () => {
    const { rec, session } = record(5, 70);
    expect(rec).not.toBeNull();
    const sum = rec?.finish(0.78);
    expect(sum?.reps).toBe(session.snapshot().reps);
    expect(sum?.reps).toBe(5);
    for (const r of sum?.repList ?? []) {
      expect(r.peakDeg).toBeGreaterThan(60);
      expect(r.peakDeg).toBeLessThan(80);
      expect(r.durMs).toBeGreaterThan(0);
    }
    expect(sum?.reportedBy).toBe("caregiver");
    expect(sum?.battery).toEqual({ start: 0.8, end: 0.78 });
  });

  test("trace is downsampled to about TRACE_HZ (no raw stream stored)", () => {
    const sum = record(5, 70).rec?.finish(null);
    const tr = sum?.trace ?? [];
    const spanS = (tr[tr.length - 1][0] - tr[0][0]) / 1000;
    expect(tr.length / spanS).toBeLessThanOrEqual(TRACE_HZ + 0.5);
    expect(sum?.battery).toBeNull();
  });

  test("records limit events with time since start", () => {
    const sum = record(3, 120).rec?.finish(null); // example limit is 90°
    expect(sum?.breaches.some((b) => b.kind === "angle")).toBe(true);
    for (const b of sum?.breaches ?? [])
      expect(b.atMs).toBeGreaterThanOrEqual(0);
  });

  test("export -> import round trip, junk is dropped", () => {
    const sum = record(2, 70).rec?.finish(null);
    if (!sum) throw new Error("no session");
    const file = JSON.parse(
      JSON.stringify(makeExport([{ ...sum, syncedAt: "x" }])),
    );
    const back = parseImport(file);
    expect(back).toHaveLength(1);
    expect(back[0].syncedAt).toBeUndefined();
    expect(parseImport({ kind: "other" })).toEqual([]);
    expect(parseImport([{ nope: 1 }, sum])).toHaveLength(1);
  });
});

describe("BLE packet (Tier 1)", () => {
  test("encode -> decode keeps values within one LSB", () => {
    const s = {
      t: 123456,
      ax: 0.5,
      ay: -9.81,
      az: 1.2,
      gx: 10,
      gy: -45.5,
      gz: 200,
    };
    const p = decodePacket(new DataView(encodePacket(7, s)));
    expect(p?.seq).toBe(7);
    expect(p?.sample.t).toBe(123456);
    expect(p?.sample.ay).toBeCloseTo(-9.81, 2);
    expect(p?.sample.gy).toBeCloseTo(-45.5, 1);
  });
  test("short packet is rejected", () => {
    expect(decodePacket(new DataView(new ArrayBuffer(10)))).toBeNull();
  });
  test("lost packets from seq, including u16 wrap", () => {
    expect(seqGap(null, 5)).toBe(0);
    expect(seqGap(5, 6)).toBe(0);
    expect(seqGap(5, 9)).toBe(3);
    expect(seqGap(65535, 1)).toBe(1);
  });
});

describe("pairing QR", () => {
  test("reads the room from our URL or bare digits", () => {
    expect(roomFromQr("https://192.168.1.29:3443/phone?room=0427")).toBe(
      "0427",
    );
    expect(roomFromQr("1234")).toBe("1234");
    expect(roomFromQr("https://example.com/?room=12")).toBeNull();
    expect(roomFromQr("hello")).toBeNull();
  });
});

describe("therapist-set pause on breach (F4)", () => {
  test("phone-only mode is cue only; only the therapist's value pauses", () => {
    expect(shouldPauseOnBreach({})).toBe(false);
    expect(shouldPauseOnBreach({ onBreach: "CUE_ONLY" })).toBe(false);
    expect(shouldPauseOnBreach({ onBreach: "CUE_AND_PAUSE" })).toBe(true);
  });

  test("pause affects a running session only, and resume works", () => {
    const s = new RehabSession();
    s.pause();
    expect(s.snapshot().phase).toBe("idle");
    s.beginCalibration();
    for (const sample of syntheticFlexion({
      reps: 1,
      peakDeg: 70,
      stillMs: 3500,
    })) {
      s.sample(sample);
      if (s.phase === "running") break;
    }
    expect(s.phase).toBe("running");
    s.pause();
    expect(s.snapshot().phase).toBe("paused");
    s.resume();
    expect(s.snapshot().phase).toBe("running");
  });
});
