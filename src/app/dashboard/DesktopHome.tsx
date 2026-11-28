"use client";
// Nurse / therapist at a laptop: every number for every patient in one table, sortable, plus a
// detail column with per-exercise 28-day trends and the full patient view (live, program,
// history, alerts, notes, messages, QR).
//
// Columns are grouped so adherence (did they exercise) never sits under a "progress" heading:
// AKTIVITAS (counts) | KEAMANAN (breaches vs therapist limits) | GERAK (descriptive movement).
import { HandHelping } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { LivePeer } from "@/lib/live/protocol";
import { api, fmtAgo, fmtDate, type OverviewRow } from "./_lib/api";
import { Summary } from "./MobileHome";
import { Days7, FlagList, Num, TrendArrow, TrendSpark } from "./OverviewParts";
import { PatientView, type Tab } from "./PatientView";

type SortKey =
  | "priority"
  | "name"
  | "last"
  | "sessions7"
  | "minutes"
  | "breaches7"
  | "cannot";

const sorters: Record<SortKey, (a: OverviewRow, b: OverviewRow) => number> = {
  priority: (a, b) => b.priority - a.priority,
  name: (a, b) => a.displayName.localeCompare(b.displayName),
  last: (a, b) => (b.daysSinceLast ?? 999) - (a.daysSinceLast ?? 999),
  sessions7: (a, b) => a.sessions7 - b.sessions7,
  minutes: (a, b) => a.activeMinutes7 - b.activeMinutes7,
  breaches7: (a, b) => b.breaches7 - a.breaches7,
  cannot: (a, b) => b.cannotDo7 - a.cannotDo7,
};

