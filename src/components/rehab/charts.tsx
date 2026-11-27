"use client";
// Static SVG charts for saved sessions (history). SVG instead of canvas here: the data is fixed
// (a few hundred points), and SVG gives crisp text, hover and screen-reader labels for free.
// Width is measured so text keeps its real size on a phone and on a laptop.
import { useEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const PAD = { l: 36, r: 8, t: 10, b: 22 };

export const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function niceTop(max: number) {
  return Math.max(30, Math.ceil((max + 5) / 30) * 30);
}

/** Angle over the whole session, the therapist's limit, and where limit events happened. */
export function TraceChart({
  trace,
  limitDeg,
  marks = [],
  height = 180,
}: {
  trace: [number, number][];
  limitDeg: number;
  marks?: { atMs: number; label: string }[];
  height?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tEnd = trace.length ? trace[trace.length - 1][0] : 1;
  const top = niceTop(Math.max(limitDeg, ...trace.map((p) => p[1])));
  const iw = Math.max(1, w - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + (t / Math.max(1, tEnd)) * iw;
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const d = trace
    .map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
    .join("");
  const ticks = [0, top / 3, (2 * top) / 3, top].map(Math.round);
  const h = hover !== null ? trace[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!trace.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left - PAD.l) / iw) * tEnd;
    let best = 0;
    for (let i = 1; i < trace.length; i++)
      if (Math.abs(trace[i][0] - t) < Math.abs(trace[best][0] - t)) best = i;
    setHover(best);
  };

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={`Grafik sudut selama ${mmss(tEnd)}, batas ${limitDeg} derajat`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block touch-pan-y"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={w - PAD.r}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
              />
              <text x={2} y={y(v) + 4} className="fill-muted text-[11px]">
                {v}°
              </text>
            </g>
          ))}
          <text x={PAD.l} y={height - 4} className="fill-muted text-[11px]">
            0:00
          </text>
          <text
            x={w - PAD.r}
            y={height - 4}
            textAnchor="end"
            className="fill-muted text-[11px]"
          >
            {mmss(tEnd)}
          </text>
          <line
            x1={PAD.l}
            x2={w - PAD.r}
            y1={y(limitDeg)}
            y2={y(limitDeg)}
            strokeDasharray="6 4"
            className="stroke-danger"
          />
          {marks.map((m) => (
            <line
              key={`${m.atMs}-${m.label}`}
              x1={x(m.atMs)}
              x2={x(m.atMs)}
              y1={PAD.t}
              y2={PAD.t + ih}
              strokeWidth={2}
              className="stroke-danger/40"
            />
          ))}
          <path
            d={d}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            className="stroke-primary"
          />
          {h && (
            <g>
              <line
                x1={x(h[0])}
                x2={x(h[0])}
                y1={PAD.t}
                y2={PAD.t + ih}
                className="stroke-muted"
              />
              <circle
                cx={x(h[0])}
                cy={y(h[1])}
                r={4}
                strokeWidth={2}
                className="fill-primary stroke-surface"
              />
            </g>
          )}
        </svg>
      )}
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg bg-text px-2 py-1 text-xs text-surface tabular-nums"
          style={{
            left: Math.min(Math.max(0, x(h[0]) - 40), Math.max(0, w - 90)),
          }}
        >
          {mmss(h[0])} · {h[1].toFixed(0)}°
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-primary" />
          Sudut (dari sensor)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block w-4 border-t-2 border-dashed border-danger"
          />
          Batas dari terapis
        </span>
        {marks.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-0.5 bg-danger/40" />
            Melewati batas
          </span>
        )}
      </p>
    </div>
  );
}

export interface Bar {
  key: string;
  value: number;
  label: string; // axis label under the bar (short)
  tip: string; // hover / screen-reader text
  over?: boolean;
}

/** One bar per item (rep, or session) with the limit as a dashed line. */
export function PeakBars({
  bars,
  limitDeg,
  height = 160,
  ariaLabel,
}: {
  bars: Bar[];
  limitDeg?: number;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const top = niceTop(Math.max(limitDeg ?? 0, ...bars.map((b) => b.value)));
  const iw = Math.max(1, w - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const slot = iw / Math.max(1, bars.length);
  const bw = Math.max(2, Math.min(28, slot - 2)); // 2px surface gap between bars
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(iw / 36)));
  const hb = hover !== null ? bars[hover] : null;

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setHover(null)}
          className="block"
        >
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={w - PAD.r}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
              />
              <text x={2} y={y(v) + 4} className="fill-muted text-[11px]">
                {Math.round(v)}°
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = PAD.l + slot * i + slot / 2;
            const hgt = Math.max(1, (b.value / top) * ih);
            return (
              <g key={b.key} onPointerEnter={() => setHover(i)}>
                <rect
                  x={PAD.l + slot * i}
                  y={PAD.t}
                  width={slot}
                  height={ih}
                  fill="transparent"
                />
                <path
                  // Rounded top (4px), square at the baseline.
                  d={`M${cx - bw / 2} ${PAD.t + ih}v${-(hgt - Math.min(4, hgt))}q0 -${Math.min(4, hgt)} ${Math.min(4, bw / 2)} -${Math.min(4, hgt)}h${bw - 2 * Math.min(4, bw / 2)}q${Math.min(4, bw / 2)} 0 ${Math.min(4, bw / 2)} ${Math.min(4, hgt)}v${hgt - Math.min(4, hgt)}z`}
                  className={
                    b.over
                      ? "fill-danger"
                      : hover === i
                        ? "fill-primary-hover"
                        : "fill-primary"
                  }
                >
                  <title>{b.tip}</title>
                </path>
                {i % every === 0 && (
                  <text
                    x={cx}
                    y={height - 6}
                    textAnchor="middle"
                    className="fill-muted text-[11px]"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
          {limitDeg !== undefined && (
            <line
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(limitDeg)}
              y2={y(limitDeg)}
              strokeDasharray="6 4"
              className="pointer-events-none stroke-danger"
            />
          )}
        </svg>
      )}
      {hb && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg bg-text px-2 py-1 text-xs text-surface tabular-nums"
          style={{
            left: Math.min(
              Math.max(0, PAD.l + slot * hover - 30),
              Math.max(0, w - 140),
            ),
          }}
        >
          {hb.tip}
        </div>
      )}
    </div>
  );
}
