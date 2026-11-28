"use client";
// Two-way line between the patient's phone and their nurse, on top of the live room:
// - NurseMessageCard: shows (and reads aloud) the latest text the nurse sent.
// - HelpButton: "Saya butuh bantuan" -> POST /api/help -> audited + pushed to the nurse dashboard.
// Neither replaces emergency services: the stroke warning card with 119 stays on screen.
import { HandHelping, MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { NurseMessage } from "./usePatientLive";

export function NurseMessageCard({
  message,
  onClose,
  speak,
}: {
  message: NurseMessage | null;
  onClose: () => void;
  speak: (text: string) => void;
}) {
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!message || said.current === message.at) return;
    said.current = message.at;
    speak(`Pesan dari perawat. ${message.text}`);
    navigator.vibrate?.([120, 80, 120]);
  }, [message, speak]);
  if (!message) return null;
  return (
    <div className="relative">
      <Alert
        tone="info"
        title={`Pesan dari ${message.from}`}
        icon={MessageCircle}
      >
        <p className="text-lg">{message.text}</p>
        <p className="mt-1 text-sm text-muted">
          {new Date(message.at).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </Alert>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup pesan"
        className="absolute top-2 right-2 rounded-lg p-2 text-muted hover:bg-surface-2"
      >
        <X size={20} aria-hidden />
      </button>
    </div>
  );
}

type HelpState = "idle" | "sending" | "sent" | "error";

export function HelpButton() {
  const [st, setSt] = useState<HelpState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setSt("sending");
    setErr(null);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? "Gagal mengirim.");
      }
      setSt("sent");
      navigator.vibrate?.(200);
    } catch (e) {
      setSt("error");
      setErr(
        e instanceof Error && e.message !== "Failed to fetch"
          ? e.message
          : "Tidak ada internet. Telepon perawat atau 119 bila darurat.",
      );
    }
  };
  return (
    <div className="space-y-2">
      <Button
        size="xl"
        variant="secondary"
        icon={HandHelping}
        onClick={send}
        disabled={st === "sending"}
      >
        {st === "sent"
          ? "Perawat sudah diberi tahu"
          : "Saya butuh bantuan perawat"}
      </Button>
      {st === "sent" && (
        <p className="text-base text-muted">
          Tunggu perawat menghubungi. Bila darurat (wajah mencong, lengan lemah,
          bicara pelo), langsung telepon 119.
        </p>
      )}
      {st === "error" && err && <p className="text-base text-danger">{err}</p>}
    </div>
  );
}
