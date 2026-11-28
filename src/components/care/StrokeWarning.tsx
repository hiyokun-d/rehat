"use client";
// "Tanda bahaya stroke": BE-FAST + one tap to call emergency services (AGENTS.md L4: point to
// local emergency services, no automated medical advice). The app does NOT judge whether this is a
// stroke; it shows the public warning signs and the number to call.
//
// Sources (docs/RESEARCH.md):
// - BE-FAST adds Balance and Eyes to FAST (Aroor et al., Stroke 2017;48:479-481, PMID 28082668).
// - 119 = Indonesia's national medical emergency line (Kemenkes, Permenkes 19/2016 SPGDT).
//   112 = general emergency line, coverage varies by region, so 119 is the primary button.
// "Time": note when the person was last seen normal; doctors use it to choose treatment.
import { Phone, Siren } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

// Same look as Button size="xl" (a link, because tel: must be an <a>).
const CALL =
  "inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-(--radius-control) px-6 text-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const SIGNS = [
  ["B", "Balance", "Tiba-tiba kehilangan keseimbangan atau pusing berat"],
  ["E", "Eyes", "Tiba-tiba penglihatan kabur, ganda, atau hilang"],
  ["F", "Face", "Wajah mencong / turun sebelah saat tersenyum"],
  ["A", "Arm", "Lengan atau kaki lemah / mati rasa sebelah"],
  ["S", "Speech", "Bicara pelo, sulit bicara, atau sulit mengerti"],
  ["T", "Time", "Segera telepon 119. Catat jam terakhir terlihat normal"],
] as const;

export function StrokeWarning({
  compact,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(!compact);
  return (
    <section
      className={cn(
        "rounded-(--radius-card) border-2 border-danger/30 bg-danger-soft p-4",
        className,
      )}
      aria-labelledby="stroke-warning-title"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={open}
      >
        <Siren size={28} className="shrink-0 text-danger" aria-hidden />
        <div className="flex-1">
          <h2
            id="stroke-warning-title"
            className="text-lg font-bold text-danger"
          >
            Tanda bahaya stroke (BE-FAST)
          </h2>
          {!open && (
            <p className="text-sm text-danger">
              Ketuk untuk melihat tanda-tanda. Jangan tunggu.
            </p>
          )}
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <ul className="space-y-2">
            {SIGNS.map(([k, en, id]) => (
              <li key={k} className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger text-lg font-bold text-danger-fg">
                  {k}
                </span>
                <span className="text-base text-text">
                  <span className="font-semibold">{en}:</span> {id}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-text">
            Ada satu saja tanda yang muncul tiba-tiba? Itu darurat, bukan urusan
            latihan. Rehat tidak bisa menilai stroke.
          </p>
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a
          href="tel:119"
          className={cn(CALL, "bg-danger text-danger-fg hover:bg-danger-hover")}
        >
          <Phone size={28} aria-hidden />
          Telepon 119
        </a>
        <a
          href="tel:112"
          className={cn(
            CALL,
            "border border-border bg-surface text-text hover:bg-surface-2",
          )}
        >
          <Phone size={28} aria-hidden />
          Darurat umum 112
        </a>
      </div>
    </section>
  );
}
