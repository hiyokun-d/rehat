import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CardProps {
  title?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Card({
  title,
  icon: Icon,
  actions,
  className,
  children,
}: CardProps) {
  return (
    <section
      className={cn(
        "rounded-(--radius-card) bg-surface p-4 shadow-(--shadow-card)",
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
            {Icon && <Icon size={16} aria-hidden />}
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
