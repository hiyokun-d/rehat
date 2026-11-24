// Face channel (optional) for Mode 2. Sign languages carry grammar and meaning on the face
// (brows for questions, mouth shapes, head nod/shake): "non-manual features". We keep a small,
// explainable set from MediaPipe Face Landmarker: 13 blendshape scores (0..1) + 3 head-pose
// numbers computed from landmarks. Matching is against the user's own recordings, so no
// person-independent calibration is needed. See docs/MODE2_RESEARCH.md.
import type { Landmark } from "./features";

/** Blendshape names (MediaPipe's 52-name set) that move during signing. */
export const FACE_BLENDSHAPES = [
  "browInnerUp",
  "browDownLeft",
  "browDownRight",
  "browOuterUpLeft",
  "browOuterUpRight",
  "eyeWideLeft",
  "eyeWideRight",
  "eyeSquintLeft",
  "eyeSquintRight",
  "jawOpen",
  "mouthPucker",
  "mouthSmileLeft",
  "cheekPuff",
] as const;

export const FACE_DIM = FACE_BLENDSHAPES.length + 3;

/**
 * Head pose from landmarks, no camera model: nose tip (1) relative to the eye-corner midpoint
 * (33, 263), in inter-eye units -> turn (x) and nod (y); eye-line angle -> tilt.
 * Rough, but stable and independent of MediaPipe's matrix conventions.
 */
export function headPose(lm: Landmark[]): [number, number, number] {
  const a = lm[33];
  const b = lm[263];
  const nose = lm[1];
  const eye = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return [
    (nose.x - mx) / eye,
    (nose.y - my) / eye - 0.5,
    Math.atan2(b.y - a.y, b.x - a.x),
  ];
}

export function faceFeatures(
  blendshapes: { categoryName: string; score: number }[] | undefined,
  landmarks: Landmark[] | undefined,
): number[] | null {
  if (!blendshapes?.length || !landmarks?.length) return null;
  const score = new Map(blendshapes.map((c) => [c.categoryName, c.score]));
  return [
    ...FACE_BLENDSHAPES.map((n) => score.get(n) ?? 0),
    ...headPose(landmarks),
  ];
}
