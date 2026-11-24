// Plain-language "why was this (not) recognised?" for the custom-word recogniser.
// Pure function so the wording is testable and the same on phone and screen.
import type { ClassifyConfig, ClassifyResult } from "./classifier";

export function explainResult(
  r: ClassifyResult,
  cfg: Pick<ClassifyConfig, "maxDistance" | "minMargin">,
  counts: Record<string, number>,
  handRatio?: number, // share of frames in the gesture with a visible hand (0..1)
): string[] {
  const out: string[] = [];
  const [best, second] = r.candidates;
  if (r.word === null) {
    if (r.reason === "no-templates")
      out.push("Belum ada contoh. Rekam dulu di tab Latih.");
    if (r.reason === "too-far" && best)
      out.push(
        `Paling mirip "${best.word}" (jarak ${best.distance.toFixed(2)}), tapi batasnya ${cfg.maxDistance.toFixed(2)}. ` +
          "Gerakan ini berbeda dari rekamanmu: ulangi dengan kecepatan dan posisi tangan yang sama seperti saat merekam.",
      );
    if (r.reason === "ambiguous" && best && second) {
      const margin = (second.distance - best.distance) / second.distance;
      out.push(
        `"${best.word}" dan "${second.word}" hampir sama mirip (beda ${Math.round(margin * 100)}%, perlu minimal ${Math.round(cfg.minMargin * 100)}%). ` +
          "Buat gerakan kedua kata lebih berbeda, atau rekam ulang salah satunya.",
      );
    }
  }
  if (handRatio !== undefined && handRatio < 0.5)
    out.push(
      `Tangan hanya terlihat di ${Math.round(handRatio * 100)}% gerakan. Jaga tangan tetap di dalam kamera.`,
    );
  for (const c of r.candidates.slice(0, 2)) {
    const n = counts[c.word] ?? 0;
    if (n > 0 && n < 3)
      out.push(
        `"${c.word}" baru punya ${n} contoh. Rekam minimal 5 agar lebih stabil.`,
      );
  }
  return out;
}
