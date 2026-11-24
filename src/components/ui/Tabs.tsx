"use client";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      className="inline-flex gap-1 rounded-(--radius-control) bg-surface-2 p-1"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
            value === id ? "text-text" : "text-muted hover:text-text",
          )}
        >
          {value === id && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg bg-surface shadow-(--shadow-card)"
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {Icon && <Icon size={16} aria-hidden />}
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
