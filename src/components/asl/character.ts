// "Kiko": an original cloud-fox spirit for the avatar view (team's own design, just for fun).
// Driven by the tracker: head position/size/tilt from the face, blinking eyes and an opening
// mouth from the real eyelids and lips, paws on the hands, a hoodie on the shoulders.
// Ears, side hair and the head sprout are spring chains (springChain.ts), so they swing and
// settle like VTuber hair. The recogniser does not use any of this.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { EYES, FACE_OVAL } from "@/lib/asl/faceIndices";
import { SpringChain, type SpringParams } from "@/lib/tracking/springChain";
import { type AvatarColors, drawBody, drawGlove } from "./avatar";

type Pt = NormalizedLandmark;
type Proj = (p: Pt) => readonly [number, number];

// Looks, tuned by eye.
const EAR: SpringParams = { stiffness: 3.2, drag: 0.35, gravity: 30 };
const HAIR: SpringParams = { stiffness: 1.2, drag: 0.18, gravity: 220 };
const SPROUT: SpringParams = { stiffness: 9, drag: 0.2, gravity: 6 }; // stiff stalk, still wobbles

export interface KikoColors {
  fur: string;
  furDark: string;
  belly: string;
  ink: string;
  blush: string;
  bg: string;
  hoodie: string;
}

/** Path through the chain's joints (caller strokes it). */
function strokeThrough(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
) {
  pts.forEach((j, i) => {
    if (i) ctx.lineTo(j.x, j.y);
    else ctx.moveTo(j.x, j.y);
  });
}

export class KikoRig {
  private ears = [new SpringChain(2, 1, EAR), new SpringChain(2, 1, EAR)];
  private hair = [new SpringChain(4, 1, HAIR), new SpringChain(4, 1, HAIR)];
  private sprout = new SpringChain(3, 1, SPROUT);
  private lastT = 0;

  draw(
    ctx: CanvasRenderingContext2D,
    P: Proj,
    res: { face?: Pt[]; pose?: Pt[]; left?: Pt[]; right?: Pt[] },
    c: KikoColors,
  ) {
    const now = performance.now();
    const dt = this.lastT ? (now - this.lastT) / 1000 : 1 / 30;
    this.lastT = now;

    const body: AvatarColors = {
      bg: c.bg,
      glove: c.fur,
      gloveLine: c.furDark,
      mask: c.fur,
      maskAccent: c.blush,
      ink: c.ink,
      body: c.hoodie,
    };
    drawBody(ctx, P, res.pose, body);

    const face = res.face;
    if (face?.length) this.drawHead(ctx, P, face, c, dt);

    drawGlove(ctx, P, res.left, body); // paws
    drawGlove(ctx, P, res.right, body);
  }

