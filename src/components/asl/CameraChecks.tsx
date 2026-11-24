"use client";
// "Why is it not working?" at a glance: what the camera sees right now, each with a fix.
// Hints are practical framing advice, not model guarantees.
import { CheckCircle2, CircleAlert } from "lucide-react";
import type { FrameChecks } from "@/lib/asl/preprocess";
import { cn } from "@/lib/cn";

const MIN_FPS = 15; // below this, fast movements get too few frames (tuned by testing)
const MIN_HAND = 0.12; // hand height vs picture; smaller = too far (tuned by testing)
const MIN_LIGHT = 0.25; // mean brightness 0..1; laptop webcams get noisy below this (tuned by testing)

export function CameraChecks({
  checks,
  fps,
  light,
}: {
  checks: FrameChecks | null;
  fps: number;
  light: number | null; // 0..1 mean brightness
}) {
  const rows: { ok: boolean; label: string; fix: string }[] = [
    {
      ok: !!checks?.hand,
      label: "Tangan terlihat",
      fix: "Angkat tangan ke depan dada, di dalam kamera.",
    },
    {
      ok: !!checks?.hand && (checks?.handSize ?? 0) >= MIN_HAND,
      label: "Tangan cukup besar",
      fix: "Mundur atau maju sampai tangan kira-kira 1/8 tinggi layar atau lebih.",
    },
    {
      ok: !!checks?.face,
      label: "Wajah (bibir) terlihat",
      fix: "Wajah harus masuk kamera: model juga membaca mulut.",
    },
    {
      ok: !!checks?.arm,
      label: "Siku dan pergelangan terlihat",
      fix: "Jauhkan kamera sampai bahu dan siku masuk. Sandarkan HP atau pakai laptop.",
    },
    {
      ok: (light ?? 0) >= MIN_LIGHT,
      label: `Cahaya ${light === null ? "-" : Math.round(light * 100)}%`,
      fix: 'Terlalu gelap: hadapkan wajah ke lampu/jendela (jangan membelakangi), atau nyalakan "Perjelas kamera".',
    },
    {
      ok: fps >= MIN_FPS,
      label: `Kamera ${fps} FPS`,
      fix: "Terlalu lambat: tambah cahaya, tutup aplikasi lain.",
    },
  ];
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex gap-2 text-sm">
          {r.ok ? (
            <CheckCircle2
              size={18}
              className="mt-0.5 shrink-0 text-success"
              aria-hidden
            />
          ) : (
            <CircleAlert
              size={18}
              className="mt-0.5 shrink-0 text-warning"
              aria-hidden
            />
          )}
          <span>
            <span className={cn("font-medium", !r.ok && "text-warning")}>
              {r.label}
            </span>
            {!r.ok && <span className="block text-muted">{r.fix}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
