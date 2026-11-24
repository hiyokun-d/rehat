import { describe, expect, test } from "bun:test";
import {
  classify,
  DEFAULT_CLASSIFY,
  type Template,
} from "../src/lib/gesture/classifier";
import { dtw, resample } from "../src/lib/gesture/dtw";
import type { Frame } from "../src/lib/gesture/features";
import { DEFAULT_SEGMENTER, Segmenter } from "../src/lib/gesture/segmenter";

// SYNTHETIC gesture traces: one IMU channel follows a shape over time. Not real gestures.
function trace(
  shape: (k: number) => number,
  ms: number,
  hz = 30,
  hand = true,
): Frame[] {
  const out: Frame[] = [];
  for (let t = 0; t <= ms; t += 1000 / hz) {
    const v = shape(t / ms);
    out.push({
      t,
      imu: [0, 1, 0, v, 0, 0],
      hand: hand
        ? Array.from({ length: 63 }, (_, i) => (i % 3 === 0 ? v : 0))
        : null,
    });
  }
  return out;
}
const up = (k: number) => Math.sin(Math.PI * k);
const wave = (k: number) => Math.sin(4 * Math.PI * k);

describe("dtw", () => {
  test("same shape at different speed is closer than a different shape", () => {
    const w = { hand: 1, imu: 1 };
    const a = resample(trace(up, 800));
    const slow = resample(trace(up, 1600));
    const other = resample(trace(wave, 800));
    expect(dtw(a, slow, w)).toBeLessThan(dtw(a, other, w));
  });
  test("missing hand costs something", () => {
    const w = { hand: 1, imu: 1 };
    const a = resample(trace(up, 800));
    const noHand = resample(trace(up, 800, 30, false));
    expect(dtw(a, noHand, w)).toBeGreaterThan(dtw(a, a, w));
  });
});

describe("classifier", () => {
  const tpl = (word: string, f: Frame[]): Template => ({
    word,
    frames: resample(f),
    createdAt: "",
  });
  const templates = [
    tpl("halo", trace(up, 800)),
    tpl("halo", trace(up, 1000)),
    tpl("ya", trace(wave, 800)),
    tpl("ya", trace(wave, 900)),
  ];

  test("recognises the right word", () => {
    expect(classify(trace(up, 900), templates, DEFAULT_CLASSIFY).word).toBe(
      "halo",
    );
    expect(classify(trace(wave, 850), templates, DEFAULT_CLASSIFY).word).toBe(
      "ya",
    );
  });
  test("rejects something far from every template", () => {
    const flat = trace(() => 3, 800);
    const r = classify(flat, templates, DEFAULT_CLASSIFY);
    expect(r.word).toBeNull();
  });
  test("no templates -> reject", () => {
    expect(classify(trace(up, 800), [], DEFAULT_CLASSIFY)).toMatchObject({
      word: null,
      reason: "no-templates",
    });
  });
});

describe("segmenter", () => {
  const frame = (t: number): Frame => ({
    t,
    imu: [0, 1, 0, 0, 0, 0],
    hand: null,
  });
  function run(energyAt: (t: number) => number, until: number) {
    const s = new Segmenter(DEFAULT_SEGMENTER);
    const events = [];
    for (let t = 0; t <= until; t += 33) {
      const e = s.push(frame(t), energyAt(t));
      if (e) events.push(e);
    }
    return events;
  }
  test("a 1 s movement gives one segment that ends after the still period", () => {
    const ev = run((t) => (t > 500 && t < 1500 ? 10 : 0), 3000);
    expect(ev.length).toBe(1);
    expect(ev[0].kind).toBe("segment");
  });
  test("a twitch shorter than startMs is ignored", () => {
    expect(run((t) => (t > 500 && t < 600 ? 10 : 0), 2000)).toEqual([]);
  });
  test("moving longer than maxMs is discarded", () => {
    const ev = run((t) => (t > 100 ? 10 : 0), 6000);
    expect(ev[0]).toMatchObject({ kind: "discarded", reason: "too-long" });
  });
});

import { MIN_MATCH, phoneMatch } from "../src/lib/gesture/phoneHand";

describe("phone hand matching (laptop camera)", () => {
  // SYNTHETIC: the phone hand's speed follows the gyro; the free hand moves on its own rhythm.
  const ts = Array.from({ length: 45 }, (_, i) => i * 33);
  const gyro = ts.map((t) => ({ t, v: 100 * Math.abs(Math.sin(t / 200)) }));
  const phoneHand = ts.map((t) => ({
    t: t + 10,
    v: 0.5 * Math.abs(Math.sin(t / 200)) + 0.01,
  }));
  const freeHand = ts.map((t) => ({ t, v: 0.5 * Math.abs(Math.cos(t / 90)) }));
  test("the hand that moves with the gyro wins", () => {
    expect(phoneMatch(phoneHand, gyro)).toBeGreaterThan(MIN_MATCH);
    expect(phoneMatch(phoneHand, gyro)).toBeGreaterThan(
      phoneMatch(freeHand, gyro),
    );
  });
});

