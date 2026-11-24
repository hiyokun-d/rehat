// Words the pretrained model does not know (its vocabulary is toddlers' first words: no I/MY/
// NAME). The user records each one 2-3 times; we match new signs against those recordings with
// DTW, in front of the model. Recordings only work for the person who made them.
//
// Features come from the SAME 64-frame window the model gets (toWindow), so nothing extra is
// tracked: dominant hand (21 pts) + elbow + wrist, relative to the mouth centre and scaled by
// mouth width (so standing a bit further/closer or to the side matters less).
import type { AslWindow } from "./preprocess";
import { LIPS, N_COLS } from "./preprocess";

export const CUSTOM_PREFIX = "custom:";

/** The words we let users record. `id` / `en` are what is shown and spoken. */
export const CUSTOM_WORDS = [
  {
    key: "MY",
    id: "saya (punya)",
    en: "my",
    hint: "Telapak terbuka ditempel di dada.",
  },
  { key: "I", id: "saya", en: "I", hint: "Telunjuk menunjuk dada sendiri." },
  {
    key: "NAME",
    id: "nama",
    en: "name",
    hint: "Dua jari (H) mengetuk dua jari tangan lain, 2x.",
  },
] as const;
export type CustomKey = (typeof CUSTOM_WORDS)[number]["key"];

export const MIN_SAMPLES = 2; // need 2 to know how much YOUR repeats differ (the threshold)

export interface CustomSign {
  id?: number;
  key: CustomKey;
  frames: number; // feature frames
  feat: number[]; // frames * DIM
  createdAt: string;
}

const LIP_N = LIPS.length; // 40 lip columns first in the window
const HAND_COLS = Array.from({ length: 21 }, (_, i) => LIP_N + i); // 40..60
const ARM_COLS = [LIP_N + 21, LIP_N + 22]; // elbow, wrist
const COLS = [...HAND_COLS, ...ARM_COLS];
export const DIM = COLS.length * 2;
const LIP_LEFT = 0; // landmark 61
const LIP_RIGHT = 10; // landmark 291

const xy = (w: AslWindow, t: number, col: number) => {
  const o = (t * N_COLS + col) * 2;
  return [w.xy[o], w.xy[o + 1]] as const;
};
const isZero = ([x, y]: readonly [number, number]) => x === 0 && y === 0; // toWindow's "missing"

/** Window -> per-frame features (length = real frames). */
export function signFeatures(w: AslWindow): {
  frames: number;
  feat: Float32Array;
} {
  const n = w.length;
  // Scale: median mouth width over the clip; fallback = hand size (wrist -> middle knuckle).
  const widths: number[] = [];
  for (let t = 0; t < n; t++) {
    const a = xy(w, t, LIP_LEFT);
    const b = xy(w, t, LIP_RIGHT);
    if (!isZero(a) && !isZero(b))
      widths.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  widths.sort((a, b) => a - b);
  let scale = widths[widths.length >> 1] ?? 0;
  if (!scale) {
    const a = xy(w, 0, HAND_COLS[0]);
    const b = xy(w, 0, HAND_COLS[9]);
    scale = Math.hypot(a[0] - b[0], a[1] - b[1]) / 2;
  }
  scale ||= 0.05;
  const feat = new Float32Array(n * DIM);
  let ox = 0.5;
  let oy = 0.5;
  for (let t = 0; t < n; t++) {
    // Origin: mouth centre when seen, else the last one seen.
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let col = 0; col < LIP_N; col++) {
      const p = xy(w, t, col);
      if (isZero(p)) continue;
      sx += p[0];
      sy += p[1];
      c++;
    }
    if (c) {
      ox = sx / c;
      oy = sy / c;
    }
    COLS.forEach((col, k) => {
      const p = xy(w, t, col);
      feat[t * DIM + k * 2] = isZero(p) ? 0 : (p[0] - ox) / scale;
      feat[t * DIM + k * 2 + 1] = isZero(p) ? 0 : (p[1] - oy) / scale;
    });
  }
  return { frames: n, feat };
}

/** DTW, mean frame distance along the best path (so long and short clips compare fairly). */
export function dtwDistance(
  a: ArrayLike<number>,
  na: number,
  b: ArrayLike<number>,
  nb: number,
): number {
  if (!na || !nb) return Number.POSITIVE_INFINITY;
  const d = (i: number, j: number) => {
    let s = 0;
    for (let k = 0; k < DIM; k++) {
      const x = a[i * DIM + k] - b[j * DIM + k];
      s += x * x;
    }
    return Math.sqrt(s / DIM);
  };
  let prev = new Float64Array(nb + 1).fill(Number.POSITIVE_INFINITY);
  let cur = new Float64Array(nb + 1);
  prev[0] = 0;
  for (let i = 1; i <= na; i++) {
    cur.fill(Number.POSITIVE_INFINITY);
    for (let j = 1; j <= nb; j++)
      cur[j] = d(i - 1, j - 1) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[nb] / (na + nb);
}

export interface CustomMatch {
  key: CustomKey;
  distance: number;
  limit: number; // accepted when distance <= limit
}

/** How far your own repeats are allowed to drift. 1.5x and the floor are *tuned by testing*. */
const SPREAD_FACTOR = 1.5;
const MIN_LIMIT = 0.15;

/** Best custom word for this clip, or null. Words with < MIN_SAMPLES recordings are skipped. */
export function matchCustom(
  w: AslWindow,
  signs: CustomSign[],
): CustomMatch | null {
  const q = signFeatures(w);
  let best: CustomMatch | null = null;
  for (const { key } of CUSTOM_WORDS) {
    const own = signs.filter((s) => s.key === key);
    if (own.length < MIN_SAMPLES) continue;
    let spread = 0;
    for (let i = 0; i < own.length; i++)
      for (let j = i + 1; j < own.length; j++)
        spread = Math.max(
          spread,
          dtwDistance(own[i].feat, own[i].frames, own[j].feat, own[j].frames),
        );
    const limit = Math.max(MIN_LIMIT, spread * SPREAD_FACTOR);
    const distance = Math.min(
      ...own.map((s) => dtwDistance(q.feat, q.frames, s.feat, s.frames)),
    );
    if (
      distance <= limit &&
      (!best || distance / limit < best.distance / best.limit)
    )
      best = { key, distance, limit };
  }
  return best;
}

/** Sentence rule: MY NAME (or I NAME) -> the user's name is added. */
export function completeSentence(
  keys: string[],
  userName: string,
  lang: "id" | "en",
): string | null {
  const last2 = keys.slice(-2).join(" ");
  if (
    last2 !== `${CUSTOM_PREFIX}MY ${CUSTOM_PREFIX}NAME` &&
    last2 !== `${CUSTOM_PREFIX}I ${CUSTOM_PREFIX}NAME`
  )
    return null;
  const name = userName.trim() || "…";
  return lang === "id" ? `nama saya ${name}` : `my name is ${name}`;
}

export const customWord = (sign: string) =>
  sign.startsWith(CUSTOM_PREFIX)
    ? CUSTOM_WORDS.find((w) => CUSTOM_PREFIX + w.key === sign)
    : undefined;
