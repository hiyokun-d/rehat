// SYNTHETIC tracker output for the "Coba tanpa kamera" demo and visual tests: a figure that
// waves one hand, nods, blinks and talks. Not a measurement and not a real sign.
import type {
  HolisticLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { EYES, FACE_OVAL, OUTER_LIPS } from "./faceIndices";
import { LIPS } from "./preprocess";

const pt = (x: number, y: number): NormalizedLandmark => ({
  x,
  y,
  z: 0,
  visibility: 1,
});

function hand(
  wx: number,
  wy: number,
  angle: number,
  size: number,
  curl: number,
): NormalizedLandmark[] {
  const out = [pt(wx, wy)];
  // 5 fingers fanned around `angle`, 4 joints each (MediaPipe order: thumb, index..pinky).
  for (let f = 0; f < 5; f++) {
    const a = angle + (f - 2) * 0.28 + (f === 0 ? -0.5 : 0);
    let x = wx + Math.cos(a) * size * 0.9;
    let y = wy + Math.sin(a) * size * 0.9;
    for (let j = 0; j < 4; j++) {
      out.push(pt(x, y));
      const bend = a + j * curl;
      x += Math.cos(bend) * size * 0.35;
      y += Math.sin(bend) * size * 0.35;
    }
  }
  return out;
}

export function syntheticFrame(tMs: number): HolisticLandmarkerResult {
  const t = tMs / 1000;
  const nod = Math.sin(t * 1.3) * 0.01;
  const tilt = Math.sin(t * 0.7) * 0.12;
  const cx = 0.5 + Math.sin(t * 0.5) * 0.04;
  const cy = 0.36 + nod;
  const r = 0.11;
  const rot = (dx: number, dy: number) =>
    pt(
      cx + (dx * Math.cos(tilt) - dy * Math.sin(tilt)) * r * 0.5625,
      cy + (dx * Math.sin(tilt) + dy * Math.cos(tilt)) * r,
    );

  const face = Array.from({ length: 478 }, () => rot(0, 0));
  FACE_OVAL.forEach((idx, k) => {
    const a = -Math.PI / 2 + (k / FACE_OVAL.length) * Math.PI * 2;
    face[idx] = rot(Math.cos(a) * 0.85, Math.sin(a));
  });
  const blink = t % 3.2 < 0.15 ? 0.01 : 0.09; // blink every 3.2 s
  EYES.forEach(([outer, inner, up, low], k) => {
    const s = k ? 1 : -1; // k=0 subject's right eye (picture left)
    face[outer] = rot(s * 0.55, -0.15);
    face[inner] = rot(s * 0.2, -0.15);
    face[up] = rot(s * 0.37, -0.15 - blink);
    face[low] = rot(s * 0.37, -0.15 + blink);
  });
  const talk = 0.03 + Math.max(0, Math.sin(t * 7)) * 0.12;
  [...OUTER_LIPS, ...LIPS].forEach((idx, k, all) => {
    const a = (k / all.length) * Math.PI * 2;
    face[idx] = rot(Math.cos(a) * 0.3, 0.5 + Math.sin(a) * (0.06 + talk / 2));
  });
  face[13] = rot(0, 0.5 - talk / 2);
  face[14] = rot(0, 0.5 + talk / 2);
  face[1] = rot(Math.sin(t * 0.9) * 0.12, 0.2); // nose: turning head
  face[234] = rot(-0.85, 0.1);
  face[454] = rot(0.85, 0.1);

  // Body: the subject waves their right hand (picture left), the other rests low.
  const wave = Math.sin(t * 4);
  const pose = Array.from({ length: 33 }, () => pt(0.5, 0.9));
  pose[11] = pt(0.62, 0.62);
  pose[12] = pt(0.38, 0.62);
  pose[13] = pt(0.7, 0.8);
  pose[15] = pt(0.66, 0.95);
  pose[14] = pt(0.27, 0.55);
  pose[16] = pt(0.25 + wave * 0.04, 0.38);
  const right = hand(
    pose[16].x,
    pose[16].y,
    -Math.PI / 2 + wave * 0.35,
    0.07,
    0.05,
  );
  return {
    faceLandmarks: [face],
    faceBlendshapes: [],
    poseLandmarks: [pose],
    poseWorldLandmarks: [],
    poseSegmentationMasks: [],
    leftHandLandmarks: [],
    leftHandWorldLandmarks: [],
    rightHandLandmarks: [right],
    rightHandWorldLandmarks: [],
  } as unknown as HolisticLandmarkerResult;
}
