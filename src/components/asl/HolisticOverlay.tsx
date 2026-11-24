"use client";
// Two looks over the mirrored selfie video:
//  - "skeleton": exactly what the pretrained model reads: lips, hands, arms. If a part is not
//    drawn, the model does not see it either (debugging).
//  - "avatar":   VTuber look: gloves + mask on a plain background, camera image hidden.
import type { HolisticLandmarkerResult } from "@mediapipe/tasks-vision";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { type PhoneEstimate, phoneRect } from "@/lib/asl/phoneLocator";
import { LIPS } from "@/lib/asl/preprocess";
import { HAND_BONES } from "@/lib/gesture/handTopology";
import { PointsSmoother } from "@/lib/tracking/oneEuro";
import { drawBody, drawGlove, drawMask, drawPhone } from "./avatar";
import { KikoRig } from "./character";
import type { Human3D } from "./human3d";

export type OverlayMode = "skeleton" | "avatar" | "kiko" | "human";

export interface DrawOptions {
  mode: OverlayMode;
  /** Source picture width / height. Points are 0..1 of THAT picture, not of the box. */
  aspect: number;
  /** "cover" = same crop as the <video class="object-cover">; "contain" = whole picture (mirror). */
  fit: "cover" | "contain";
  /** Estimated phone in a hand (phoneLocator.ts), drawn as a rotated box. */
  phone?: PhoneEstimate | null;
}

export interface HolisticOverlayHandle {
  draw(res: HolisticLandmarkerResult, o: DrawOptions): void;
}

const ARMS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16], // shoulders, elbows, wrists (pose indices)
];

