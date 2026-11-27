"use client";
// Live canvas chart for 3-axis data (x / y / z), last `windowMs`. Same idea as LiveChart (data
// in a ref, redraw per frame, no re-render per sample) but signed values and three lines.
// Legend shows each axis with its current value, so identity never rests on color alone.
import { useEffect, useRef, useState } from "react";

export interface SeriesPoint {
  t: number;
  v: [number, number, number];
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const AXES = ["x", "y", "z"] as const;
const SERIES = ["--color-series-1", "--color-series-2", "--color-series-3"];

export function LiveMultiChart({
  points,
  title,
  unit,
  minRange,
  windowMs = 10_000,
  height = 160,
}: {
  points: React.RefObject<SeriesPoint[]>;
  title: string;
  unit: string;
  /** The y-axis never zooms in further than ±minRange, so sensor noise does not look like motion. */
  minRange: number;
  windowMs?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState<[number, number, number] | null>(null);

  // Legend values at 4 Hz; the canvas itself redraws every frame.
  useEffect(() => {
    const id = setInterval(() => {
      const p = points.current;
      setNow(p.length ? p[p.length - 1].v : null);
    }, 250);
    return () => clearInterval(id);
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const colors = SERIES.map(css);
    const grid = css("--color-border");
    const text = css("--color-muted");
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pts = points.current ?? [];
      const tEnd = pts.length ? pts[pts.length - 1].t : 0;
      const tStart = tEnd - windowMs;
      let lo = -minRange;
      let hi = minRange;
      for (const p of pts)
        if (p.t >= tStart)
          for (const v of p.v) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
      const pad = 40;
      const x = (t: number) => pad + ((t - tStart) / windowMs) * (w - pad - 6);
      const y = (v: number) => 6 + ((hi - v) / (hi - lo)) * (h - 12);

      ctx.font = "11px var(--font-poppins), sans-serif";
      ctx.lineWidth = 1;
      ctx.strokeStyle = grid;
      ctx.fillStyle = text;
      for (const v of [hi, 0, lo]) {
        ctx.beginPath();
        ctx.moveTo(pad, y(v));
        ctx.lineTo(w - 6, y(v));
        ctx.stroke();
        ctx.fillText(v.toFixed(v === 0 ? 0 : 1), 2, y(v) + 4);
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = colors[k];
        ctx.beginPath();
        let first = true;
        for (const p of pts) {
          if (p.t < tStart) continue;
          if (first) ctx.moveTo(x(p.t), y(p.v[k]));
          else ctx.lineTo(x(p.t), y(p.v[k]));
          first = false;
        }
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [points, windowMs, minRange]);

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted">
          {title} <span className="font-normal">({unit})</span>
        </span>
        <span className="flex gap-3 text-sm tabular-nums">
          {AXES.map((a, k) => (
            <span key={a} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: `var(${SERIES[k]})` }}
              />
              <span className="text-muted">{a}</span>
              <span className="w-12 text-right font-medium">
                {now ? now[k].toFixed(1) : "–"}
              </span>
            </span>
          ))}
        </span>
      </figcaption>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Grafik ${title}, 10 detik terakhir, sumbu x y z`}
        className="block w-full"
        style={{ height }}
      />
    </figure>
  );
}
