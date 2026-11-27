"use client";
// Scan the laptop's pairing QR from inside the app (after Mulai was already tapped, or when the
// phone's camera app is awkward). Uses the browser's own BarcodeDetector: Chrome on Android has
// it, iPhone Safari does not (as of Nov 2026), so there we hide this button and the phone's
// Camera app does the job (it opens /phone?room=CODE directly). No QR library, no download.
import { ScanLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { roomFromQr } from "@/lib/relay/protocol";
import { Button } from "./ui/Button";

interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

export function QrScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor })
      .BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });

    const loop = async () => {
      const v = videoRef.current;
      if (stopped || !v) return;
      try {
        for (const r of await detector.detect(v)) {
          const code = roomFromQr(r.rawValue);
          if (code) return onCode(code);
        }
      } catch {}
      timer = setTimeout(loop, 200); // 5 scans/s is plenty and keeps the phone cool
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (s) => {
        stream = s;
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = s;
        await videoRef.current.play();
        loop();
      })
      .catch((e: Error) =>
        setError(
          e.name === "NotAllowedError"
            ? "Izin kamera ditolak."
            : "Kamera tidak bisa dibuka.",
        ),
      );
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [onCode]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-(--radius-card) bg-text">
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-square w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-surface/80"
        />
      </div>
      <p className="flex items-center gap-2 text-base" aria-live="polite">
        <ScanLine size={20} className="text-primary" aria-hidden />
        {error ?? "Arahkan ke QR di layar laptop."}
      </p>
      <Button variant="secondary" icon={X} onClick={onClose} className="w-full">
        Tutup kamera
      </Button>
    </div>
  );
}
