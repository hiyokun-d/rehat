"use client";
// Small motion helpers shared by the dashboard. Rules (see ui-conventions):
// - motion explains change (a number moved, a list re-ordered, a line drawn), never decorates;
// - short (<= 400 ms) and never blocks input or delays a safety message;
// - honours the OS "reduce motion" setting through <MotionConfig reducedMotion="user">.
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Counts from the previous value to the new one, so a changed number is noticed. */
export function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (reduce || from === value) {
      setShown(value);
      return;
    }
    const c = animate(from, value, {
      duration: 0.5,
      ease: "easeOut",
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => c.stop();
  }, [value, reduce]);
  return <span className="tabular-nums">{shown}</span>;
}

/** Fades + lifts children in once when scrolled into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-40px" });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={seen ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/** A small "live" dot that breathes while connected. */
export function LiveDot({ on }: { on: boolean }) {
  return (
    <span className="relative inline-flex size-2.5" aria-hidden>
      {on && (
        <motion.span
          className="absolute inset-0 rounded-full bg-success"
          animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY }}
        />
      )}
      <span
        className={`relative inline-flex size-2.5 rounded-full ${on ? "bg-success" : "bg-border"}`}
      />
    </span>
  );
}
