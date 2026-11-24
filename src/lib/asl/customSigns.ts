// Words the pretrained model does not know (its vocabulary is toddlers' first words: no I/MY/
// NAME). The user records each one 2-3 times; we match new signs against those recordings with
// DTW, in front of the model. Recordings only work for the person who made them.
//
// Features come from the SAME 64-frame window the model gets (toWindow), so nothing extra is
// tracked: dominant hand (21 pts) + elbow + wrist, relative to the mouth centre and scaled by
// mouth width (so standing a bit further/closer or to the side matters less).
import { type AslWindow, LIPS, N_COLS } from "./preprocess";

export const CUSTOM_PREFIX = "custom:";

/**
 * Everyday words missing from the model's 250 (checked against signs.json on 2026-11-25).
 * `hint` is a short memory aid written by the team, NOT a sign lesson: always check the
 * SignASL.org video ("Lihat caranya") and, ideally, a Deaf signer. Many signs have variants.
 */
export const CUSTOM_WORDS = [
  { key: "I", id: "saya", en: "I", hint: "Telunjuk menunjuk dada sendiri." },
  {
    key: "ME",
    id: "aku",
    en: "me",
    hint: "Telunjuk menunjuk dada sendiri (sama dengan I).",
  },
  {
    key: "YOU",
    id: "kamu",
    en: "you",
    hint: "Telunjuk menunjuk lawan bicara.",
  },
  {
    key: "NAME",
    id: "nama",
    en: "name",
    hint: "Dua jari (H) mengetuk dua jari tangan lain, 2x.",
  },
  {
    key: "FRIEND",
    id: "teman",
    en: "friend",
    hint: "Telunjuk bengkok saling mengait, dibalik, mengait lagi.",
  },
  {
    key: "LOVE",
    id: "sayang",
    en: "love",
    hint: "Kedua kepalan menyilang di dada.",
  },
  {
    key: "HELP",
    id: "tolong",
    en: "help",
    hint: "Kepalan jempol tegak di atas telapak, diangkat bersama.",
  },
  {
    key: "WANT",
    id: "mau",
    en: "want",
    hint: "Dua tangan cakar, telapak ke atas, ditarik ke badan.",
  },
  {
    key: "NEED",
    id: "butuh",
    en: "need",
    hint: "Telunjuk bengkok (X) ditekuk ke bawah 2x.",
  },
  {
    key: "WHAT",
    id: "apa",
    en: "what",
    hint: "Kedua telapak ke atas, digoyang sedikit ke samping.",
  },
  {
    key: "HOW",
    id: "bagaimana",
    en: "how",
    hint: "Punggung jari bengkok bertemu, diputar ke depan.",
  },
  {
    key: "SORRY",
    id: "maaf",
    en: "sorry",
    hint: "Kepalan (A) memutar di dada.",
  },
  {
    key: "GOOD",
    id: "baik",
    en: "good",
    hint: "Telapak dari dagu turun ke telapak tangan lain.",
  },
  {
    key: "NICE",
    id: "senang",
    en: "nice",
    hint: "Telapak mengusap telapak tangan lain ke depan.",
  },
  {
    key: "MEET",
    id: "bertemu",
    en: "meet",
    hint: "Dua telunjuk tegak saling mendekat.",
  },
  {
    key: "EAT",
    id: "makan",
    en: "eat",
    hint: "Ujung jari menguncup mengetuk mulut.",
  },
  {
    key: "WORK",
    id: "kerja",
    en: "work",
    hint: "Kepalan mengetuk pergelangan kepalan lain, 2x.",
  },
  {
    key: "SCHOOL",
    id: "sekolah",
    en: "school",
    hint: "Telapak menepuk telapak lain, 2x.",
  },
  { key: "KNOW", id: "tahu", en: "know", hint: "Ujung jari mengetuk dahi." },
  {
    key: "UNDERSTAND",
    id: "mengerti",
    en: "understand",
    hint: "Kepalan di dahi, telunjuk dijentikkan ke atas.",
  },
  {
    key: "LEARN",
    id: "belajar",
    en: "learn",
    hint: "Jari 'mengambil' dari telapak, dibawa ke dahi.",
  },
  {
    key: "AGAIN",
    id: "lagi",
    en: "again",
    hint: "Tangan bengkok dibalik ke telapak tangan lain.",
  },
  {
    key: "MORE",
    id: "tambah",
    en: "more",
    hint: "Ujung jari kedua tangan menguncup, diketuk 2x.",
  },
  {
    key: "DEAF",
    id: "Tuli",
    en: "Deaf",
    hint: "Telunjuk menyentuh dekat telinga lalu dekat mulut.",
  },
  {
    key: "FAMILY",
    id: "keluarga",
    en: "family",
    hint: "Dua tangan F memutar ke depan sampai bertemu kelingking.",
  },
  {
    key: "SIGN",
    id: "bahasa isyarat",
    en: "sign",
    hint: "Dua telunjuk berputar bergantian di depan dada.",
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

/** Model signs that mean the same as a custom word, so both count in phrases. */
const ALIASES: Record<string, string> = {
  minemy: "MY",
  hesheit: "HE",
  weus: "WE",
};
/** Word token (model sign or "custom:KEY") -> phrase key. */
export const phraseKey = (token: string) =>
  token.startsWith(CUSTOM_PREFIX)
    ? token.slice(CUSTOM_PREFIX.length)
    : (ALIASES[token] ?? token.toUpperCase());

/**
 * Short phrases: when the last signs match `seq`, they are replaced by a natural sentence.
 * ASL word order and Indonesian word order differ, so word-by-word is often wrong. `{name}` =
 * the user's name. Written by the team, not by a Deaf signer: ASSUMPTION until checked.
 */
export const PHRASES: { seq: string[]; id: string; en: string }[] = [
  { seq: ["MY", "NAME"], id: "nama saya {name}", en: "my name is {name}" },
  { seq: ["I", "NAME"], id: "nama saya {name}", en: "my name is {name}" },
  { seq: ["ME", "NAME"], id: "nama saya {name}", en: "my name is {name}" },
  {
    seq: ["YOU", "NAME", "WHAT"],
    id: "siapa namamu?",
    en: "what is your name?",
  },
  {
    seq: ["NICE", "MEET", "YOU"],
    id: "senang bertemu denganmu",
    en: "nice to meet you",
  },
  { seq: ["I", "LOVE", "YOU"], id: "aku sayang kamu", en: "I love you" },
  { seq: ["HOW", "YOU"], id: "apa kabar?", en: "how are you?" },
  { seq: ["I", "FINE"], id: "saya baik-baik saja", en: "I'm fine" },
  { seq: ["I", "NEED", "HELP"], id: "saya butuh bantuan", en: "I need help" },
  { seq: ["HELP", "PLEASE"], id: "tolong bantu saya", en: "please help me" },
  { seq: ["I", "DEAF"], id: "saya Tuli", en: "I am Deaf" },
  {
    seq: ["I", "NOT", "UNDERSTAND"],
    id: "saya tidak mengerti",
    en: "I don't understand",
  },
  { seq: ["AGAIN", "PLEASE"], id: "tolong ulangi", en: "again, please" },
  { seq: ["YOU", "FRIEND"], id: "kamu temanku", en: "you are my friend" },
  { seq: ["I", "WANT", "EAT"], id: "saya mau makan", en: "I want to eat" },
  { seq: ["I", "HUNGRY"], id: "saya lapar", en: "I'm hungry" },
  { seq: ["I", "THIRSTY"], id: "saya haus", en: "I'm thirsty" },
  { seq: ["I", "SORRY"], id: "saya minta maaf", en: "I'm sorry" },
];

/** Longest phrase matching the end of `tokens`, with the name filled in. */
export function completeSentence(
  tokens: string[],
  userName: string,
  lang: "id" | "en",
): { replace: number; text: string } | null {
  const keys = tokens.map(phraseKey);
  let best: { replace: number; text: string } | null = null;
  for (const p of PHRASES) {
    if (p.seq.length > keys.length || (best && p.seq.length <= best.replace))
      continue;
    if (p.seq.every((k, i) => keys[keys.length - p.seq.length + i] === k))
      best = {
        replace: p.seq.length,
        text: p[lang].replace("{name}", userName.trim() || "…"),
      };
  }
  return best;
}

export const customWord = (sign: string) =>
  sign.startsWith(CUSTOM_PREFIX)
    ? CUSTOM_WORDS.find((w) => CUSTOM_PREFIX + w.key === sign)
    : undefined;
