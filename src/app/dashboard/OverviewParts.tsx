"use client";
// Small building blocks shared by the phone and desktop overviews. Plain SVG, no chart library
// (keeps the bundle small for cheap phones).
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  HandHelping,
  Info,
} from "lucide-react";
import { motion } from "motion/react";
import type { ExerciseTrend, Flag } from "@/lib/care/triage";
import { cn } from "@/lib/cn";

const DAY = ["H-0", "H-1", "H-2", "H-3", "H-4", "H-5", "H-6"];

/** 7 bars, oldest left, today right. Counts sessions (adherence), not recovery. */
export function Days7({
  days,
  big = false,
}: {
  days: number[];
  big?: boolean;
}) {
  const max = Math.max(1, ...days);
  const ordered = [...days].reverse();
  const h = big ? 36 : 22;
  return (
    <div
      className="flex items-end gap-0.5"
      role="img"
      aria-label={`Sesi 7 hari terakhir, dari 6 hari lalu sampai hari ini: ${ordered.join(", ")}`}
    >
      {ordered.map((n, i) => (
        <motion.div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7 slots
          key={i}
          title={`${DAY[6 - i]}: ${n} sesi`}
          className={cn(
            "origin-bottom rounded-sm",
            big ? "w-3" : "w-2",
            n ? "bg-primary" : "bg-border",
          )}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.3, delay: i * 0.03, ease: "easeOut" }}
          style={{ height: n ? Math.max(4, (n / max) * h) : 3 }}
        />
      ))}
    </div>
  );
}

const flagStyle: Record<Flag["level"], string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warning-soft text-warning",
  info: "bg-surface-2 text-muted",
};

export function FlagIcon({ flag }: { flag: Flag }) {
  const Icon =
    flag.code === "help"
      ? HandHelping
      : flag.level === "info"
        ? Info
        : AlertTriangle;
  return <Icon size={16} aria-hidden className="shrink-0" />;
}

export function FlagList({ flags, max }: { flags: Flag[]; max?: number }) {
  const shown = max ? flags.slice(0, max) : flags;
  if (!flags.length)
    return <p className="text-sm text-success">Tidak ada yang perlu dicek</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((f) => (
        <li
          key={f.code + f.text}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium",
            flagStyle[f.level],
          )}
        >
          <FlagIcon flag={f} />
          {f.text}
        </li>
      ))}
      {max && flags.length > max && (
        <li className="text-sm text-muted">+{flags.length - max} lagi</li>
      )}
    </ul>
  );
}

/** Up / flat / down arrow for a Theil–Sen slope. Neutral colour: a trend is not a judgement. */
export function TrendArrow({ slope }: { slope: number | null }) {
  if (slope === null) return <span className="text-muted">–</span>;
  const Icon =
    Math.abs(slope) < 1
      ? ArrowRight
      : slope > 0
        ? ArrowUpRight
        : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums">
      <Icon size={16} aria-hidden />
      {slope > 0 ? "+" : ""}
      {slope}°/mgg
    </span>
  );
}

/**
 * Session peak angles over 28 days with the Theil–Sen line through them. The line is drawn from
 * the same slope the server computed; the intercept is the median of y - slope*x, as in Sen 1968.
 */
export function TrendSpark({
  trend,
  width = 220,
  height = 64,
}: {
  trend: ExerciseTrend;
  width?: number;
  height?: number;
}) {
  const pts = trend.series.map((p) => ({
    x: Date.parse(p.t) / 86_400_000,
    y: p.maxDeg,
  }));
  if (pts.length < 2)
    return <p className="text-sm text-muted">Belum cukup sesi untuk grafik.</p>;
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x), x0 + 1);
  const ys = pts.map((p) => p.y);
  const y0 = Math.min(...ys) - 5;
  const y1 = Math.max(...ys) + 5;
  const pad = 4;
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (width - 2 * pad);
  const sy = (y: number) =>
    height - pad - ((y - y0) / (y1 - y0)) * (height - 2 * pad);
  const slopeDay =
    trend.slopeDegPerWeek === null ? null : trend.slopeDegPerWeek / 7;
  let line: string | null = null;
  if (slopeDay !== null) {
    const r = pts.map((p) => p.y - slopeDay * p.x).sort((a, b) => a - b);
    const m = r.length >> 1;
    const b = r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
    line = `M${sx(x0)},${sy(b + slopeDay * x0)} L${sx(x1)},${sy(b + slopeDay * x1)}`;
  }
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Puncak sudut ${trend.exercise}, ${pts.length} sesi, ${Math.round(y0 + 5)} sampai ${Math.round(y1 - 5)} derajat`}
      className="max-w-full"
    >
      <motion.polyline
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        fill="none"
        stroke="var(--color-series-1)"
        strokeWidth="1.5"
        strokeOpacity="0.5"
        points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
      />
      {pts.map((p, k) => (
        <motion.circle
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 + k * 0.03 }}
          key={p.x}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r="2.5"
          fill="var(--color-series-1)"
        />
      ))}
      {line && (
        <motion.path
          // Opacity, not pathLength: pathLength would replace the dash pattern.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.7 }}
          d={line}
          stroke="var(--color-text)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          fill="none"
        />
      )}
    </svg>
  );
}

export function Num({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums leading-tight",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
