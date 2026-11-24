import { describe, expect, test } from "bun:test";
import {
  holisticFrame,
  INPUT_SIZE,
  N_COLS,
  SignSegmenter,
  toWindow,
} from "../src/lib/asl/preprocess";
import fixture from "./fixtures/asl-window.json";

// Fixture from github.com/ceydaakin/asl-realtime (MIT), written by their Python preprocessing:
// our port must produce the same model input, number for number.
describe("ASL preprocessing port", () => {
  test("matches the upstream Python preprocessing", () => {
    for (const { name, frames, xy, mask } of fixture as {
      name: string;
      frames: (number | null)[][][];
      xy: number[][][];
      mask: number[];
    }[]) {
      const out = toWindow(
        frames.map((f) => Float32Array.from(f.flat(), (v) => v ?? Number.NaN)),
      );
      expect(Array.from(out.mask)).toEqual(mask.map(Number));
      const expected = xy.flat(2);
      expect(out.xy.length).toBe(expected.length);
      let maxErr = 0;
      out.xy.forEach((v, i) => {
        maxErr = Math.max(maxErr, Math.abs(v - expected[i]));
      });
      expect(maxErr, name).toBeLessThan(1e-6);
    }
  });

  test("window shape", () => {
    const f = holisticFrame({
      rightHandLandmarks: [
        Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })),
      ],
    });
    const w = toWindow([f, f, f]);
    expect(w.xy.length).toBe(INPUT_SIZE * N_COLS * 2);
    expect(w.length).toBe(3);
  });

  test("segmenter: hand in view, then gone -> one sign", () => {
    const hand = holisticFrame({
      leftHandLandmarks: [
        Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })),
      ],
    });
    const none = holisticFrame({});
    const s = new SignSegmenter({ gap: 3, minFrames: 2 });
    const out = [...Array(5).fill(hand), none, none, none].map((f) =>
      s.push(f),
    );
    expect(out.filter(Boolean)).toHaveLength(1);
  });
});

import { FACE_SEND, packFrame, unpackFrame } from "../src/lib/asl/remote";

describe("laptop -> phone landmark mirror", () => {
  test("pack/unpack keeps the drawn points and stays small", () => {
    const pts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        x: i / n,
        y: 1 - i / n,
        z: 0,
        visibility: 1,
      }));
    const res = {
      faceLandmarks: [pts(478)],
      poseLandmarks: [pts(33)],
      leftHandLandmarks: [pts(21)],
      rightHandLandmarks: [],
    } as never;
    const msg = packFrame(res);
    expect(JSON.stringify(msg).length).toBeLessThan(4000);
    const back = unpackFrame(msg);
    expect(back.leftHandLandmarks[0][5].x).toBeCloseTo(5 / 21, 3);
    expect(back.rightHandLandmarks).toHaveLength(0);
    const i = FACE_SEND[3];
    expect(back.faceLandmarks[0][i].x).toBeCloseTo(i / 478, 3);
  });
});

import { PhoneLocator, rollFromGravity } from "../src/lib/asl/phoneLocator";
import { OneEuro } from "../src/lib/tracking/oneEuro";

describe("tracker smoothing + phone position", () => {
  test("One Euro: jitter shrinks when still, follows a fast move", () => {
    const f = new OneEuro();
    let maxJitter = 0;
    for (let i = 0; i < 60; i++) {
      const v = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33);
      if (i > 10) maxJitter = Math.max(maxJitter, Math.abs(v - 0.5));
    }
    expect(maxJitter).toBeLessThan(0.005); // raw jitter is 0.01
    let v = 0;
    for (let i = 60; i < 75; i++) v = f.filter(0.9, i * 33);
    expect(v).toBeGreaterThan(0.85); // caught up within ~0.5 s
  });

  test("roll from gravity: upright 0, tilted ~45 deg", () => {
    expect(rollFromGravity([0, 9.8, 0])).toBeCloseTo(0, 5);
    expect(rollFromGravity([0, -9.8, 0])).toBeCloseTo(0, 5);
    expect(Math.abs(rollFromGravity([6.9, 6.9, 0]))).toBeCloseTo(
      Math.PI / 4,
      2,
    );
  });

  test("the hand moving with the gyro gets the phone (SYNTHETIC)", () => {
    const loc = new PhoneLocator();
    const hand = (x: number) =>
      Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
    const gyro = Array.from({ length: 60 }, (_, i) => ({
      t: i * 33,
      v: 100 * Math.abs(Math.sin(i / 5)),
    }));
    let est = null;
    let xl = 0.3;
    for (let i = 0; i < 45; i++) {
      xl += 0.01 * Math.abs(Math.sin(i / 5)); // left hand moves with the gyro rhythm
      const xr = 0.7 + 0.005 * Math.sin(i * 1.7); // right hand jitters on its own
      est = loc.update({ l: hand(xl), r: hand(xr) }, i * 33, gyro, [0, 9.8, 0]);
    }
    expect(est?.side).toBe("l");
  });
});

import { SpringChain } from "../src/lib/tracking/springChain";

