"use client";
// Smaller per-patient panels: history (from the server), alerts, notes, and the QR that puts a
// patient's phone online. Kept together because each is short and they share the same helpers.
import {
  BellRing,
  Check,
  ClipboardList,
  History,
  NotebookPen,
  QrCode as QrIcon,
  RefreshCw,
  ThumbsDown,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QrCode } from "@/components/ui/QrCode";
import {
  type AlertRow,
  api,
  type DashError,
  fmtDate,
  type ReviewRow,
  type ServerBreach,
  type ServerSession,
} from "./_lib/api";

const STATUS_LABEL = {
  COMPLETED: "Selesai",
  CANNOT_DO: "Tidak bisa",
  POSTPONED: "Ditunda",
} as const;

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(() => {
    setErr(null);
    load()
      .then(setData)
      .catch((x) => setErr((x as DashError).message));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, err, reload };
}

// --- history ----------------------------------------------------------------

export function HistoryPanel({ patientId }: { patientId: string }) {
  const load = useCallback(() => api.sessions(patientId), [patientId]);
  const { data, err, reload } = useLoad(load);
  const [open, setOpen] = useState<string | null>(null);
  const [breaches, setBreaches] = useState<Record<string, ServerBreach[]>>({});

  const toggle = (s: ServerSession) => {
    setOpen((o) => (o === s.id ? null : s.id));
    if (!breaches[s.id])
      api
        .breaches(s.id)
        .then((r) => setBreaches((b) => ({ ...b, [s.id]: r.items })))
        .catch(() => {});
  };

  const week = data?.items.filter(
    (s) => Date.now() - new Date(s.startedAt).getTime() < 7 * 86_400_000,
  );
  return (
    <div className="space-y-4">
      <Card title="Kepatuhan 7 hari terakhir" icon={ClipboardList}>
        <p className="text-3xl font-bold tabular-nums">
          {week ? week.length : "–"} sesi
        </p>
        <p className="mt-1 text-sm text-muted">
          Jumlah sesi yang tercatat. Ini bukan indikator pemulihan: pemulihan
          dinilai terapis, bukan dari angka ini.
        </p>
      </Card>
      <Card
        title="Riwayat sesi (server)"
        icon={History}
        actions={
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={reload}>
            Muat ulang
          </Button>
        }
      >
        {err && <p className="text-base text-danger">{err}</p>}
        {data && data.items.length === 0 && (
          <p className="text-base text-muted">
            Belum ada sesi. Sesi muncul setelah HP pasien selesai latihan dan
            tersambung internet.
          </p>
        )}
        <ul className="divide-y divide-border">
          {data?.items.map((s) => (
            <li key={s.id} className="py-3">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                onClick={() => toggle(s)}
                aria-expanded={open === s.id}
              >
                <span className="text-base font-medium">
                  {fmtDate(s.startedAt)}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Badge
                    tone={s.status === "COMPLETED" ? "success" : "neutral"}
                  >
                    {STATUS_LABEL[s.status]}
                  </Badge>
                  <Badge>
                    {s.reportedBy === "CAREGIVER"
                      ? "oleh pendamping"
                      : "oleh pasien"}
                  </Badge>
                </span>
              </button>
              {s.attempt && (
                <p className="mt-1 text-sm text-muted tabular-nums">
                  {s.attempt.reps} repetisi · puncak{" "}
                  {s.attempt.maxAngleDeg.toFixed(0)}° · kecepatan maks{" "}
                  {s.attempt.maxVelDegPerS.toFixed(0)}°/s ·{" "}
                  {Math.round(s.attempt.activeMs / 1000)} dtk aktif · jeda{" "}
                  {s.attempt.pauses} · batas v{s.envelopeVersion}
                </p>
              )}
              {open === s.id && (
                <div className="mt-2 rounded-(--radius-control) bg-surface-2 p-3 text-sm">
                  {!breaches[s.id] ? (
                    "Memuat..."
                  ) : breaches[s.id].length === 0 ? (
                    "Tidak ada kejadian melewati batas."
                  ) : (
                    <ul className="space-y-1 tabular-nums">
                      {breaches[s.id].map((b) => (
                        <li key={b.id}>
                          {fmtDate(b.occurredAt)} ·{" "}
                          {b.kind === "ANGLE" ? "sudut" : "kecepatan"}{" "}
                          {b.value.toFixed(0)} (batas {b.limit}) · {b.heldMs} ms
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// --- alerts -----------------------------------------------------------------

export function AlertsPanel({
  patientId,
  onChange,
}: {
  patientId: string;
  onChange?: () => void;
}) {
  const load = useCallback(() => api.alerts(patientId), [patientId]);
  const { data, err, reload } = useLoad(load);
  const act = async (a: AlertRow, falseAlarm: boolean) => {
    await api.ackAlert(a.id, falseAlarm).catch(() => {});
    reload();
    onChange?.();
  };
  return (
    <Card title="Peringatan keamanan" icon={BellRing}>
      <p className="mb-3 text-sm text-muted">
        Dibuat saat sesi dengan kejadian melewati batas tersinkron. Berdasarkan
        batas yang diatur terapis, bukan penilaian medis aplikasi.
      </p>
      {err && <p className="text-base text-danger">{err}</p>}
      {data?.length === 0 && (
        <p className="text-base text-muted">Belum ada peringatan.</p>
      )}
      <ul className="space-y-3">
        {data?.map((a) => (
          <li
            key={a.id}
            className="rounded-(--radius-control) border border-border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{fmtDate(a.createdAt)}</span>
              <Badge
                tone={
                  a.status === "PENDING"
                    ? "danger"
                    : a.status === "FALSE_ALARM"
                      ? "neutral"
                      : "success"
                }
              >
                {a.status === "PENDING"
                  ? `Belum ditangani · ${a.level}`
                  : a.status === "FALSE_ALARM"
                    ? "Alarm keliru"
                    : "Sudah dilihat"}
              </Badge>
            </div>
            {a.breachEvent && (
              <p className="mt-1 text-sm tabular-nums">
                {a.breachEvent.kind === "ANGLE" ? "Sudut" : "Kecepatan"}{" "}
                {a.breachEvent.value.toFixed(0)} melewati batas{" "}
                {a.breachEvent.limit}, selama {a.breachEvent.heldMs} ms
              </p>
            )}
            {a.status === "PENDING" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" icon={Check} onClick={() => act(a, false)}>
                  Sudah saya lihat
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ThumbsDown}
                  onClick={() => act(a, true)}
                >
                  Alarm ini keliru
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- notes ------------------------------------------------------------------

export function NotesPanel({ patientId }: { patientId: string }) {
  const load = useCallback(() => api.reviews(patientId), [patientId]);
  const { data, err, reload } = useLoad<ReviewRow[]>(load);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addReview(patientId, text.trim());
      setText("");
      reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Catatan perawat / terapis" icon={NotebookPen}>
      <form onSubmit={save} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Mis. latihan siku lancar, minta terapis cek nyeri bahu."
          className="w-full rounded-(--radius-control) border-2 border-border bg-surface p-3 text-base focus:border-primary focus:outline-none"
        />
        <Button type="submit" loading={busy} disabled={!text.trim()}>
          Simpan catatan
        </Button>
      </form>
      {err && <p className="mt-2 text-base text-danger">{err}</p>}
      <ul className="mt-4 space-y-3">
        {data?.map((r) => (
          <li key={r.id} className="border-l-4 border-primary pl-3">
            <div className="text-sm text-muted">{fmtDate(r.createdAt)}</div>
            <p className="whitespace-pre-wrap text-base">{r.note}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- link a phone -----------------------------------------------------------

/** Where a phone can open this app: the public origin, or the LAN HTTPS address in dev. */
async function phoneOrigin(): Promise<string> {
  const here = location.origin;
  if (!/localhost|127\.0\.0\.1/.test(location.hostname)) return here;
  try {
    const r = await fetch("/__lan");
    const { phoneUrls } = (await r.json()) as { phoneUrls: string[] };
    return phoneUrls[0] ?? here;
  } catch {
    return here;
  }
}

/** Same as MAX_LINK_USES on the server (src/app/api/_domain/care.ts). */
const MAX_PHONES = 4;

export function LinkPhonePanel({ patientId }: { patientId: string }) {
  const [link, setLink] = useState<{
    url: string;
    code: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const make = async () => {
    setBusy(true);
    setErr(null);
    try {
      const [{ token, code, expiresAt }, origin] = await Promise.all([
        api.deviceLink(patientId),
        phoneOrigin(),
      ]);
      // Token in the fragment (#), not the query: fragments are never sent to servers or logs.
      setLink({ url: `${origin}/phone#link=${token}`, code, expiresAt });
    } catch (x) {
      setErr((x as DashError).message);
    } finally {
      setBusy(false);
    }
  };
  const left = link
    ? Math.max(0, Math.round((link.expiresAt - now) / 1000))
    : 0;

  return (
    <Card title="Hubungkan HP pasien" icon={QrIcon}>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-base">
        <li>Buat QR, lalu pindai dengan kamera HP pasien.</li>
        <li>
          Kamera tidak bisa memindai? Buka halaman HP Rehat dan ketik kode di
          bawah QR.
        </li>
        <li>Pilih letak HP di tubuh (lengan atas, lengan bawah, ...).</li>
      </ol>
      <p className="mb-3 text-sm text-muted">
        Satu QR atau kode bisa dipakai sampai {MAX_PHONES} HP pasien yang sama
        (misalnya lengan atas + lengan bawah), berlaku 10 menit.
      </p>
      {err && <p className="mb-2 text-base text-danger">{err}</p>}
      {link && left > 0 ? (
        <div className="flex flex-col items-center gap-3">
          <QrCode value={link.url} size={240} label="QR masuk HP pasien" />
          <div className="text-center">
            <div className="text-sm text-muted">atau ketik kode</div>
            <div className="font-mono text-4xl font-semibold tracking-widest tabular-nums select-all">
              {link.code}
            </div>
          </div>
          <p className="text-base tabular-nums">
            Berlaku {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={make}
            loading={busy}
          >
            Buat QR baru
          </Button>
        </div>
      ) : (
        <Button icon={QrIcon} onClick={make} loading={busy} size="xl">
          {link ? "QR kedaluwarsa, buat lagi" : "Buat QR"}
        </Button>
      )}
      <div className="mt-4">
        <Alert tone="info" title="Keamanan">
          QR dan kode ini sama dengan kunci masuk pasien. Jangan difoto atau
          dikirim ke grup. Bila bocor, biarkan kedaluwarsa (10 menit) dan buat
          yang baru.
        </Alert>
      </div>
    </Card>
  );
}
