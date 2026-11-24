"use client";
// Canvas line chart of the last `windowMs` of a value (angle). Canvas instead of a chart
// library: 60 points per second would make a React/SVG chart re-render constantly.
// Data lives in a ref the parent mutates; we redraw on every animation frame.
import { useEffect, useRef } from "react";

export interface ChartPoint {
  t: number; // ms (any clock, as long as all points share it)
  v: number;
}

export interface LiveChartProps {
  points: React.RefObject<ChartPoint[]>;
  windowMs?: number;
  limit?: number; // dashed line, e.g. maxAngleDeg
  unit?: string;
  height?: number;
  label: string; // for screen readers
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function LiveChart({
  points,
  windowMs = 10_000,
  limit,
  unit = "°",
  height = 220,
  label,
}: LiveChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const limitRef = useRef(limit);

  useEffect(() => {
    limitRef.current = limit;
  }, [limit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const colors = {
      line: css("--color-primary"),
      grid: css("--color-border"),
      text: css("--color-muted"),
      danger: css("--color-danger"),
    };
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
      const lim = limitRef.current;
      const tEnd = pts.length ? pts[pts.length - 1].t : 0;
      const tStart = tEnd - windowMs;
      const visible = pts.filter((p) => p.t >= tStart);
      const top = Math.max(
        100,
        (lim ?? 0) + 20,
        ...visible.map((p) => p.v + 10),
      );
      const pad = 32;
      const x = (t: number) => pad + ((t - tStart) / windowMs) * (w - pad - 8);
      const y = (v: number) => h - 20 - (v / top) * (h - 30);

      ctx.font = "11px var(--font-poppins), sans-serif";
      ctx.fillStyle = colors.text;
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      for (let v = 0; v <= top; v += top > 150 ? 45 : 30) {
        ctx.beginPath();
        ctx.moveTo(pad, y(v));
        ctx.lineTo(w - 8, y(v));
        ctx.stroke();
        ctx.fillText(`${v}${unit}`, 2, y(v) + 4);
      }

      if (lim !== undefined) {
        ctx.strokeStyle = colors.danger;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pad, y(lim));
        ctx.lineTo(w - 8, y(lim));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [i, p] of visible.entries()) {
        if (i) ctx.lineTo(x(p.t), y(p.v));
        else ctx.moveTo(x(p.t), y(p.v));
      }
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [points, windowMs, unit]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block w-full"
      style={{ height }}
    />
  );
}
