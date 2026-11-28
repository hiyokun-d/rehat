"use client";
// Nurse -> patient phones. One tap for common messages, or type a short one (max 200 chars).
// Goes through the server (audited) and appears + is read aloud on every phone of this patient.
// Not a medical channel: no dosing, no diagnosis; the presets are logistics and encouragement.
import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api, type DashError } from "./_lib/api";

export const PRESETS = [
  "Saya sudah lihat. Saya akan menghubungi sebentar lagi.",
  "Istirahat dulu ya. Lanjutkan latihan besok.",
  "Tolong pasang HP lebih kencang di lengan, lalu mulai lagi.",
  "Latihan hari ini sudah tercatat. Terima kasih.",
];

export function MessagePanel({
  patientId,
  compact = false,
}: {
  patientId: string;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (t: string) => {
    const msg = t.trim();
    if (!msg) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.message(patientId, msg);
      setNote({
        ok: true,
        text: r.delivered
          ? "Terkirim. Muncul di HP pasien yang sedang membuka Rehat."
          : "Tercatat, tapi gagal dikirim live. Coba lagi.",
      });
      setText("");
    } catch (x) {
      setNote({ ok: false, text: (x as DashError).message });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => send(p)}
            className="rounded-(--radius-control) bg-surface-2 p-3 text-left text-base hover:bg-border disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          placeholder="Tulis pesan singkat"
          aria-label="Pesan untuk pasien"
          className="h-12 min-w-0 flex-1 rounded-(--radius-control) border-2 border-border bg-surface px-3 text-base focus:border-primary focus:outline-none"
        />
        <Button type="submit" icon={Send} disabled={busy || !text.trim()}>
          Kirim
        </Button>
      </form>
      {note && (
        <p
          className={
            note.ok ? "text-base text-success" : "text-base text-danger"
          }
        >
          {note.text}
        </p>
      )}
      <p className="text-sm text-muted">
        Pesan dibacakan di HP pasien dan tercatat. Bukan untuk saran medis
        darurat: untuk darurat arahkan ke 119.
      </p>
    </div>
  );
  return compact ? body : <Card title="Kirim pesan ke HP pasien">{body}</Card>;
}
