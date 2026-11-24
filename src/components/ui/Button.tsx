"use client";
import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { type HTMLMotionProps, motion } from "motion/react";
import { cn } from "@/lib/cn";

const variants = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  danger: "bg-danger text-danger-fg hover:bg-danger-hover",
  ghost: "text-text hover:bg-surface-2",
};

// xl = patient-facing: at least 56 px tall and full width.
const sizes = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-base gap-2",
  xl: "min-h-16 w-full px-6 text-xl gap-3",
};

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: LucideIcon;
  loading?: boolean;
  children?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  loading,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconSize = size === "xl" ? 28 : size === "sm" ? 16 : 20;
  return (
    <motion.button
      type={type}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-(--radius-control) font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden />
      )}
      {children}
    </motion.button>
  );
}