import { expand, NAME_TOKEN, SEED_VOCAB } from "../src/lib/gesture/vocab";

describe("vocabulary", () => {
  test("no duplicate entries across groups", () => {
    expect(new Set(SEED_VOCAB).size).toBe(SEED_VOCAB.length);
  });
  test("name placeholder is filled in", () => {
    expect(expand(`nama saya ${NAME_TOKEN}`, "Budi")).toBe("nama saya Budi");
  });
});

import { classifyPartial, EarlyDecider } from "../src/lib/gesture/classifier";
import { dtwPacked, pack } from "../src/lib/gesture/dtw";

describe("faster recognition", () => {
  const tpl = (word: string, f: Frame[]): Template => ({
    word,
    frames: resample(f),
    createdAt: "",
  });
  // SYNTHETIC shapes that differ from the very start (so early recognition is possible).
  const rise = (k: number) => k;
  const dip = (k: number) => -Math.sin(2 * Math.PI * k);
  const templates = [
    tpl("halo", trace(rise, 900)),
    tpl("halo", trace(rise, 1000)),
    tpl("ya", trace(dip, 900)),
    tpl("ya", trace(dip, 1000)),
  ];

  test("abandoning never changes the decision", () => {
    const seg = trace(rise, 950);
    const full = classify(seg, templates, {
      ...DEFAULT_CLASSIFY,
      maxDistance: 99,
      minMargin: 0,
    });
    const fast = classify(seg, templates, DEFAULT_CLASSIFY);
    expect(fast.word).toBe(full.candidates[0].word);
  });

  test("open-end DTW: a prefix matches the template's start", () => {
    const w = { hand: 1, imu: 1 };
    const t = pack(resample(trace(rise, 1000)));
    const r = dtwPacked(
      pack(resample(trace(rise, 700).slice(0, 15), 22)),
      t,
      w,
      { openEnd: true },
    );
    expect(r.progress).toBeGreaterThan(0.5);
    expect(r.progress).toBeLessThan(0.9);
  });

  test("a word is recognised at ~70% of the movement, not after it ends", () => {
    const seg = trace(rise, 950);
    const d = new EarlyDecider();
    let firedAtFrac = 1;
    for (let i = 3; i <= seg.length; i++) {
      const partial = seg.slice(0, i);
      const t = partial[partial.length - 1].t;
      if (!d.due(t)) continue;
      if (d.push(classifyPartial(partial, templates, DEFAULT_CLASSIFY).word, t))
        firedAtFrac = t / 950;
    }
    expect(d.fired).toBe("halo");
    expect(firedAtFrac).toBeLessThan(0.95);
  });

  test("ambiguous prefix waits (never fires on the first frames)", () => {
    expect(
      classifyPartial(trace(rise, 100), templates, DEFAULT_CLASSIFY).word,
    ).toBeNull();
  });

  test("speed: 300 templates classify in well under a frame budget", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      tpl(
        `w${i % 60}`,
        trace((k) => Math.sin((1 + (i % 7)) * k), 900),
      ),
    );
    const seg = trace(rise, 950);
    const t0 = performance.now();
    classify(seg, many, DEFAULT_CLASSIFY);
    const ms = performance.now() - t0;
    console.log(
      `classify 300 templates: ${ms.toFixed(1)} ms (laptop; phones slower)`,
    );
    expect(ms).toBeLessThan(200);
  });
});

describe("face channel", () => {
  const w = { hand: 1, imu: 1, face: 1 };
  const withFace = (f: Frame[], v: number) =>
    f.map((x) => ({ ...x, face: Array.from({ length: 16 }, () => v) }));
  test("same hands, different face -> further apart", () => {
    const a = resample(withFace(trace(up, 800), 0));
    expect(dtw(a, resample(withFace(trace(up, 800), 0.8)), w)).toBeGreaterThan(
      dtw(a, a, w),
    );
  });
  test("missing face is ignored, not penalised", () => {
    const a = resample(withFace(trace(up, 800), 0.5));
    const b = resample(trace(up, 800));
    expect(dtw(a, b, w)).toBeCloseTo(dtw(b, b, w), 5);
  });
});
