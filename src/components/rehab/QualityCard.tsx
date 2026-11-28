// Descriptive movement quality of one session (src/lib/rehab/quality.ts). Shown to the patient's
// care team as plain numbers with what they mean. No score, no colours that imply good/bad,
// no "recovery" wording (AGENTS.md: the app does not judge recovery).
import { Waves } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { sessionQuality } from "@/lib/rehab/quality";
import type { RepRecord } from "@/lib/rehab/summary";

export function QualityCard({ reps }: { reps: RepRecord[] }) {
  const q = sessionQuality(reps);
  if (q.reps < 3) return null;
  return (
    <Card title="Kualitas gerak (deskriptif)" icon={Waves}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Kehalusan (SPARC)"
          value={q.smoothnessSparc?.toFixed(2) ?? "–"}
        />
        <Stat
          label="Variasi puncak"
          value={
            q.consistencyCv === null
              ? "–"
              : `${Math.round(q.consistencyCv * 100)}`
          }
          unit="%"
        />
        <Stat
          label="Puncak akhir vs awal"
          value={
            q.peakTrendDeg === null
              ? "–"
              : `${q.peakTrendDeg > 0 ? "+" : ""}${q.peakTrendDeg.toFixed(0)}`
          }
          unit="°"
        />
      </div>
      <ul className="mt-3 space-y-1 text-sm text-muted">
        <li>
          Kehalusan: makin dekat ke 0 makin halus; satu gerakan mulus ideal
          sekitar -1,4 (metode Balasubramanian dkk., 2015).
        </li>
        <li>Variasi puncak: seberapa mirip tinggi tiap repetisi.</li>
        <li>
          Puncak akhir vs awal: sepertiga repetisi terakhir dibanding sepertiga
          pertama.
        </li>
        <li>
          Hanya gambaran untuk terapis. Bukan nilai pemulihan atau diagnosis.
        </li>
      </ul>
    </Card>
  );
}