  private drawHead(
    ctx: CanvasRenderingContext2D,
    P: Proj,
    face: Pt[],
    c: KikoColors,
    dt: number,
  ) {
    const oval = FACE_OVAL.map((i) => P(face[i])).filter(([x]) =>
      Number.isFinite(x),
    );
    if (!oval.length) return;
    const cx = oval.reduce((s, p) => s + p[0], 0) / oval.length;
    const cy = oval.reduce((s, p) => s + p[1], 0) / oval.length;
    // Eye line gives size and tilt (ordered left-to-right on screen).
    const [e1, e2] = [P(face[33]), P(face[263])].sort((a, b) => a[0] - b[0]);
    const span = Math.hypot(e2[0] - e1[0], e2[1] - e1[1]);
    const tilt = Math.atan2(e2[1] - e1[1], e2[0] - e1[0]);
    const R = span * 1.35; // head radius
    const at = (dx: number, dy: number) => {
      // head-local offset (in R units) -> screen, rotated with the head
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      return {
        x: cx + (dx * cos - dy * sin) * R,
        y: cy + (dx * sin + dy * cos) * R,
      };
    };

    // Physics: ears point up-out, hair hangs down from the sides, sprout points up.
    const ears = this.ears.map((ch, k) => {
      const side = k ? 1 : -1;
      return ch.step(
        at(0.62 * side, -0.62),
        tilt - Math.PI / 2 + side * 0.45,
        dt,
        R * 0.42,
      );
    });
    const hair = this.hair.map((ch, k) =>
      ch.step(at((k ? 1 : -1) * 0.9, 0.05), tilt + Math.PI / 2, dt, R * 0.28),
    );
    const sprout = this.sprout.step(
      at(0, -0.98),
      tilt - Math.PI / 2,
      dt,
      R * 0.16,
    );

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Hair strands behind the head.
    ctx.strokeStyle = c.furDark;
    for (const h of hair) {
      ctx.lineWidth = R * 0.28;
      ctx.beginPath();
      strokeThrough(ctx, h);
      ctx.stroke();
    }
    // Ears: triangles from the base along the swinging chain.
    for (const e of ears) {
      const base = e[0];
      const tip = e[e.length - 1];
      const nx = -(tip.y - base.y);
      const ny = tip.x - base.x;
      const nl = Math.hypot(nx, ny) || 1;
      const wv = R * 0.32;
      ctx.fillStyle = c.fur;
      ctx.beginPath();
      ctx.moveTo(base.x + (nx / nl) * wv, base.y + (ny / nl) * wv);
      ctx.quadraticCurveTo(e[1].x, e[1].y, tip.x, tip.y);
      ctx.lineTo(base.x - (nx / nl) * wv, base.y - (ny / nl) * wv);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c.blush;
      ctx.beginPath();
      ctx.moveTo(
        base.x + (nx / nl) * wv * 0.45,
        base.y + (ny / nl) * wv * 0.45,
      );
      ctx.lineTo(e[1].x, e[1].y);
      ctx.lineTo(
        base.x - (nx / nl) * wv * 0.45,
        base.y - (ny / nl) * wv * 0.45,
      );
      ctx.closePath();
      ctx.fill();
    }
    // Head: a soft round blob with a lighter muzzle.
    ctx.fillStyle = c.fur;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.92, tilt, 0, Math.PI * 2);
    ctx.fill();
    const muzzle = at(0, 0.38);
    ctx.fillStyle = c.belly;
    ctx.beginPath();
    ctx.ellipse(muzzle.x, muzzle.y, R * 0.55, R * 0.42, tilt, 0, Math.PI * 2);
    ctx.fill();
    // Sprout (leaf on a stalk).
    ctx.strokeStyle = c.furDark;
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    strokeThrough(ctx, sprout);
    ctx.stroke();
    const leaf = sprout[sprout.length - 1];
    ctx.fillStyle = c.hoodie;
    ctx.beginPath();
    ctx.ellipse(leaf.x, leaf.y, R * 0.16, R * 0.08, tilt - 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Eyes: big, with highlights; height follows the real eyelid gap (blinks).
    EYES.forEach(([outer, inner, up, low]) => {
      const w =
        Math.hypot(
          P(face[outer])[0] - P(face[inner])[0],
          P(face[outer])[1] - P(face[inner])[1],
        ) || 1;
      const open = Math.min(
        1,
        (Math.hypot(
          P(face[up])[0] - P(face[low])[0],
          P(face[up])[1] - P(face[low])[1],
        ) /
          w) *
          3.2,
      );
      const sideOnScreen = P(face[outer])[0] < cx ? -1 : 1;
      const e = at(0.38 * sideOnScreen, -0.05);
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.ellipse(
        e.x,
        e.y,
        R * 0.15,
        Math.max(R * 0.025, R * 0.2 * open),
        tilt,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (open > 0.35) {
        ctx.fillStyle = c.belly;
        ctx.beginPath();
        ctx.arc(
          e.x - R * 0.05,
          e.y - R * 0.07 * open,
          R * 0.05,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    });
    // Blush.
    ctx.fillStyle = c.blush;
    for (const s of [-1, 1]) {
      const b = at(0.6 * s, 0.25);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, R * 0.14, R * 0.08, tilt, 0, Math.PI * 2);
      ctx.fill();
    }
    // Nose + mouth: opens with the real lips (13 upper inner, 14 lower inner).
    const mouthOpen = Math.min(
      1,
      (Math.hypot(
        P(face[13])[0] - P(face[14])[0],
        P(face[13])[1] - P(face[14])[1],
      ) /
        span) *
        2.5,
    );
    const nose = at(0, 0.22);
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.ellipse(nose.x, nose.y, R * 0.07, R * 0.05, tilt, 0, Math.PI * 2);
    ctx.fill();
    const m = at(0, 0.45);
    ctx.beginPath();
    ctx.ellipse(
      m.x,
      m.y,
      R * 0.13,
      Math.max(R * 0.02, R * 0.16 * mouthOpen),
      tilt,
      0,
      Math.PI,
    );
    ctx.fill();
  }
}
