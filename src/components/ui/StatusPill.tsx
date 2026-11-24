"use client";
// Status = icon + text + color, never color alone (color-blind users, bright sunlight).
import {
  Circle,
  CircleCheck,
  CirclePause,
  LoaderCircle,
  type LucideIcon,
  OctagonAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

const tones: Record<string, { cls: string; icon: LucideIcon; spin?: boolean }> =
  {
    ok: { cls: "bg-success-soft text-success", icon: CircleCheck },
    busy: {
      cls: "bg-primary-soft text-primary-hover",
      icon: LoaderCircle,
      spin: true,
    },
    warn: { cls: "bg-warning-soft text-warning", icon: CirclePause },
    danger: { cls: "bg-danger-soft text-danger", icon: OctagonAlert },
    idle: { cls: "bg-surface-2 text-muted", icon: Circle },
  };

export type StatusTone = "ok" | "busy" | "warn" | "danger" | "idle";

export function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
}) {
  const t = tones[tone];
  const Icon = icon ?? t.icon;
  return (
    <motion.span
      key={`${tone}-${label}`}
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        t.cls,
      )}
    >
      <Icon
        size={16}
        aria-hidden
        className={t.spin && !icon ? "animate-spin" : undefined}
      />
      {label}
    </motion.span>
  );
}
