"use client";
// Saved sessions: a trend across sessions, a list, and one session in detail. Used on the phone
// (patient / caregiver / nurse looking back, can edit who reported + difficulty + note) and on
// the laptop (therapist reviewing what phones sent, can write a therapist note).
//
// What we show and what we do NOT: angles, reps, limit events, pauses, time. No completion %,
// no "recovery" score (AGENTS.md: adherence is not a recovery indicator, the app does not judge).
import {
  ArrowLeft,
  BatteryMedium,
  CloudCheck,
  CloudOff,
  Download,
  History,
  OctagonAlert,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, ExampleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { EXERCISES, type ExerciseId } from "@/lib/rehab/defaults";
import { shareOrDownload } from "@/lib/rehab/sessionFiles";
import {
  type Difficulty,
  parseImport,
  type Reporter,
  type SessionSummary,
} from "@/lib/rehab/summary";
import { mmss, PeakBars, TraceChart } from "./charts";
import { QualityCard } from "./QualityCard";

const REPORTER: Record<Reporter, string> = {
  patient: "Pasien",
  caregiver: "Pendamping",
};
const DIFFICULTY: Record<Difficulty, string> = {
  mudah: "Mudah",
  sedang: "Sedang",
  sulit: "Sulit",
};

const dayFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
});
const day = (iso: string) => dayFmt.format(new Date(iso));
const time = (iso: string) => timeFmt.format(new Date(iso));

export interface SessionHistoryProps {
  sessions: SessionSummary[];
  /** "phone": edit reporter/difficulty/note. "screen": edit therapist note. */
  side: "phone" | "screen";
  onChange: (s: SessionSummary) => void;
  onDelete?: (id: string) => void;
  onImport?: (s: SessionSummary[]) => void;
}

export function SessionHistory({
  sessions,
  side,
  onChange,
  onDelete,
  onImport,
}: SessionHistoryProps) {
  const exercises = useMemo(
    () => [...new Set(sessions.map((s) => s.exercise))],
    [sessions],
  );
  const [exercise, setExercise] = useState<ExerciseId | null>(null);
  const ex = exercise ?? exercises[0] ?? "shoulder-flexion";
  const devices = useMemo(
    () => [...new Map(sessions.map((s) => [s.deviceId, s.deviceLabel]))],
    [sessions],
  );
  const [device, setDevice] = useState<string>("all");
  const shown = sessions.filter(
    (s) => s.exercise === ex && (device === "all" || s.deviceId === device),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  const importFile = async (file: File) => {
    try {
      const list = parseImport(JSON.parse(await file.text()));
      if (list.length) onImport?.(list);
    } catch {}
  };

  if (sessions.length === 0)
    return (
      <Card title="Riwayat latihan" icon={History}>
        <p className="text-base">Belum ada sesi tersimpan.</p>
        <p className="mt-1 text-sm text-muted">
          {side === "phone"
            ? "Setiap latihan yang selesai (tombol Selesai) disimpan di HP ini, juga tanpa internet."
            : "Sesi muncul di sini saat HP tersambung, atau impor file riwayat dari HP."}
        </p>
        {onImport && <ImportButton onFile={importFile} />}
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className={cn("space-y-4", selected && "hidden lg:block")}>
        <Card
          title="Sudut puncak per sesi"
          icon={History}
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={Share2}
              onClick={() => shareOrDownload(shown)}
            >
              {side === "phone" ? "Bagikan" : "Ekspor"}
            </Button>
          }
        >
          {exercises.length > 1 && (
            <div className="mb-3">
              <Tabs<ExerciseId>
                items={exercises.map((id) => ({
                  id,
                  label: EXERCISES[id].name,
                }))}
                value={ex}
                onChange={setExercise}
              />
            </div>
          )}
          {devices.length > 1 && (
            <label className="mb-3 block text-sm">
              <span className="text-muted">HP</span>
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className="mt-1 block h-11 w-full rounded-(--radius-control) border border-border bg-surface px-3"
              >
                <option value="all">Semua HP</option>
                {devices.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label} ({id.slice(0, 4)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <PeakBars
            bars={[...shown].reverse().map((s) => ({
              key: s.id,
              value: s.maxAngleDeg,
              label: day(s.startedAt).split(" ").slice(1).join(" "),
              tip: `${day(s.startedAt)} ${time(s.startedAt)} · ${s.maxAngleDeg.toFixed(0)}° · ${s.reps} rep`,
              over: s.breaches.some((b) => b.kind === "angle"),
            }))}
            ariaLabel={`Sudut puncak dari ${shown.length} sesi ${EXERCISES[ex].name}`}
          />
          <p className="mt-2 text-xs text-muted">
            Sudut terukur sensor HP, belum divalidasi. Bukan ukuran pemulihan:
            terapis yang menilai. Merah = ada kejadian melewati batas sudut.
          </p>
        </Card>

        <Card title={`${shown.length} sesi`}>
          <ul className="-mx-2 divide-y divide-border">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  aria-current={s.id === selectedId}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-(--radius-control) px-2 py-2 text-left hover:bg-surface-2",
                    s.id === selectedId && "bg-primary-soft",
                  )}
                >
                  <div className="w-16 shrink-0 text-sm">
                    <div className="font-semibold">{day(s.startedAt)}</div>
                    <div className="text-muted tabular-nums">
                      {time(s.startedAt)}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 text-sm tabular-nums">
                    <div>
                      <span className="font-semibold">{s.reps}</span> rep ·
                      puncak{" "}
                      <span className="font-semibold">
                        {s.maxAngleDeg.toFixed(0)}°
                      </span>{" "}
                      · {mmss(s.activeMs)}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {s.breaches.length > 0 && (
                        <Badge tone="danger">
                          <OctagonAlert size={12} aria-hidden />
                          {s.breaches.length} batas
                        </Badge>
                      )}
                      <Badge>{REPORTER[s.reportedBy]}</Badge>
                      {s.difficulty && (
                        <Badge>{DIFFICULTY[s.difficulty]}</Badge>
                      )}
                    </div>
                  </div>
                  {side === "phone" && <SyncIcon synced={!!s.syncedAt} />}
                </button>
              </li>
            ))}
          </ul>
          {onImport && <ImportButton onFile={importFile} />}
        </Card>
      </div>

      {selected ? (
        <SessionDetail
          key={selected.id}
          s={selected}
          side={side}
          onBack={() => setSelectedId(null)}
          onChange={onChange}
          onDelete={
            onDelete &&
            (() => {
              onDelete(selected.id);
              setSelectedId(null);
            })
          }
        />
      ) : (
        <div className="hidden items-center justify-center rounded-(--radius-card) border-2 border-dashed border-border p-8 text-muted lg:flex">
          Pilih sesi untuk melihat grafiknya.
        </div>
      )}
    </div>
  );
}

