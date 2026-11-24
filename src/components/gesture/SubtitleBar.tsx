"use client";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

/** Big caption line. `pending` shows "..." while a gesture is in progress, so it feels live. */
export function SubtitleBar({
  words,
  pending,
  size = "md",
}: {
  words: string[];
  pending?: boolean;
  size?: "md" | "xl";
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex min-h-16 flex-wrap items-center gap-x-2 rounded-(--radius-card) bg-text px-5 py-3 font-semibold text-surface",
        size === "xl" ? "min-h-28 text-5xl" : "text-2xl",
      )}
    >
      <AnimatePresence initial={false}>
        {words.map((w, i) => (
          <motion.span
            key={`${i}-${w}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {w}
          </motion.span>
        ))}
      </AnimatePresence>
      {pending && <span className="animate-pulse text-muted">...</span>}
      {!words.length && !pending && (
        <span className="text-base font-normal text-muted">
          Teks muncul di sini
        </span>
      )}
    </div>
  );
}
