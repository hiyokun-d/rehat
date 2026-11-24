"use client";
// "Uji": the app asks for N random words; we log expected vs predicted and report accuracy,
// rejection rate and median latency. Our own numbers, on our own test gestures.
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stat";
import type { GestureTestRow } from "@/lib/db";

export function summarize(rows: GestureTestRow[]) {
  const n = rows.length;
  const correct = rows.filter((r) => r.predicted === r.expected).length;
  const rejected = rows.filter((r) => r.predicted === null).length;
  const wrong = n - correct - rejected;
  const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n,
    accuracy: n ? correct / n : 0,
    rejection: n ? rejected / n : 0,
    wrongWord: n ? wrong / n : 0, // the worst case: a wrong word spoken out loud
    medianLatencyMs: n ? lat[Math.floor(n / 2)] : 0,
  };
}

export function TestPanel({
  prompt,
  index,
  total,
  rows,
  onStart,
  onExport,
  canStart,
}: {
  prompt: string | null;
  index: number;
  total: number;
  rows: GestureTestRow[];
  onStart: () => void;
  onExport: () => void;
  canStart: boolean;
}) {
  const s = summarize(rows);
  const pct = (x: number) => `${Math.round(x * 100)}`;
  return (
    <div className="space-y-4">
      {prompt ? (
        <div
          className="rounded-(--radius-card) bg-primary-soft p-5 text-center"
          aria-live="polite"
        >
          <div className="text-sm text-muted">
            Lakukan gerakan ({index + 1}/{total})
          </div>
          <div className="text-4xl font-semibold">{prompt}</div>
        </div>
      ) : (
        <Button size="xl" icon={Play} onClick={onStart} disabled={!canStart}>
          Mulai uji ({total} kata acak)
        </Button>
      )}
      {!canStart && !prompt && (
        <p className="text-sm text-muted">
          Butuh minimal 2 kata dengan contoh tersimpan.
        </p>
      )}
      {s.n > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Akurasi" value={pct(s.accuracy)} unit="%" />
            <Stat label="Tidak dikenali" value={pct(s.rejection)} unit="%" />
            <Stat
              label="Kata salah diucapkan"
              value={pct(s.wrongWord)}
              unit="%"
              tone={s.wrongWord > 0 ? "danger" : "default"}
            />
            <Stat
              label="Latensi median"
              value={s.medianLatencyMs.toFixed(0)}
              unit="ms"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            onClick={onExport}
          >
            Simpan hasil JSON
          </Button>
        </>
      )}
    </div>
  );
}
