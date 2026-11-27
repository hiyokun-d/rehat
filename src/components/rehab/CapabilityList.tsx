// "What can this phone's browser give us?" — feature detection results, shown on the phone
// and forwarded to the laptop, so the team can fill the per-phone table in docs/SENSORS.md.
import { CircleCheck, CircleMinus, Flag } from "lucide-react";
import type { Capability, CapabilityStatus } from "@/lib/sensor/deviceExtras";

const STATUS: Record<
  CapabilityStatus,
  { icon: typeof CircleCheck; label: string; cls: string }
> = {
  yes: { icon: CircleCheck, label: "Ada", cls: "text-success" },
  no: { icon: CircleMinus, label: "Tidak ada", cls: "text-muted" },
  flag: { icon: Flag, label: "Perlu flag", cls: "text-warning" },
};

export function CapabilityList({ items }: { items: Capability[] }) {
  if (!items.length)
    return <p className="text-sm text-muted">Belum ada data perangkat.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((c) => {
        const s = STATUS[c.status];
        return (
          <li key={c.id} className="flex items-start gap-3 py-2">
            <s.icon
              size={18}
              className={`mt-0.5 shrink-0 ${s.cls}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap justify-between gap-x-2">
                <span className="font-medium">{c.label}</span>
                <span className={s.cls}>{s.label}</span>
              </div>
              <div className="text-muted">{c.use}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