describe("avatar spring physics", () => {
  const params = { stiffness: 2, drag: 0.3, gravity: 0 };
  test("bones keep their length", () => {
    const c = new SpringChain(4, 10, params);
    let j = c.step({ x: 0, y: 0 }, Math.PI / 2, 1 / 30);
    for (let i = 0; i < 30; i++)
      j = c.step({ x: i * 5, y: 0 }, Math.PI / 2, 1 / 30);
    for (let i = 1; i < j.length; i++)
      expect(Math.hypot(j[i].x - j[i - 1].x, j[i].y - j[i - 1].y)).toBeCloseTo(
        10,
        5,
      );
  });
  test("swings when the head moves, settles back to rest when it stops", () => {
    const c = new SpringChain(3, 10, params);
    for (let i = 0; i < 10; i++)
      c.step({ x: i * 8, y: 0 }, Math.PI / 2, 1 / 30); // head moves right
    const tip = c.joints[3];
    expect(tip.x).toBeLessThan(72 - 1); // tip lags behind (hangs to the left of the root at x=72)
    for (let i = 0; i < 200; i++) c.step({ x: 72, y: 0 }, Math.PI / 2, 1 / 30);
    expect(c.joints[3].x).toBeCloseTo(72, 0); // back to hanging straight down
    expect(c.joints[3].y).toBeCloseTo(30, 0);
  });
});

import { frameChecks, holisticFrame as hf } from "../src/lib/asl/preprocess";
import { syntheticFrame } from "../src/lib/asl/synthetic";

describe("synthetic demo figure", () => {
  test("has a hand, lips and an arm the checks can see", () => {
    const c = frameChecks(hf(syntheticFrame(1000)));
    expect(c.hand).toBe(true);
    expect(c.face).toBe(true);
    expect(c.arm).toBe(true);
  });
});

import { GatedClip, MotionGate } from "../src/lib/asl/motionGate";

describe("faster signing: phone gyro gates the sign", () => {
  // SYNTHETIC gyro at 60 Hz: rest (5°/s), sign 600 ms (150°/s), short pause, second sign.
  const stream = () => {
    const out: { t: number; g: number }[] = [];
    for (let t = 0; t < 3000; t += 16) {
      const signing = (t > 500 && t < 1100) || (t > 1500 && t < 2200);
      out.push({
        t,
        g: signing ? 150 + 20 * Math.sin(t / 30) : 5 + Math.random() * 3,
      });
    }
    return out;
  };

  test("two signs with only a 400 ms pause -> two separate signs", () => {
    const gate = new MotionGate();
    const ev = stream()
      .map((s) => gate.push(s.t, s.g))
      .filter(Boolean);
    expect(ev.map((e) => e?.kind)).toEqual(["start", "end", "start", "end"]);
  });

  test("end is detected ~stillMs after the hand stops (not after lowering the hand)", () => {
    const gate = new MotionGate();
    const end = stream()
      .map((s) => gate.push(s.t, s.g))
      .find((e) => e?.kind === "end");
    expect(end?.t).toBeGreaterThan(1100);
    expect(end?.t).toBeLessThan(1100 + 260); // 180 ms still + sample spacing
  });

  test("a bump is ignored", () => {
    const gate = new MotionGate();
    const ev = [0, 16, 32, 48, 64, 80]
      .map((t, i) => gate.push(t, i === 2 ? 200 : 5))
      .filter(Boolean);
    expect(ev).toHaveLength(0);
  });

  test("pre-roll keeps the first frames of a sign", () => {
    const clip = new GatedClip<number>(200);
    for (let t = 0; t <= 1000; t += 33) clip.push(t, t);
    clip.start(950);
    for (let t = 1033; t <= 1300; t += 33) clip.push(t, t);
    const frames = clip.end();
    expect(frames[0]).toBeLessThanOrEqual(800);
    expect(frames[frames.length - 1]).toBe(1297);
  });
});

import { CAMERA_GATE, handSpeed } from "../src/lib/asl/motionGate";

describe("faster signing: camera only (hand pauses, not lowered)", () => {
  // SYNTHETIC 30 FPS hand: 21 points, small jitter at rest, moves during two signs.
  const hand = (x: number, jitter: number) =>
    Array.from({ length: 21 }, (_, i) => ({
      x: x + i * 0.005 + (Math.random() - 0.5) * jitter,
      y: 0.5,
    }));
  test("two signs with a 300 ms pause, hand never leaves -> two signs", () => {
    const gate = new MotionGate(CAMERA_GATE);
    let prev = { l: undefined, r: hand(0.5, 0.002) } as Parameters<
      typeof handSpeed
    >[0];
    let x = 0.5;
    const kinds: string[] = [];
    for (let t = 33; t < 3000; t += 33) {
      const signing = (t > 500 && t < 1100) || (t > 1400 && t < 2100);
      if (signing) x += 0.02 * Math.sin(t / 80); // ~0.4-0.6 picture/s back and forth
      const cur = { l: undefined, r: hand(x, 0.002) };
      const ev = gate.push(t, handSpeed(prev, cur, 0.033));
      if (ev) kinds.push(ev.kind);
      prev = cur;
    }
    expect(kinds).toEqual(["start", "end", "start", "end"]);
  });
  test("no hand -> speed 0", () => {
    expect(
      handSpeed(
        { l: undefined, r: undefined },
        { l: undefined, r: hand(0.5, 0) },
        0.033,
      ),
    ).toBe(0);
  });
});
