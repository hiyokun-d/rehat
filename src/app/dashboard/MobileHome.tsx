"use client";
// Nurse on a phone: one scrolling work list, most urgent patient first (src/lib/care/triage.ts).
// Each card answers, without opening anything: who, what needs checking, when they last
// exercised, how the week went, and the latest movement numbers. One tap for the common actions:
// close a help request, send a message, show the QR to connect phones, open details.
// Plain Indonesian, big targets, no tables.
import {
  ChevronRight,
  HandHelping,
  MessageCircle,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CountUp } from "@/components/care/Motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { api, fmtAgo, type OverviewRow } from "./_lib/api";
import { MessagePanel } from "./MessagePanel";
import { Days7, FlagList, Num, TrendArrow } from "./OverviewParts";
import type { Tab } from "./PatientView";

export function Summary({ rows }: { rows: OverviewRow[] }) {
  const help = rows.filter((r) => r.openHelp.length).length;
  const alerts = rows.reduce((a, r) => a + r.pendingAlerts, 0);
  const quiet = rows.filter(
    (r) => r.daysSinceLast === null || r.daysSinceLast >= 3,
  ).length;
  const today = rows.filter((r) => r.days7[0] > 0).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Box n={help} label="Minta bantuan" tone={help ? "danger" : undefined} />
      <Box
        n={alerts}
        label="Peringatan batas"
        tone={alerts ? "danger" : undefined}
      />
      <Box
        n={quiet}
        label="3+ hari tanpa latihan"
        tone={quiet ? "warning" : undefined}
      />
      <Box n={`${today}/${rows.length}`} label="Latihan hari ini" />
    </div>
  );
}

function Box({
  n,
  label,
  tone,
}: {
  n: number | string;
  label: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-(--radius-card) p-3",
        tone === "danger"
          ? "bg-danger-soft text-danger"
          : tone === "warning"
            ? "bg-warning-soft text-warning"
            : "bg-surface shadow-(--shadow-card)",
      )}
    >
      <div className="text-3xl font-semibold tabular-nums">
        {typeof n === "number" ? <CountUp value={n} /> : n}
      </div>
      <div className="text-sm font-medium">{label}</div>
    </div>
  );
}

export function MobileHome({
  rows,
  onOpen,
  onChanged,
  fetchedAt,
  fromCache,
}: {
  rows: OverviewRow[];
  onOpen: (id: string, tab?: Tab) => void;
  onChanged: () => void;
  fetchedAt: number | null;
  fromCache: boolean;
}) {
  // "Cek dulu" = anything high or medium (help, alerts, inactivity, breach rise, cannot-do).
  const urgent = rows.filter((r) => r.flags.some((f) => f.level !== "info"));
  const rest = rows.filter((r) => !urgent.includes(r));
  return (
    <div className="space-y-4">
      <Summary rows={rows} />
      <p className="flex items-center gap-1 text-sm text-muted">
        <RefreshCw size={14} aria-hidden />
        {fromCache ? "Data tersimpan, " : "Diperbarui "}
        {fetchedAt ? fmtAgo(new Date(fetchedAt).toISOString()) : "..."}
        {fromCache ? " (memuat terbaru...)" : " · otomatis tiap 30 detik"}
      </p>
      {urgent.length > 0 && (
        <h2 className="pt-1 text-lg font-semibold">Cek dulu</h2>
      )}
      <PatientList rows={urgent} onOpen={onOpen} onChanged={onChanged} />
      {rest.length > 0 && (
        <h2 className="pt-2 text-lg font-semibold text-muted">
          {urgent.length ? "Pasien lain" : "Semua pasien"}
        </h2>
      )}
      <PatientList rows={rest} onOpen={onOpen} onChanged={onChanged} />
    </div>
  );
}

/** Re-orders animate (layout), so the nurse sees a patient move up when something changes. */
function PatientList({
  rows,
  onOpen,
  onChanged,
}: {
  rows: OverviewRow[];
  onOpen: (id: string, tab?: Tab) => void;
  onChanged: () => void;
}) {
  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => (
          <motion.li
            key={r.id}
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.04 }}
          >
            <PatientCard row={r} onOpen={onOpen} onChanged={onChanged} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function PatientCard({
  row: r,
  onOpen,
  onChanged,
}: {
  row: OverviewRow;
  onOpen: (id: string, tab?: Tab) => void;
  onChanged: () => void;
}) {
  const [msg, setMsg] = useState(false);
  const [busy, setBusy] = useState(false);
  const help = r.openHelp[0];
  const urgent = help || r.pendingAlerts > 0;
  return (
    <Card className={cn(urgent && "ring-2 ring-danger")} title={undefined}>
      <button
        type="button"
        onClick={() => onOpen(r.id)}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-semibold">{r.displayName}</span>
          <span className="block text-base text-muted">
            Latihan terakhir {fmtAgo(r.lastSessionAt)}
          </span>
        </span>
        <ChevronRight size={24} className="mt-1 text-muted" aria-hidden />
      </button>

      <div className="mt-2">
        <FlagList flags={r.flags} max={3} />
      </div>

      {help && (
        <motion.div
          className="mt-3 rounded-(--radius-control)"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(180,35,24,0.45)",
              "0 0 0 10px rgba(180,35,24,0)",
            ],
          }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY }}
        >
          <Button
            className="w-full"
            variant="danger"
            icon={HandHelping}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.ackHelp(help.id);
                onChanged();
              } finally {
                setBusy(false);
              }
            }}
          >
            Sudah saya tangani
          </Button>
        </motion.div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            7 hari
          </div>
          <Days7 days={r.days7} />
          <div className="text-xs text-muted">
            {r.sessions7} sesi (lalu {r.sessionsPrev7})
          </div>
        </div>
        <Num
          label="Menit aktif"
          value={r.activeMinutes7}
          sub={`${r.reps7} repetisi`}
        />
        <Num
          label="Lewat batas"
          value={r.breaches7}
          sub={`minggu lalu ${r.breachesPrev7}`}
          tone={r.breaches7 > r.breachesPrev7 ? "warning" : undefined}
        />
      </div>

      {r.trends.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-base">
          {r.trends.map((t) => (
            <li key={t.exercise} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{t.exercise}</span>
              <span className="font-semibold tabular-nums">
                {t.latestMaxDeg ?? "–"}°
              </span>
              <span className="text-sm text-muted">
                <TrendArrow slope={t.slopeDegPerWeek} />
              </span>
            </li>
          ))}
          <li className="text-xs text-muted">
            Puncak sudut sesi terakhir dan arahnya (Theil–Sen, 28 hari). Bukan
            nilai pemulihan.
          </li>
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          icon={MessageCircle}
          onClick={() => setMsg((v) => !v)}
        >
          Pesan
        </Button>
        <Button
          variant="secondary"
          icon={QrCode}
          onClick={() => onOpen(r.id, "link")}
        >
          Sambung HP
        </Button>
      </div>
      {msg && (
        <div className="mt-3">
          <MessagePanel patientId={r.id} compact />
        </div>
      )}
    </Card>
  );
}
