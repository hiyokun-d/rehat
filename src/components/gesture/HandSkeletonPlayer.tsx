"use client";
// Replays a recorded template as a moving hand skeleton: "this is how YOU did it last time",
// so repetitions stay consistent. It shows the user's own recording, never a reference sign.
import { useEffect, useRef } from "react";
import type { Frame } from "@/lib/gesture/features";
import { HAND_BONES } from "@/lib/gesture/handTopology";

const PAUSE_MS = 800; // still moment between loops, so the start and end are readable

export function HandSkeletonPlayer({
  frames,
  label,
  height = 180,
}: {
  frames: Frame[];
  label: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || frames.length < 2) return;
    const css = getComputedStyle(document.documentElement);
    const color = {
      bone: css.getPropertyValue("--color-primary").trim(),
      muted: css.getPropertyValue("--color-muted").trim(),
    };
    const duration = Math.max(300, frames[frames.length - 1].t - frames[0].t);
    const start = performance.now();
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const elapsed = (performance.now() - start) % (duration + PAUSE_MS);
      const i = Math.min(
        frames.length - 1,
        Math.floor((elapsed / duration) * (frames.length - 1)),
      );
      const hand = frames[i].hand;
      ctx.font = "12px var(--font-poppins), sans-serif";
      ctx.fillStyle = color.muted;
      ctx.fillText(
        `${Math.round(Math.min(elapsed, duration))} / ${Math.round(duration)} ms`,
        8,
        16,
      );
      if (!hand) {
        ctx.fillText("tangan tidak terlihat", 8, 34);
        return;
      }
      // Normalised coords: wrist at 0,0 and wrist->middle-MCP = 1. Place the wrist low-centre.
      const k = h * 0.28;
      const p = (j: number) =>
        [w / 2 + hand[j * 3] * k, h * 0.85 + hand[j * 3 + 1] * k] as const;
      ctx.strokeStyle = color.bone;
      ctx.fillStyle = color.bone;
      ctx.lineWidth = 3;
      for (const [a, b] of HAND_BONES) {
        ctx.beginPath();
        ctx.moveTo(...p(a));
        ctx.lineTo(...p(b));
        ctx.stroke();
      }
      for (let j = 0; j < 21; j++) {
        ctx.beginPath();
        ctx.arc(...p(j), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frames]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block w-full rounded-(--radius-control) bg-surface-2"
      style={{ height }}
    />
  );
}
