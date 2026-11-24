// Pretrained ASL model input. TypeScript port of app/web/preprocess.js from
// github.com/ceydaakin/asl-realtime (MIT, (c) ceyda akin). Must stay identical to the
// training preprocessing, or the model sees inputs it never learned: tests/asl.test.ts checks
// it against the upstream fixture (tests/fixtures/asl-window.json, written by their Python code).
//
// A frame = Float32Array of 543 * 2 (x, y per MediaPipe Holistic landmark), NaN = not detected.
// Holistic order: 468 face, 21 left hand, 33 pose, 21 right hand.
// The model uses 66 of them: 40 lip points + the dominant hand (21) + dominant arm (5):
// so it reads the face (mouth), the hand shape AND the arm movement over time.

export const INPUT_SIZE = 64;
export const N_COLS = 66;
const N_HOLISTIC = 543;

const range = (start: number, stop: number) =>
  Array.from({ length: stop - start }, (_, i) => start + i);
export const LIPS = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 146, 91, 181, 84, 17, 314,
  405, 321, 375, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 95, 88, 178, 87,
  14, 317, 402, 318, 324, 308,
];
export const LEFT_HAND = range(468, 489);
export const RIGHT_HAND = range(522, 543);
export const LEFT_ARM = [502, 504, 506, 508, 510];
export const RIGHT_ARM = [503, 505, 507, 509, 511];
const LEFT_DOMINANT = [...LIPS, ...LEFT_HAND, ...LEFT_ARM];
const RIGHT_DOMINANT = [...LIPS, ...RIGHT_HAND, ...RIGHT_ARM];

type Pt = { x: number; y: number };
export interface HolisticLike {
  faceLandmarks?: Pt[][];
  leftHandLandmarks?: Pt[][];
  poseLandmarks?: Pt[][];
  rightHandLandmarks?: Pt[][];
}
const PARTS: [keyof HolisticLike, number, number][] = [
  ["faceLandmarks", 0, 468],
  ["leftHandLandmarks", 468, 21],
  ["poseLandmarks", 489, 33],
  ["rightHandLandmarks", 522, 21],
];

export const detected = (frame: Float32Array, idxs: number[]) =>
  idxs.some((i) => !Number.isNaN(frame[i * 2]));

/** MediaPipe HolisticLandmarkerResult -> frame. */
export function holisticFrame(result: HolisticLike): Float32Array {
  const frame = new Float32Array(N_HOLISTIC * 2).fill(Number.NaN);
  for (const [field, start, count] of PARTS) {
    const points = result[field]?.[0];
    if (!points?.length) continue;
    for (let i = 0; i < count; i++) {
      frame[(start + i) * 2] = points[i].x;
      frame[(start + i) * 2 + 1] = points[i].y;
    }
  }
  return frame;
}

/** np.array_split: the first (n % parts) chunks are one longer. */
function chunks(n: number, parts: number): [number, number][] {
  const base = Math.floor(n / parts);
  const extra = n % parts;
  let start = 0;
  return range(0, parts).map((i) => {
    const size = base + (i < extra ? 1 : 0);
    start += size;
    return [start - size, start];
  });
}

export interface AslWindow {
  xy: Float32Array; // 64 * 66 * 2
  mask: Float32Array; // 64
  length: number; // real frames used
}

/** frames -> the model's 64-frame window (only frames where the dominant hand is visible). */
export function toWindow(frames: Float32Array[]): AslWindow {
  const left = frames.filter((f) => detected(f, LEFT_HAND));
  const right = frames.filter((f) => detected(f, RIGHT_HAND));
  const leftDominant = left.length >= right.length;
  const idxs = leftDominant ? LEFT_DOMINANT : RIGHT_DOMINANT;
  const clip = (leftDominant ? left : right).map((frame) => {
    const out = new Float32Array(N_COLS * 2);
    idxs.forEach((src, col) => {
      const x = frame[src * 2];
      // Right-dominant clips are mirrored: hand and arm, not the lips.
      out[col * 2] = leftDominant || col < LIPS.length ? x : 1 - x;
      out[col * 2 + 1] = frame[src * 2 + 1];
    });
    return out;
  });

  const spans =
    clip.length > INPUT_SIZE
      ? chunks(clip.length, INPUT_SIZE)
      : clip.map((_, i): [number, number] => [i, i + 1]);
  const xy = new Float32Array(INPUT_SIZE * N_COLS * 2);
  spans.forEach(([start, stop], t) => {
    for (let v = 0; v < N_COLS * 2; v++) {
      let sum = 0;
      let count = 0;
      for (let i = start; i < stop; i++) {
        if (!Number.isNaN(clip[i][v])) {
          sum += clip[i][v];
          count++;
        }
      }
      xy[t * N_COLS * 2 + v] = count ? sum / count : 0;
    }
  });
  const mask = new Float32Array(INPUT_SIZE);
  mask.fill(1, 0, spans.length);
  return { xy, mask, length: spans.length };
}

/**
 * A sign = a run of frames with a hand in view. push() returns its frames once the hand has
 * been gone for `gap` frames ("raise hand, sign, lower hand"), else null.
 */
export class SignSegmenter {
  gap: number;
  minFrames: number;
  maxFrames: number;
  frames: Float32Array[] = [];
  handFrames = 0;
  private missing = 0;

  constructor({ gap = 8, minFrames = 4, maxFrames = 4 * INPUT_SIZE } = {}) {
    this.gap = gap;
    this.minFrames = minFrames;
    this.maxFrames = maxFrames;
  }

  reset() {
    this.frames = [];
    this.handFrames = 0;
    this.missing = 0;
  }

  push(frame: Float32Array): Float32Array[] | null {
    const hand = detected(frame, LEFT_HAND) || detected(frame, RIGHT_HAND);
    if (!hand && !this.frames.length) return null;
    this.frames.push(frame); // reset() makes a new array, so returned clips stay intact
    this.handFrames += hand ? 1 : 0;
    this.missing = hand ? 0 : this.missing + 1;
    if (this.missing < this.gap && this.frames.length < this.maxFrames)
      return null;
    const { frames, handFrames } = this;
    this.reset();
    return handFrames >= this.minFrames ? frames : null;
  }
}

/** What the camera can see right now: the "why is it not working" checklist. */
export interface FrameChecks {
  hand: boolean;
  face: boolean; // lips found
  arm: boolean; // dominant-side elbow + wrist inside the picture
  handSize: number; // hand bounding-box height as a fraction of the picture (0..1)
}

export function frameChecks(f: Float32Array): FrameChecks {
  const inside = (i: number) => {
    const x = f[i * 2];
    const y = f[i * 2 + 1];
    return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  };
  const left = detected(f, LEFT_HAND);
  const hand = left ? LEFT_HAND : RIGHT_HAND;
  const arm = left ? LEFT_ARM : RIGHT_ARM;
  let y0 = 1;
  let y1 = 0;
  for (const i of hand) {
    const y = f[i * 2 + 1];
    if (!Number.isNaN(y)) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return {
    hand: left || detected(f, RIGHT_HAND),
    face: detected(f, LIPS),
    arm: inside(arm[0]) && inside(arm[1]),
    handSize: Math.max(0, y1 - y0),
  };
}