export const HolisticOverlay = forwardRef<HolisticOverlayHandle>(
  function HolisticOverlay(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Smoothing for drawing only (webcam jitter); the model gets raw points.
    const kiko = useRef(new KikoRig()); // keeps its physics state between frames
    // 3D view: Three.js is loaded only the first time "human" is picked (keeps other views light).
    const glRef = useRef<HTMLCanvasElement>(null);
    const human = useRef<Human3D | null>(null);
    const humanLoading = useRef(false);
    useEffect(() => () => human.current?.dispose(), []);
    const smooth = useRef({
      face: new PointsSmoother(),
      pose: new PointsSmoother(),
      l: new PointsSmoother(),
      r: new PointsSmoother(),
    });

    useImperativeHandle(ref, () => ({
      draw(res, o) {
        const c = canvasRef.current;
        const ctx = c?.getContext("2d");
        if (!c || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (
          c.width !== Math.round(w * dpr) ||
          c.height !== Math.round(h * dpr)
        ) {
          c.width = Math.round(w * dpr); // sharp lines on phones/retina
          c.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const css = getComputedStyle(document.documentElement);
        const color = (name: string) => css.getPropertyValue(name).trim();

        // Map 0..1 picture coordinates into the box exactly like CSS object-fit does, mirrored.
        const a = o.aspect > 0 ? o.aspect : 16 / 9;
        const s = o.fit === "cover" ? Math.max(w / a, h) : Math.min(w / a, h);
        const dw = a * s;
        const dh = s;
        const ox = (w - dw) / 2;
        const oy = (h - dh) / 2;
        const P = (p: { x: number; y: number }) =>
          [ox + (1 - p.x) * dw, oy + p.y * dh] as const;

        const t = performance.now();
        const sm = smooth.current;
        const face = sm.face.smooth(res.faceLandmarks[0], t);
        const pose = sm.pose.smooth(res.poseLandmarks[0], t);
        const left = sm.l.smooth(res.leftHandLandmarks[0], t);
        const right = sm.r.smooth(res.rightHandLandmarks[0], t);
        const phoneHand = o.phone
          ? o.phone.side === "l"
            ? left
            : right
          : undefined;

        const gl = glRef.current;

        if (gl) gl.style.display = o.mode === "human" ? "block" : "none";

        if (o.mode === "human") {
          ctx.fillStyle = color("--color-text");

          ctx.fillRect(0, 0, w, h);

          if (!human.current && gl && !humanLoading.current) {
            humanLoading.current = true;

            Promise.all([import("three"), import("./human3d")]).then(
              ([T, mod]) => {
                human.current = new mod.Human3D(T, gl, {
                  skin: "#e0ac85", // ASSUMPTION: one fixed skin tone for a cartoon; could be a setting

                  hair: color("--color-text"),

                  hoodie: color("--color-primary"),

                  ink: color("--color-text"),

                  string: color("--color-surface"),
                });
              },
            );
          }

          human.current?.render(w, h, dpr, P, { face, pose, left, right });

          if (phoneHand?.length && o.phone)
            drawPhone(
              ctx,
              phoneRect(phoneHand, P, o.phone.roll),
              color("--color-surface"),
              color("--color-primary"),
            );

          return;
        }

        if (o.mode === "kiko") {
          ctx.fillStyle = color("--color-text");

          ctx.fillRect(0, 0, w, h);

          kiko.current.draw(
            ctx,
            P,
            { face, pose, left, right },
            {
              fur: color("--color-warning-soft"),

              furDark: color("--color-warning"),

              belly: color("--color-surface"),

              ink: color("--color-text"),

              blush: color("--color-danger-soft"),

              bg: color("--color-text"),

              hoodie: color("--color-primary"),
            },
          );

          if (phoneHand?.length && o.phone)
            drawPhone(
              ctx,
              phoneRect(phoneHand, P, o.phone.roll),
              color("--color-text"),
              color("--color-primary"),
            );

          return;
        }

        if (o.mode === "avatar") {
          const col = {
            bg: color("--color-text"),
            glove: color("--color-surface"),
            gloveLine: color("--color-primary"),
            mask: color("--color-surface"),
            maskAccent: color("--color-danger"),
            ink: color("--color-text"),
            body: color("--color-primary"),
          };
          ctx.fillStyle = col.bg;
          ctx.fillRect(0, 0, w, h);
          drawBody(ctx, P, pose, col);
          drawMask(ctx, P, face, col);
          if (phoneHand?.length && o.phone)
            drawPhone(
              ctx,
              phoneRect(phoneHand, P, o.phone.roll),
              col.ink,
              col.maskAccent,
            );
          drawGlove(ctx, P, left, col); // hands last: in front of the face (and of the phone)
          drawGlove(ctx, P, right, col);
          return;
        }

        if (o.fit === "contain") {
          ctx.strokeStyle = color("--color-border"); // picture edge, so "out of frame" is visible
          ctx.strokeRect(ox, oy, dw, dh);
        }
        if (pose) {
          ctx.strokeStyle = color("--color-success");
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          for (const [i, j] of ARMS) {
            ctx.beginPath();
            ctx.moveTo(...P(pose[i]));
            ctx.lineTo(...P(pose[j]));
            ctx.stroke();
          }
        }
        for (const hand of [left, right]) {
          if (!hand?.length) continue;
          ctx.strokeStyle = color("--color-primary");
          ctx.lineWidth = 3;
          for (const [i, j] of HAND_BONES) {
            ctx.beginPath();
            ctx.moveTo(...P(hand[i]));
            ctx.lineTo(...P(hand[j]));
            ctx.stroke();
          }
        }
        if (face?.length) {
          ctx.fillStyle = color("--color-warning");
          for (const i of LIPS) {
            if (!face[i] || !Number.isFinite(face[i].x)) continue;
            ctx.beginPath();
            ctx.arc(...P(face[i]), 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (phoneHand?.length && o.phone) {
          const r = phoneRect(phoneHand, P, o.phone.roll);
          ctx.save();
          ctx.translate(r.cx, r.cy);
          ctx.rotate(r.angle);
          ctx.strokeStyle = color("--color-warning");
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
          ctx.restore();
          ctx.fillStyle = color("--color-warning");
          ctx.font = "600 13px var(--font-poppins), sans-serif";
          ctx.fillText(
            `HP ${Math.round(o.phone.score * 100)}%`,
            r.cx - r.w / 2,
            r.cy - r.h / 2 - 6,
          );
        }
      },
    }));
    return (
      <>
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 size-full"
        />
        <canvas
          ref={glRef}
          className="pointer-events-none absolute inset-0 hidden size-full"
        />
      </>
    );
  },
);
