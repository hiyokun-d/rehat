// Laptop -> phone mirror: the laptop runs the camera + tracker and sends ONLY the landmarks
// the phone needs to draw (no video), ~15 times per second over the existing relay.
// ~150 points x 2 numbers, rounded to 3 decimals: about 2 KB per frame on the LAN.
import type {
  HolisticLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { EYES, FACE_OVAL, OUTER_LIPS } from "./faceIndices";
import type { PhoneEstimate } from "./phoneLocator";
import type { FrameChecks } from "./preprocess";
import { LIPS } from "./preprocess";

/** Face points the overlay/avatar draw (lips for the model view, oval/eyes/cheeks for the mask). */
export const FACE_SEND = [
  ...new Set([
    ...FACE_OVAL,
    ...OUTER_LIPS,
    ...LIPS,
    ...EYES.flat(),
    1,
    234,
    454,
  ]),
].sort((a, b) => a - b);
const FACE_N = 478;
const POSE_N = 33;

export interface AslFrameMsg {
  f: number[] | null; // x,y for FACE_SEND
  p: number[] | null; // x,y for 33 pose points
  l: number[] | null; // x,y for 21 left-hand points
  r: number[] | null; // x,y for 21 right-hand points
  a?: number; // source picture width / height (to draw without distortion)
  ph?: PhoneEstimate | null; // where the laptop thinks the phone is
}

/** Phone -> laptop: motion for "which hand holds the phone" (gyro °/s) and its tilt (gravity). */
export interface AslImuMsg {
  points: { t: number; g: number }[];
  grav: [number, number, number] | null;
}

export interface AslStatusMsg {
  fps: number;
  recording: number;
  checks: FrameChecks | null;
  light: number | null;
  live: { sign: string; p: number }[] | null;
}

export interface AslResultMsg {
  top: { sign: string; p: number }[];
  handFrames: number;
  ms: number;
  spoken: boolean; // passed the confidence limit on the laptop
  afterStillMs?: number; // hand stopped -> result
  early?: boolean; // accepted before the sign ended
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const flat = (pts: NormalizedLandmark[] | undefined, idx?: number[]) =>
  pts?.length
    ? (idx ?? pts.map((_, i) => i)).flatMap((i) => [r3(pts[i].x), r3(pts[i].y)])
    : null;

export function packFrame(res: HolisticLandmarkerResult): AslFrameMsg {
  return {
    f: flat(res.faceLandmarks[0], FACE_SEND),
    p: flat(res.poseLandmarks[0]),
    l: flat(res.leftHandLandmarks[0]),
    r: flat(res.rightHandLandmarks[0]),
  };
}

const pt = (x: number, y: number): NormalizedLandmark => ({
  x,
  y,
  z: 0,
  visibility: 1,
});

/** Back to the shape the overlay draws. Face is sparse: only FACE_SEND indices are filled. */
export function unpackFrame(m: AslFrameMsg): HolisticLandmarkerResult {
  const seq = (a: number[] | null, n: number) =>
    a ? [Array.from({ length: n }, (_, i) => pt(a[i * 2], a[i * 2 + 1]))] : [];
  let face: NormalizedLandmark[][] = [];
  if (m.f) {
    const arr = new Array<NormalizedLandmark>(FACE_N).fill(
      pt(Number.NaN, Number.NaN),
    );
    FACE_SEND.forEach((idx, k) => {
      arr[idx] = pt(m.f?.[k * 2] ?? 0, m.f?.[k * 2 + 1] ?? 0);
    });
    face = [arr];
  }
  return {
    faceLandmarks: face,
    faceBlendshapes: [],
    poseLandmarks: seq(m.p, POSE_N),
    poseWorldLandmarks: [],
    poseSegmentationMasks: [],
    leftHandLandmarks: seq(m.l, 21),
    leftHandWorldLandmarks: [],
    rightHandLandmarks: seq(m.r, 21),
    rightHandWorldLandmarks: [],
  } as unknown as HolisticLandmarkerResult;
}
