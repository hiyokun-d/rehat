"use client";
import {
  BatteryMedium,
  History,
  Radio,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./ui/Card";
import { Disclosure } from "./ui/Disclosure";
import { QrCode } from "./ui/QrCode";

/** Compact code for the header. */
export function RoomCodeDisplay({ code }: { code: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-(--radius-card) bg-surface px-4 py-2 shadow-(--shadow-card)">
      <Radio size={20} className="text-primary" aria-hidden />
      <div>
        <div className="text-sm font-medium text-muted">
          Kode ruang (ketik di HP)
        </div>
        <div
          className="text-3xl font-semibold tracking-[0.3em] tabular-nums"
          aria-live="polite"
        >
          {code ?? "····"}
        </div>
      </div>
    </div>
  );
}

/**
 * Big pairing panel: the QR opens /phone?room=CODE on the phone. Phones need HTTPS for motion
 * sensors, so if this page is on localhost or plain http we ask the server for its LAN HTTPS
 * address (https://<LAN IP>:3443) and put that in the QR instead.
 */
export function PairingCard({
  code,
  path = "/phone",
  minimizable = false,
}: {
  code: string | null;
  path?: string;
  minimizable?: boolean;
}) {
  const [base, setBase] = useState<string | null>(null);
  const [usable, setUsable] = useState(true);

  useEffect(() => {
    const here = location.origin;
    const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(here);
    if (location.protocol === "https:" && !local) return setBase(here);
    fetch("/__lan")
      .then((r) => r.json() as Promise<{ phoneUrls: string[] }>)
      .then(({ phoneUrls }) => {
        setBase(phoneUrls[0] ?? here);
        setUsable(phoneUrls.length > 0);
      })
      .catch(() => {
        setBase(here);
        setUsable(false);
      });
  }, []);

  const url =
    code && base
      ? `${base}${path}${path.includes("?") ? "&" : "?"}room=${code}`
      : null;

  const https = base?.startsWith("https://") && usable;
  const steps = [
    "Sambungkan HP ke Wi-Fi yang sama dengan laptop ini.",
    "Buka aplikasi Kamera di HP, arahkan ke QR, ketuk tautannya.",
    ...(https
      ? [
          "Peringatan sertifikat (sekali saja): pilih Lanjutkan / Kunjungi situs.",
        ]
      : []),
    "Di HP, tekan Mulai latihan. Riwayat di HP ikut terkirim ke sini.",
  ];

  const content = (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-(--radius-card) border border-border p-3">
        {url ? (
          <QrCode value={url} size={232} label={`QR untuk membuka ${url}`} />
        ) : (
          <div className="size-58 rounded-lg bg-surface-2" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <ol className="space-y-3">
          {steps.map((t, i) => (
            <li key={t} className="flex gap-3 text-base">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-hover">
                {i + 1}
              </span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-(--radius-control) bg-surface-2 p-3 text-sm">
          <span className="text-muted">Tanpa kamera? Buka </span>
          <span className="font-medium">{path}</span>
          <span className="text-muted"> di HP dan ketik kode </span>
          <span className="text-xl font-semibold tracking-[0.3em] tabular-nums">
            {code ?? "····"}
          </span>
        </div>
        {!usable && (
          <p className="flex items-start gap-1.5 text-sm text-warning">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            Belum ada alamat HTTPS untuk HP. Jalankan bun run cert lalu restart
            server, atau pakai tunnel.
          </p>
        )}
        {url && <p className="break-all text-xs text-muted">{url}</p>}
      </div>
    </div>
  );

  if (minimizable)
    return (
      <Disclosure title="Hubungkan HP" defaultOpen>
        {content}
      </Disclosure>
    );

  return <Card title="Hubungkan HP">{content}</Card>;
}

/** Replaces the pairing panel once a phone is in the room: which phone, is data flowing. */
export function PhoneCard({
  label,
  hz,
  battery,
  sessions,
  stale,
}: {
  label: string;
  hz: number | null;
  battery: { level: number; charging: boolean } | null;
  sessions: number;
  stale: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-(--radius-card) bg-surface px-4 py-3 shadow-(--shadow-card)">
      <span className="flex items-center gap-2 font-semibold">
        <Smartphone size={20} className="text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-sm text-muted tabular-nums">
        {stale
          ? "data terhenti"
          : hz
            ? `${hz.toFixed(0)} Hz`
            : "sensor belum mulai"}
      </span>
      {battery && (
        <span className="flex items-center gap-1 text-sm text-muted tabular-nums">
          <BatteryMedium size={16} aria-hidden />
          {Math.round(battery.level * 100)}%{battery.charging && " (mengisi)"}
        </span>
      )}
      <span className="flex items-center gap-1 text-sm text-muted">
        <History size={16} aria-hidden />
        {sessions} sesi dari HP ini di laptop
      </span>
    </div>
  );
}
