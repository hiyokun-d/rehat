"use client";
// One place for animation policy: reducedMotion="user" makes every motion component drop
// transform/layout animation (keeping opacity) when the OS asks for reduced motion.
import { MotionConfig } from "motion/react";

export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </MotionConfig>
  );
}
