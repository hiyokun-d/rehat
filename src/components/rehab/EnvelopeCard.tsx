"use client";
// Therapist-side settings: exercise, safety envelope, rep thresholds. Every default is an
// example, so every slider carries the "CONTOH, bukan nilai klinis" badge.
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { Tabs } from "@/components/ui/Tabs";
import { EXERCISES, type ExerciseId } from "@/lib/rehab/defaults";
import type { SessionConfig } from "@/lib/rehab/session";

export function EnvelopeCard({
  config,
  onChange,
}: {
  config: SessionConfig;
  onChange: (c: SessionConfig) => void;
}) {
  const env = (patch: Partial<SessionConfig["envelope"]>) =>
    onChange({ ...config, envelope: { ...config.envelope, ...patch } });
  const reps = (patch: Partial<SessionConfig["reps"]>) =>
    onChange({ ...config, reps: { ...config.reps, ...patch } });

  return (
    <Card title="Latihan & batas aman (diatur terapis)" icon={ShieldAlert}>
      <div className="space-y-4">
        <Tabs<ExerciseId>
          items={(Object.keys(EXERCISES) as ExerciseId[]).map((id) => ({
            id,
            label: EXERCISES[id].name,
          }))}
          value={config.exercise}
          onChange={(exercise) => onChange({ ...config, exercise })}
        />
        <Slider
          label="Sudut maksimum"
          unit="°"
          min={10}
          max={180}
          value={config.envelope.maxAngleDeg}
          onChange={(v) => env({ maxAngleDeg: v })}
          example
        />
        <Slider
          label="Kecepatan maksimum"
          unit="°/s"
          min={10}
          max={400}
          step={5}
          value={config.envelope.maxVelDegPerS}
          onChange={(v) => env({ maxVelDegPerS: v })}
          example
        />
        <Slider
          label="Debounce (harus bertahan selama)"
          unit="ms"
          min={0}
          max={2000}
          step={50}
          value={config.envelope.debounceMs}
          onChange={(v) => env({ debounceMs: v })}
          example
        />
        <Slider
          label="Repetisi: naik melewati"
          unit="°"
          min={5}
          max={150}
          value={config.reps.upDeg}
          onChange={(v) =>
            reps({ upDeg: Math.max(v, config.reps.downDeg + 5) })
          }
          example
        />
        <Slider
          label="Repetisi: turun di bawah"
          unit="°"
          min={0}
          max={100}
          value={config.reps.downDeg}
          onChange={(v) =>
            reps({ downDeg: Math.min(v, config.reps.upDeg - 5) })
          }
          example
        />
      </div>
    </Card>
  );
}
