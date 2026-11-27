"use client";
import { Radio, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./ui/Card";
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
}: {
  code: string | null;
  path?: string;
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

  return (
    <Card title="Hubungkan HP">
      <div className="flex flex-wrap items-center gap-5">
        {url ? (
          <QrCode value={url} label={`QR untuk membuka ${url}`} />
        ) : (
          <div className="size-44 rounded-lg bg-surface-2" />
        )}
        <div className="min-w-56 flex-1 space-y-2">
          <p className="text-base">
            Pindai QR dengan kamera HP (Wi-Fi yang sama), lalu tekan Mulai.
          </p>
          <p className="text-base text-muted">
            Atau buka <span className="font-medium text-text">{path}</span> dan
            ketik kode{" "}
            <span className="font-semibold tracking-widest text-text">
              {code ?? "····"}
            </span>
            .
          </p>
          {base?.startsWith("https://") && usable && (
            <p className="text-sm text-muted">
              Pertama kali, HP akan memperingatkan sertifikat. Pilih Lanjutkan /
              Kunjungi situs ini.
            </p>
          )}
          {!usable && (
            <p className="flex items-start gap-1.5 text-sm text-warning">
              <TriangleAlert
                size={16}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              Belum ada alamat HTTPS untuk HP. Jalankan bun run cert lalu
              restart server, atau pakai tunnel.
            </p>
          )}
          {url && <p className="break-all text-xs text-muted">{url}</p>}
        </div>
      </div>
    </Card>
  );
}