function SyncIcon({ synced }: { synced: boolean }) {
  return synced ? (
    <CloudCheck
      size={20}
      className="shrink-0 text-success"
      aria-label="Sudah terkirim ke laptop"
    />
  ) : (
    <CloudOff
      size={20}
      className="shrink-0 text-muted"
      aria-label="Belum terkirim ke laptop"
    />
  );
}

function ImportButton({ onFile }: { onFile: (f: File) => void }) {
  return (
    <label className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-(--radius-control) border border-dashed border-border text-sm font-medium text-muted hover:bg-surface-2">
      <Upload size={16} aria-hidden />
      Impor file riwayat (.json)
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </label>
  );
}

function SessionDetail({
  s,
  side,
  onBack,
  onChange,
  onDelete,
}: {
  s: SessionSummary;
  side: "phone" | "screen";
  onBack: () => void;
  onChange: (s: SessionSummary) => void;
  onDelete?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState(
    (side === "phone" ? s.note : s.therapistNote) ?? "",
  );
  const env = s.config.envelope;
  const batteryUsed = s.battery
    ? Math.round((s.battery.start - s.battery.end) * 100)
    : null;
  const saveNote = () =>
    onChange(
      side === "phone"
        ? { ...s, note: note || undefined }
        : { ...s, therapistNote: note || undefined },
    );

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={ArrowLeft}
            onClick={onBack}
            className="lg:hidden"
          >
            Kembali
          </Button>
          <div className="flex-1">
            <div className="text-lg font-semibold">
              {EXERCISES[s.exercise].name}
            </div>
            <div className="text-sm text-muted">
              {day(s.startedAt)}, {time(s.startedAt)}–{time(s.endedAt)} ·{" "}
              {s.deviceLabel}
              {s.source !== "phone" &&
                ` · ${s.source === "replay" ? "rekaman, bukan sensor langsung" : "sensor Bluetooth"}`}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Repetisi" value={s.reps} />
          <Stat
            label="Sudut puncak"
            value={s.maxAngleDeg.toFixed(0)}
            unit="°"
          />
          <Stat label="Waktu aktif" value={mmss(s.activeMs)} />
          <Stat
            label="Melewati batas"
            value={s.breaches.length}
            tone={s.breaches.length ? "danger" : "default"}
          />
        </div>
      </Card>

      <Card title="Sudut selama sesi">
        <TraceChart
          trace={s.trace}
          limitDeg={env.maxAngleDeg}
          marks={s.breaches.map((b) => ({ atMs: b.atMs, label: b.kind }))}
        />
      </Card>

      {s.repList.length > 0 && (
        <Card title="Puncak tiap repetisi">
          <PeakBars
            bars={s.repList.map((r, i) => ({
              key: String(r.atMs),
              value: r.peakDeg,
              label: String(i + 1),
              tip: `Rep ${i + 1} · ${r.peakDeg.toFixed(0)}° · ${(r.durMs / 1000).toFixed(1)} s`,
              over: r.peakDeg > env.maxAngleDeg,
            }))}
            limitDeg={env.maxAngleDeg}
            ariaLabel={`Sudut puncak ${s.repList.length} repetisi`}
          />
        </Card>
      )}

      <QualityCard reps={s.repList} />

      {s.breaches.length > 0 && (
        <Card
          title="Kejadian melewati batas yang diatur terapis"
          icon={OctagonAlert}
        >
          <ul className="divide-y divide-border text-sm tabular-nums">
            {s.breaches.map((b) => (
              <li
                key={`${b.kind}-${b.t}`}
                className="flex justify-between py-2"
              >
                <span>
                  {mmss(b.atMs)} · {b.kind === "angle" ? "Sudut" : "Kecepatan"}
                </span>
                <span className="font-medium">
                  {b.value.toFixed(0)}
                  {b.kind === "angle" ? "°" : "°/s"} (batas {b.limit})
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Catatan">
        <div className="space-y-4">
          {side === "phone" && (
            <>
              <div>
                <div className="mb-1.5 text-sm text-muted">Dicatat oleh</div>
                <Tabs<Reporter>
                  items={[
                    { id: "patient", label: REPORTER.patient },
                    { id: "caregiver", label: REPORTER.caregiver },
                  ]}
                  value={s.reportedBy}
                  onChange={(reportedBy) => onChange({ ...s, reportedBy })}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm text-muted">Rasanya</div>
                <Tabs<Difficulty>
                  items={(Object.keys(DIFFICULTY) as Difficulty[]).map(
                    (id) => ({
                      id,
                      label: DIFFICULTY[id],
                    }),
                  )}
                  value={s.difficulty ?? ("" as Difficulty)}
                  onChange={(difficulty) => onChange({ ...s, difficulty })}
                />
              </div>
            </>
          )}
          {side === "screen" && (s.note || s.difficulty) && (
            <p className="text-sm">
              <span className="text-muted">
                Dari {REPORTER[s.reportedBy].toLowerCase()}:
              </span>{" "}
              {s.difficulty && `${DIFFICULTY[s.difficulty]}. `}
              {s.note}
            </p>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">
              {side === "phone"
                ? "Catatan (misal: bahu terasa kaku)"
                : "Catatan terapis (hanya di laptop ini)"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              rows={3}
              className="block w-full rounded-(--radius-control) border border-border bg-surface p-3 text-base focus:border-primary focus:outline-none"
            />
          </label>
        </div>
      </Card>

      <Card title="Detail">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Batas sudut / kecepatan</dt>
          <dd className="text-right tabular-nums">
            {env.maxAngleDeg}° / {env.maxVelDegPerS}°/s
          </dd>
          <dt className="text-muted">Kecepatan tertinggi</dt>
          <dd className="text-right tabular-nums">
            {s.maxVelDegS.toFixed(0)}°/s
          </dd>
          <dt className="text-muted">Jeda (sensor terputus)</dt>
          <dd className="text-right tabular-nums">{s.pauses}×</dd>
          {batteryUsed !== null && (
            <>
              <dt className="flex items-center gap-1 text-muted">
                <BatteryMedium size={14} aria-hidden /> Baterai terpakai
              </dt>
              <dd className="text-right tabular-nums">
                {batteryUsed}% ({mmss(s.activeMs)})
              </dd>
            </>
          )}
          {side === "phone" && (
            <>
              <dt className="text-muted">Ke laptop</dt>
              <dd className="text-right">
                {s.syncedAt ? `terkirim ${time(s.syncedAt)}` : "belum"}
              </dd>
            </>
          )}
        </dl>
        <div className="mt-2">
          <ExampleBadge />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={side === "phone" ? Share2 : Download}
            onClick={() => shareOrDownload([s])}
          >
            {side === "phone" ? "Bagikan sesi ini" : "Unduh JSON"}
          </Button>
          {onDelete && (
            // Two taps instead of a confirm() dialog (dialogs block the page on some phones).
            <Button
              size="sm"
              variant={confirmDelete ? "danger" : "ghost"}
              icon={Trash2}
              onClick={() =>
                confirmDelete ? onDelete() : setConfirmDelete(true)
              }
            >
              {confirmDelete ? "Ketuk lagi untuk menghapus" : "Hapus"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
