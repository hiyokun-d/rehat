// "VTuber" look: draws gloves on the hands and a mask on the face from MediaPipe Holistic
// landmarks, on a plain background (the camera image is hidden: nice for privacy too).
// Pure canvas drawing; the recogniser does not use any of this.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { EYES, FACE_OVAL, OUTER_LIPS } from "@/lib/asl/faceIndices";
import { HAND_BONES } from "@/lib/gesture/handTopology";

type Pt = NormalizedLandmark;
type Proj = (p: Pt) => readonly [number, number];

const PALM = [0, 1, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

export interface AvatarColors {
  bg: string;
  glove: string;
  gloveLine: string;
  mask: string;
  maskAccent: string;
  ink: string;
  body: string;
}

const dist = (P: Proj, a: Pt, b: Pt) => {
  const [ax, ay] = P(a);
  const [bx, by] = P(b);
  return Math.hypot(ax - bx, ay - by);
};

function path(ctx: CanvasRenderingContext2D, P: Proj, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i) ctx.lineTo(...P(p));
    else ctx.moveTo(...P(p));
  });
  ctx.closePath();
}

export function drawBody(
  ctx: CanvasRenderingContext2D,
  P: Proj,
  pose: Pt[] | undefined,
  c: AvatarColors,
) {
  if (!pose) return;
  const sh = dist(P, pose[11], pose[12]); // shoulder width sets the scale
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = c.body;
  // Torso: shoulders down off-screen.
  const [lx, ly] = P(pose[11]);
  const [rx, ry] = P(pose[12]);
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.lineTo(rx, ry + sh * 2);
  ctx.lineTo(lx, ly + sh * 2);
  ctx.closePath();
  ctx.fill();
  // Sleeves: shoulder -> elbow -> wrist.
  ctx.lineWidth = sh * 0.28;
  for (const [a, b, w] of [
    [11, 13, 15],
    [12, 14, 16],
  ]) {
    ctx.beginPath();
    ctx.moveTo(...P(pose[a]));
    ctx.lineTo(...P(pose[b]));
    ctx.lineTo(...P(pose[w]));
    ctx.stroke();
  }
}

export function drawGlove(
  ctx: CanvasRenderingContext2D,
  P: Proj,
  hand: Pt[] | undefined,
  c: AvatarColors,
) {
  if (!hand?.length) return;
  const size = dist(P, hand[0], hand[9]); // wrist -> middle knuckle
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Fat fingers, then palm, then a thin outline for that cartoon look.
  ctx.strokeStyle = c.glove;
  ctx.lineWidth = size * 0.32;
  for (const [a, b] of HAND_BONES) {
    ctx.beginPath();
    ctx.moveTo(...P(hand[a]));
    ctx.lineTo(...P(hand[b]));
    ctx.stroke();
  }
  ctx.fillStyle = c.glove;
  path(
    ctx,
    P,
    PALM.map((i) => hand[i]),
  );
  ctx.fill();
  ctx.lineWidth = size * 0.3;
  ctx.stroke();
  // Cuff at the wrist.
  ctx.fillStyle = c.gloveLine;
  ctx.beginPath();
  ctx.arc(...P(hand[0]), size * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // Knuckle seams + fingertip dots.
  ctx.strokeStyle = c.gloveLine;
  ctx.lineWidth = Math.max(1.5, size * 0.04);
  for (const [a, b] of HAND_BONES) {
    ctx.beginPath();
    ctx.moveTo(...P(hand[a]));
    ctx.lineTo(...P(hand[b]));
    ctx.stroke();
  }
  ctx.fillStyle = c.gloveLine;
  for (const i of TIPS) {
    ctx.beginPath();
    ctx.arc(...P(hand[i]), size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMask(
  ctx: CanvasRenderingContext2D,
  P: Proj,
  face: Pt[] | undefined,
  c: AvatarColors,
) {
  if (!face?.length) return;
  const eyeSpan = dist(P, face[33], face[263]);
  // Mask shape.
  ctx.fillStyle = c.mask;
  path(
    ctx,
    P,
    FACE_OVAL.map((i) => face[i]),
  );
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(2, eyeSpan * 0.04);
  ctx.stroke();
  // Cheek stripes (just for looks).
  ctx.strokeStyle = c.maskAccent;
  ctx.lineWidth = eyeSpan * 0.06;
  ctx.lineCap = "round";
  for (const [eye, cheek] of [
    [33, 234],
    [263, 454],
  ]) {
    const [ex, ey] = P(face[eye]);
    const [cx, cy] = P(face[cheek]);
    for (const k of [0.35, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(ex + (cx - ex) * k, ey + (cy - ey) * k + eyeSpan * 0.12);
      ctx.lineTo(ex + (cx - ex) * k, ey + (cy - ey) * k + eyeSpan * 0.32);
      ctx.stroke();
    }
  }
  // Eyes follow blinks: height from the real eyelid gap.
  ctx.fillStyle = c.ink;
  for (const [outer, inner, up, low] of EYES) {
    const [ox, oy] = P(face[outer]);
    const [ix, iy] = P(face[inner]);
    const w = Math.hypot(ox - ix, oy - iy);
    const open = dist(P, face[up], face[low]) / Math.max(1, w); // ~0.3 open, ~0.05 closed
    ctx.beginPath();
    ctx.ellipse(
      (ox + ix) / 2,
      (oy + iy) / 2,
      w * 0.5,
      Math.max(w * 0.06, w * open * 0.9),
      Math.atan2(iy - oy, ix - ox),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Mouth follows the real lips (the model reads them, so they stay visible).
  ctx.fillStyle = c.ink;
  path(
    ctx,
    P,
    OUTER_LIPS.map((i) => face[i]),
  );
  ctx.fill();
}

/** Cartoon phone (rounded body + screen) for the avatar view. */
export function drawPhone(
  ctx: CanvasRenderingContext2D,
  r: { cx: number; cy: number; w: number; h: number; angle: number },
  body: string,
  screen: string,
) {
  ctx.save();
  ctx.translate(r.cx, r.cy);
  ctx.rotate(r.angle);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, r.w * 0.18);
  ctx.fill();
  ctx.fillStyle = screen;
  ctx.beginPath();
  ctx.roundRect(
    -r.w / 2 + r.w * 0.1,
    -r.h / 2 + r.h * 0.08,
    r.w * 0.8,
    r.h * 0.8,
    r.w * 0.08,
  );
  ctx.fill();
  ctx.restore();
}