export function DesktopHome({
  rows,
  selected,
  tab,
  onOpen,
  onClose,
  onChanged,
  me,
  fetchedAt,
}: {
  rows: OverviewRow[];
  selected: string | null;
  tab: Tab;
  onOpen: (id: string, tab?: Tab) => void;
  onClose: () => void;
  onChanged: () => void;
  me: LivePeer | null;
  fetchedAt: number | null;
}) {
  const [sort, setSort] = useState<SortKey>("priority");
  const sorted = useMemo(() => [...rows].sort(sorters[sort]), [rows, sort]);
  const sel = rows.find((r) => r.id === selected) ?? null;
  const tot = useMemo(
    () => ({
      s7: rows.reduce((a, r) => a + r.sessions7, 0),
      sp: rows.reduce((a, r) => a + r.sessionsPrev7, 0),
      min: rows.reduce((a, r) => a + r.activeMinutes7, 0),
      b7: rows.reduce((a, r) => a + r.breaches7, 0),
      bp: rows.reduce((a, r) => a + r.breachesPrev7, 0),
      cg: rows.reduce((a, r) => a + r.byCaregiver7, 0),
    }),
    [rows],
  );

  const Th = ({
    k,
    children,
    className,
  }: {
    k?: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      scope="col"
      className={cn(
        "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted",
        className,
      )}
      aria-sort={k && sort === k ? "descending" : undefined}
    >
      {k ? (
        <button
          type="button"
          onClick={() => setSort(k)}
          className={cn("hover:text-text", sort === k && "text-text underline")}
        >
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div className="space-y-4">
      <Summary rows={rows} />
      <Card>
        <div className="grid grid-cols-6 gap-4">
          <Num label="Pasien" value={rows.length} />
          <Num
            label="Sesi 7 hari"
            value={tot.s7}
            sub={`minggu lalu ${tot.sp}`}
          />
          <Num label="Menit aktif 7 hari" value={tot.min} />
          <Num label="Dicatat pendamping" value={tot.cg} sub="sesi 7 hari" />
          <Num
            label="Lewat batas 7 hari"
            value={tot.b7}
            sub={`minggu lalu ${tot.bp}`}
            tone={tot.b7 > tot.bp ? "warning" : undefined}
          />
          <Num
            label="Data"
            value={
              fetchedAt ? fmtAgo(new Date(fetchedAt).toISOString()) : "..."
            }
            sub="refresh tiap 30 dtk"
          />
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="border-b border-border">
            <tr>
              <th colSpan={3} />
              <th
                colSpan={4}
                className="border-l border-border px-2 pt-2 text-left text-xs font-bold text-muted"
              >
                AKTIVITAS (bukan indikator pemulihan)
              </th>
              <th
                colSpan={2}
                className="border-l border-border px-2 pt-2 text-left text-xs font-bold text-muted"
              >
                KEAMANAN (batas terapis)
              </th>
              <th
                colSpan={1}
                className="border-l border-border px-2 pt-2 text-left text-xs font-bold text-muted"
              >
                GERAK (deskriptif, 28 hari)
              </th>
            </tr>
            <tr>
              <Th k="name">Pasien</Th>
              <Th k="priority">Perlu dicek</Th>
              <Th k="last">Terakhir</Th>
              <Th k="sessions7" className="border-l border-border">
                7 hari
              </Th>
              <Th>Selesai / tidak bisa / tunda</Th>
              <Th k="minutes">Menit · rep</Th>
              <Th>Pendamping</Th>
              <Th k="breaches7" className="border-l border-border">
                Lewat batas
              </Th>
              <Th>Per sesi</Th>
              <Th className="border-l border-border">
                Latihan: puncak terakhir · median · tren · SPARC
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <motion.tr
                key={r.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => onOpen(r.id)}
                className={cn(
                  "cursor-pointer border-b border-border align-top hover:bg-surface-2",
                  selected === r.id && "bg-primary-soft",
                  (r.openHelp.length > 0 || r.pendingAlerts > 0) &&
                    "border-l-4 border-l-danger",
                )}
              >
                <td className="px-2 py-2 font-semibold text-base">
                  {r.displayName}
                </td>
                <td className="max-w-[280px] px-2 py-2">
                  <FlagList flags={r.flags} max={2} />
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {fmtAgo(r.lastSessionAt)}
                  <div className="text-xs text-muted">
                    {fmtDate(r.lastSessionAt)}
                  </div>
                </td>
                <td className="border-l border-border px-2 py-2">
                  <Days7 days={r.days7} />
                  <div className="text-xs text-muted tabular-nums">
                    {r.sessions7} (lalu {r.sessionsPrev7})
                  </div>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {r.completed7} / {r.cannotDo7} / {r.postponed7}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {r.activeMinutes7} · {r.reps7}
                </td>
                <td className="px-2 py-2 tabular-nums">{r.byCaregiver7}</td>
                <td
                  className={cn(
                    "border-l border-border px-2 py-2 tabular-nums",
                    r.breaches7 > r.breachesPrev7 &&
                      "font-semibold text-warning",
                  )}
                >
                  {r.breaches7}{" "}
                  <span className="text-xs text-muted">
                    (lalu {r.breachesPrev7})
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {r.breachRate7 ?? "–"}
                </td>
                <td className="border-l border-border px-2 py-2">
                  {r.trends.length === 0 ? (
                    <span className="text-muted">Belum ada sesi terukur</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {r.trends.map((t) => (
                        <li
                          key={t.exercise}
                          className="flex gap-2 tabular-nums"
                        >
                          <span className="w-40 truncate">{t.exercise}</span>
                          <span>{t.latestMaxDeg ?? "–"}°</span>
                          <span className="text-muted">
                            {t.medianMaxDeg ?? "–"}°
                          </span>
                          <TrendArrow slope={t.slopeDegPerWeek} />
                          <span className="text-muted">
                            {t.smoothnessSparc ?? "–"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border p-3 text-xs text-muted">
          Tren = kemiringan Theil–Sen puncak sudut per sesi (median semua
          pasangan, tahan sesi janggal; perlu ≥4 sesi). SPARC = kehalusan gerak
          (Balasubramanian 2015), makin dekat 0 makin halus. Semua angka
          deskriptif untuk membantu terapis memilih siapa yang dicek dulu; bukan
          diagnosis, bukan nilai pemulihan, tidak mengubah program. Ambang tanda
          (3 hari, 2× tidak bisa, −5°/minggu) adalah pengaturan alur kerja
          ILUSTRATIF, bukan ambang klinis.
        </p>
      </Card>

      {sel && me && (
        <motion.div
          key={sel.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="grid scroll-mt-4 grid-cols-[360px_1fr] gap-4"
          ref={(el) => {
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <div className="space-y-4">
            <Card title={`Ringkasan ${sel.displayName}`}>
              <FlagList flags={sel.flags} />
              {sel.openHelp.map((h) => (
                <Button
                  key={h.id}
                  className="mt-3 w-full"
                  variant="danger"
                  icon={HandHelping}
                  onClick={async () => {
                    await api.ackHelp(h.id);
                    onChanged();
                  }}
                >
                  Tutup permintaan bantuan {fmtDate(h.at)}
                </Button>
              ))}
              <div className="mt-3">
                <div className="text-xs font-medium uppercase text-muted">
                  Sesi per hari (7 hari)
                </div>
                <Days7 days={sel.days7} big />
              </div>
            </Card>
            {sel.trends.map((t) => (
              <Card key={t.exercise} title={t.exercise}>
                <TrendSpark trend={t} width={320} height={90} />
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Num
                    label="Puncak terakhir"
                    value={`${t.latestMaxDeg ?? "–"}°`}
                  />
                  <Num
                    label="Median 28 hari"
                    value={`${t.medianMaxDeg ?? "–"}°`}
                  />
                  <Num
                    label="Tren"
                    value={
                      t.slopeDegPerWeek === null
                        ? "–"
                        : `${t.slopeDegPerWeek > 0 ? "+" : ""}${t.slopeDegPerWeek}°`
                    }
                    sub="per minggu (Theil–Sen)"
                  />
                  <Num
                    label="Kehalusan"
                    value={t.smoothnessSparc ?? "–"}
                    sub={`SPARC median · ${t.sessions} sesi`}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Garis putus = tren Theil–Sen. Titik = puncak tiap sesi.
                </p>
              </Card>
            ))}
          </div>
          <PatientView
            key={`${sel.id}:${tab}`}
            patientId={sel.id}
            me={me}
            initialTab={tab}
            onBack={onClose}
            onAlertsChanged={onChanged}
          />
        </motion.div>
      )}
    </div>
  );
}
