import { cn } from "@/lib/cn";

export interface StatProps {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "default" | "danger";
  size?: "md" | "xl";
}

export function Stat({
  label,
  value,
  unit,
  tone = "default",
  size = "md",
}: StatProps) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={cn(
          "font-semibold tabular-nums leading-tight",
          size === "xl" ? "text-6xl" : "text-3xl",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-base font-medium text-muted">{unit}</span>
        )}
      </div>
    </div>
  );
}
