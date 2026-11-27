"use client";
// Wrap in <AnimatePresence> where alerts come and go. Enter is quick (opacity + small slide)
// and starts immediately, so animation never delays a safety message.
import {
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  OctagonAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

const tones: Record<string, { cls: string; icon: LucideIcon }> = {
  info: {
    cls: "bg-primary-soft text-primary-hover border-primary/20",
    icon: Info,
  },
  warning: {
    cls: "bg-warning-soft text-warning border-warning/20",
    icon: CircleAlert,
  },
  danger: {
    cls: "bg-danger-soft text-danger border-danger/30",
    icon: OctagonAlert,
  },
  success: {
    cls: "bg-success-soft text-success border-success/20",
    icon: CircleCheck,
  },
};

export interface AlertProps {
  tone?: "info" | "warning" | "danger" | "success";
  title: string;
  children?: React.ReactNode;
  icon?: LucideIcon;
  big?: boolean;
}

export function Alert({
  tone = "info",
  title,
  children,
  icon,
  big,
}: AlertProps) {
  const t = tones[tone];
  const Icon = icon ?? t.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-(--radius-card) border",
        t.cls,
        big ? "p-5" : "p-3",
      )}
    >
      <Icon size={big ? 32 : 20} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className={cn("font-semibold", big ? "text-xl" : "text-base")}>
          {title}
        </div>
        {children && (
          <div className={cn("mt-0.5", big ? "text-lg" : "text-base")}>
            {children}
          </div>
        )}
      </div>
    </motion.div>
  );
}
