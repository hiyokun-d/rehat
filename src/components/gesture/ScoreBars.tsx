"use client";
// "How close was it?": horizontal bars (0..1) with an optional threshold marker. Used for the
// pretrained ASL probabilities and for our own DTW matches (closeness), so both read the same.
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface ScoreItem {
  key: string;
  label: string;
  sub?: string; // right-hand text (e.g. "62%" or "jarak 0.84")
  value: number; // 0..1, longer = better
  highlight?: boolean; // e.g. the practice target
}

export function ScoreBars({
  items,
  threshold,
  thresholdLabel = "batas",
}: {
  items: ScoreItem[];
  threshold?: number; // 0..1: bars past this line would be accepted
  thresholdLabel?: string;
}) {
  if (!items.length)
    return <p className="text-sm text-muted">Belum ada hasil.</p>;
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={it.key}>
          <div className="mb-0.5 flex justify-between gap-3 text-sm">
            <span
              className={cn(
                i === 0 && "font-semibold",
                it.highlight && "text-primary",
              )}
            >
              {it.label}
            </span>
            <span className="tabular-nums text-muted">{it.sub}</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className={cn(
                "h-full rounded-full",
                threshold !== undefined && it.value >= threshold
                  ? "bg-success"
                  : "bg-primary",
                it.highlight && "bg-warning",
              )}
              initial={false}
              animate={{
                width: `${Math.max(2, Math.min(1, it.value) * 100)}%`,
              }}
              transition={{ duration: 0.25 }}
            />
            {threshold !== undefined && (
              <div
                className="absolute inset-y-0 w-0.5 bg-text"
                style={{ left: `${threshold * 100}%` }}
                title={thresholdLabel}
              />
            )}
          </div>
        </li>
      ))}
      {threshold !== undefined && (
        <li className="text-xs text-muted">
          Garis hitam = {thresholdLabel}. Hijau = melewati batas.
        </li>
      )}
    </ol>
  );
}
