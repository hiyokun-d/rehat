import { cn } from "@/lib/cn";

/** Page shell: title row + content column. `narrow` for phone pages. */
export function Screen({
  title,
  subtitle,
  right,
  narrow,
  wide,
  children,
}: {
  /** Full-width for dense desktop tables (nurse dashboard on a laptop). */
  wide?: boolean;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full flex-1 px-4 py-5",
        narrow ? "max-w-md text-lg" : wide ? "max-w-[1600px]" : "max-w-6xl",
      )}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-base text-muted">{subtitle}</p>}
        </div>
        {right && (
          <div className="flex flex-wrap items-center gap-2">{right}</div>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
