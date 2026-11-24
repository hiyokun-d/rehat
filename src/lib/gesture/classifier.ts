// k-nearest-neighbour over recorded templates with DTW distance, plus two reject rules.
// "Wrong words spoken out loud are worse than silence": when unsure, we say nothing.
//
// Two entry points:
//  - classify():        a finished segment (hand has stopped).
//  - classifyPartial(): a segment still in progress (open-end DTW against template prefixes),
//                       used by EarlyDecider to speak *before* the hand stops, with stricter rules.
import {
  dtwPacked,
  type Packed,
  pack,
  RESAMPLE_N,
  resample,
  type Weights,
} from "./dtw";
import type { Frame } from "./features";

export interface Template {
  id?: number;
  word: string;
  frames: Frame[]; // already resampled
  createdAt: string;
}

export interface ClassifyConfig {
  k: number; // neighbours per word averaged (1 = plain nearest neighbour)
  maxDistance: number; // reject if the best word is further than this
  minMargin: number; // reject if (second - best) / second is below this (0..1)
  weights: Weights;
}

/** Starting values, tuned by testing on the team's own gestures — not from literature. */
export const DEFAULT_CLASSIFY: ClassifyConfig = {
  k: 2,
  maxDistance: 1.2,
  minMargin: 0.15,
  weights: { hand: 1, imu: 1 },
};

export interface Candidate {
  word: string;
  distance: number;
  progress?: number; // partial only: how much of the word has been done (0..1)
}

export type ClassifyResult =
  | { word: string; candidates: Candidate[] }
  | {
      word: null;
      reason: "no-templates" | "too-far" | "ambiguous" | "too-early";
      candidates: Candidate[];
    };

// Templates never change once recorded: pack each one once.
const packed = new WeakMap<Frame[], Packed>();
const packedOf = (frames: Frame[]) => {
  let p = packed.get(frames);
  if (!p) {
    p = pack(frames);
    packed.set(frames, p);
  }
  return p;
};

/**
 * Templates further than this cannot change the decision: if the best word passes
 * maxDistance, a second word beyond maxDistance / (1 - minMargin) always passes the margin
 * rule. So DTW can abandon them early without changing any result.
 */
const abandonBound = (cfg: ClassifyConfig) =>
  cfg.maxDistance / Math.max(0.05, 1 - cfg.minMargin);

function decide(
  scores: Map<string, { ds: number[]; progress: number }>,
  cfg: ClassifyConfig,
  maxDistance: number,
  minMargin: number,
): ClassifyResult {
  // Score per word = mean of its k closest templates (robust to one bad recording).
  const candidates: Candidate[] = [...scores.entries()]
    .map(([word, s]) => {
      const best = s.ds.sort((x, y) => x - y).slice(0, cfg.k);
      return {
        word,
        distance: best.reduce((a, x) => a + x, 0) / best.length,
        progress: s.progress,
      };
    })
    .filter((c) => Number.isFinite(c.distance))
    .sort((x, y) => x.distance - y.distance);
  const [best, second] = candidates;
  if (!best || best.distance > maxDistance)
    return { word: null, reason: "too-far", candidates };
  if (second && (second.distance - best.distance) / second.distance < minMargin)
    return { word: null, reason: "ambiguous", candidates };
  return { word: best.word, candidates };
}

export function classify(
  segment: Frame[],
  templates: Template[],
  cfg: ClassifyConfig,
): ClassifyResult {
  if (templates.length === 0)
    return { word: null, reason: "no-templates", candidates: [] };
  const seg = pack(resample(segment));
  const abandonAbove = abandonBound(cfg);
  const scores = new Map<string, { ds: number[]; progress: number }>();
  for (const t of templates) {
    const d = dtwPacked(seg, packedOf(t.frames), cfg.weights, {
      abandonAbove,
    }).cost;
    const s = scores.get(t.word) ?? { ds: [], progress: 1 };
    s.ds.push(d);
    scores.set(t.word, s);
  }
  return decide(scores, cfg, cfg.maxDistance, cfg.minMargin);
}

export interface EarlyConfig {
  everyMs: number; // how often to try while the hand is moving
  minProgress: number; // best template must be at least this far along (0..1)
  distanceFactor: number; // early accept needs distance <= maxDistance * this
  marginFactor: number; // ... and margin >= minMargin * this
  stableChecks: number; // same word on this many checks in a row
}

/** Stricter than the final decision on purpose. Tuned by testing, not from literature. */
export const DEFAULT_EARLY: EarlyConfig = {
  everyMs: 120,
  minProgress: 0.6,
  distanceFactor: 0.8,
  marginFactor: 2,
  stableChecks: 2,
};

export function classifyPartial(
  partial: Frame[],
  templates: Template[],
  cfg: ClassifyConfig,
  early: EarlyConfig = DEFAULT_EARLY,
): ClassifyResult {
  if (templates.length === 0)
    return { word: null, reason: "no-templates", candidates: [] };
  if (partial.length < 3)
    return { word: null, reason: "too-early", candidates: [] };
  const durP = partial[partial.length - 1].t - partial[0].t;
  // Resample the partial at the *template's* time rate, so "60% of the way" lines up.
  const byLen = new Map<number, Packed>();
  const scores = new Map<string, { ds: number[]; progress: number }>();
  const abandonAbove = abandonBound(cfg);
  for (const t of templates) {
    const tp = packedOf(t.frames);
    const n = Math.max(
      4,
      Math.min(
        RESAMPLE_N,
        Math.round((RESAMPLE_N * durP) / Math.max(1, tp.durationMs)),
      ),
    );
    let seg = byLen.get(n);
    if (!seg) {
      seg = pack(resample(partial, n));
      byLen.set(n, seg);
    }
    const r = dtwPacked(seg, tp, cfg.weights, { openEnd: true, abandonAbove });
    const s = scores.get(t.word) ?? { ds: [], progress: 0 };
    s.ds.push(r.cost);
    if (r.cost === Math.min(...s.ds)) s.progress = r.progress; // progress of the closest template
    scores.set(t.word, s);
  }
  const r = decide(
    scores,
    cfg,
    cfg.maxDistance * early.distanceFactor,
    Math.min(0.9, cfg.minMargin * early.marginFactor),
  );
  if (r.word && (r.candidates[0].progress ?? 0) < early.minProgress)
    return { word: null, reason: "too-early", candidates: r.candidates };
  return r;
}

/** Fires a word once, when partial results agree `stableChecks` times in a row. */
export class EarlyDecider {
  cfg: EarlyConfig;
  fired: string | null = null;
  firedAt = 0;
  private last: string | null = null;
  private streak = 0;
  private lastCheck = Number.NEGATIVE_INFINITY;

  constructor(cfg: EarlyConfig = DEFAULT_EARLY) {
    this.cfg = cfg;
  }

  reset() {
    this.fired = null;
    this.last = null;
    this.streak = 0;
    this.lastCheck = Number.NEGATIVE_INFINITY;
  }

  /** True when enough time passed since the last check (keeps CPU use bounded). */
  due(t: number): boolean {
    if (this.fired || t - this.lastCheck < this.cfg.everyMs) return false;
    this.lastCheck = t;
    return true;
  }

  /** Feed one partial result; returns the word the moment it becomes stable, else null. */
  push(word: string | null, t: number): string | null {
    if (this.fired) return null;
    this.streak = word && word === this.last ? this.streak + 1 : word ? 1 : 0;
    this.last = word;
    if (word && this.streak >= this.cfg.stableChecks) {
      this.fired = word;
      this.firedAt = t;
      return word;
    }
    return null;
  }
}
