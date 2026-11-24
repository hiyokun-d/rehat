"use client";
// Draws the 21 landmarks + bones over the mirrored selfie video.
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Landmark } from "@/lib/gesture/features";
import { HAND_BONES as BONES } from "@/lib/gesture/handTopology";

export interface HandOverlayHandle {
  draw(lm: Landmark[] | null): void;
}

export const HandOverlay = forwardRef<HandOverlayHandle>(
  function HandOverlay(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useImperativeHandle(ref, () => ({
      draw(lm) {
        const c = canvasRef.current;
        const ctx = c?.getContext("2d");
        if (!c || !ctx) return;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== w) {
          c.width = w;
          c.height = h;
        }
        ctx.clearRect(0, 0, w, h);
        if (!lm) return;
        const css = getComputedStyle(document.documentElement);
        ctx.strokeStyle = css.getPropertyValue("--color-primary-soft").trim();
        ctx.fillStyle = css.getPropertyValue("--color-primary").trim();
        ctx.lineWidth = 3;
        // Mirror x to match the mirrored (selfie) video element.
        const p = (i: number) => [(1 - lm[i].x) * w, lm[i].y * h] as const;
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(...p(a));
          ctx.lineTo(...p(b));
          ctx.stroke();
        }
        for (let i = 0; i < lm.length; i++) {
          ctx.beginPath();
          ctx.arc(...p(i), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    }));
    return (
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 size-full"
      />
    );
  },
);
