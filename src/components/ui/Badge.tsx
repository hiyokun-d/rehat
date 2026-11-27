import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-surface-2 text-muted",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
  primary: "bg-primary-soft text-primary-hover",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Required next to every placeholder number (AGENTS.md: never invent clinical thresholds). */
export function ExampleBadge() {
  return <Badge tone="warning">CONTOH, bukan nilai klinis</Badge>;
}
