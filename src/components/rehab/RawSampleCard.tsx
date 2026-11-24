// Raw sensor numbers + measured sample rate. Used on both phone and screen (M1 check).
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { RateStats } from "@/lib/sensor/rateMeter";
import type { Sample } from "@/lib/sensor/types";

const f = (n: number | undefined, d = 2) =>
  n === undefined ? "–" : n.toFixed(d);

export function RawSampleCard({
  sample,
  rate,
  reportedIntervalMs,
  extra,
}: {
  sample: Sample | null;
  rate: RateStats;
  reportedIntervalMs: number | null;
  extra?: [string, string][];
}) {
  const rows: [string, string][] = [
    [
      "ax / ay / az (m/s²)",
      `${f(sample?.ax)} / ${f(sample?.ay)} / ${f(sample?.az)}`,
    ],
    [
      "gx / gy / gz (°/s)",
      `${f(sample?.gx, 1)} / ${f(sample?.gy, 1)} / ${f(sample?.gz, 1)}`,
    ],
    ["Laju sampel (dari timestamp)", `${rate.hz.toFixed(1)} Hz`],
    [
      "Jeda median / terbesar",
      `${rate.dtMedianMs.toFixed(1)} / ${rate.dtMaxMs.toFixed(0)} ms`,
    ],
    [
      "event.interval (dari browser)",
      reportedIntervalMs === null ? "–" : `${reportedIntervalMs} ms`,
    ],
    ...(extra ?? []),
  ];
  return (
    <Card title="Data mentah" icon={Activity}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
