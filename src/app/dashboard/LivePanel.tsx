"use client";
// Live view of ONE patient: every phone on their body, side by side, plus joint estimates from
// pairs of phones (experiment). The screen never decides safety; the phones do (edge). The only
// commands it sends can make things safer: "pause" (one phone or all).
import { Activity, Hand, PauseCircle, Smartphone, Unplug } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { PhasePill, SensorPill } from "@/components/ConnectionPills";
import { AngleGauge } from "@/components/rehab/AngleGauge";
import { Alert } from "@/components/ui/Alert";
import { Badge, ExampleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import type { LiveState } from "@/hooks/useLiveChannel";
import {
  duplicateDisagreement,
  jointsFor,
  type SegmentReading,
} from "@/lib/live/fusion";
import { placementLabel, SEGMENTS, SIDE_LABEL } from "@/lib/live/placement";
import type { LivePeer } from "@/lib/live/protocol";
import type { BreachEvent } from "@/lib/rehab/envelope";
import type { PhoneState } from "@/lib/rehab/messages";

/** No state message for this long = this phone is not monitored any more. */
export const STALE_MS = 2000;

export interface PhoneLive {
  deviceId: string;
  state: PhoneState | null;
  receivedAt: number;
  breaches: (BreachEvent & { at: number })[];
}

export function LivePanel({
  live,
  peers,
  phones,
  onPause,
}: {
  live: LiveState;
  peers: LivePeer[];
  phones: Record<string, PhoneLive>;
  onPause: (deviceId?: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const phonePeers = peers.filter((p) => p.role === "phone");
  const readings: SegmentReading[] = phonePeers.flatMap((p) => {
    const ph = phones[p.deviceId];
    if (!p.placement || !ph?.state) return [];
    return [
      {
        deviceId: p.deviceId,
        placement: p.placement,
        angleDeg: ph.state.angleDeg,
        phase: ph.state.phase,
        receivedAt: ph.receivedAt,
      },
    ];
  });
  const joints = jointsFor(readings, now);
  const dupes = duplicateDisagreement(readings, now);
  const feed = Object.values(phones)
    .flatMap((p) => p.breaches.map((b) => ({ ...b, deviceId: p.deviceId })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  const anyRunning = phonePeers.some(
    (p) => phones[p.deviceId]?.state?.phase === "running",
  );

  if (live !== "open")
    return (
      <Alert
        tone={live === "error" ? "danger" : "info"}
        title={
          live === "error"
            ? "Tidak bisa membuka ruang live pasien"
            : "Menghubungkan ke ruang live pasien..."
        }
      >
        {live === "error" &&
          "Periksa koneksi internet. Ruang hanya terbuka untuk perawat pasien ini."}
      </Alert>
    );

  return (
    <div className="space-y-4">
      {phonePeers.length === 0 ? (
        <Card title="Belum ada HP pasien yang tersambung" icon={Smartphone}>
          <p className="text-base text-muted">
            Buka tab "Hubungkan HP", pindai QR di HP pasien, lalu pilih letak HP
            di tubuh. Satu pasien boleh memakai beberapa HP.
          </p>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base text-muted">
            {phonePeers.length} HP di tubuh pasien
          </p>
          {anyRunning && (
            <Button
              variant="danger"
              icon={PauseCircle}
              onClick={() => onPause()}
            >
              Jeda semua
            </Button>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {feed.length > 0 && now - feed[0].at < 6000 && (
          <Alert
            key={`b-${feed[0].at}`}
            tone="danger"
            big
            title="Melewati batas yang diatur terapis"
          >
            {feed[0].kind === "angle" ? "Sudut" : "Kecepatan"}{" "}
            {feed[0].value.toFixed(0)}
            {feed[0].kind === "angle" ? "°" : "°/s"} (batas {feed[0].limit})
          </Alert>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {phonePeers.map((p) => {
          const ph = phones[p.deviceId];
          const st = ph?.state ?? null;
          const stale = !ph || now - ph.receivedAt > STALE_MS;
          const limit = st?.config.envelope.maxAngleDeg ?? 90;
          const seg = p.placement ? SEGMENTS[p.placement.segment] : null;
          const lostWhileRunning = stale && st?.phase === "running";
          return (
            <Card
              key={p.deviceId}
              title={p.placement ? placementLabel(p.placement) : p.label}
              icon={Smartphone}
              actions={
                seg?.experimental ? (
                  <Badge tone="warning">eksperimen</Badge>
                ) : null
              }
            >
              <div className="mb-2 flex flex-wrap gap-2">
                <SensorPill status={stale ? "stale" : (st?.sensor ?? "off")} />
                {st && <PhasePill phase={st.phase} />}
              </div>
              {lostWhileRunning && (
                <Alert tone="danger" title="Tidak terpantau" icon={Unplug}>
                  Data HP ini berhenti masuk. Tidak terpantau berarti tidak
                  aman: HP menjeda latihan sendiri bila sensornya hilang.
                </Alert>
              )}
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <AngleGauge
                  angleDeg={st && !stale ? st.angleDeg : null}
                  limitDeg={limit}
                  over={!!st && st.angleDeg > limit}
                />
                <div className="space-y-3 pb-2">
                  <Stat label="Repetisi" value={st?.reps ?? "–"} />
                  <Stat
                    label="Kecepatan"
                    value={st ? st.velDegS.toFixed(0) : "–"}
                    unit="°/s"
                  />
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">
                {p.label} · {st ? `${st.rate.hz.toFixed(0)} Hz` : "–"}
                {st?.extras.battery &&
                  ` · baterai ${Math.round(st.extras.battery.level * 100)}%`}
              </p>
              {st?.phase === "running" && (
                <Button
                  variant="secondary"
                  icon={PauseCircle}
                  className="mt-3 w-full"
                  onClick={() => onPause(p.deviceId)}
                >
                  Jeda HP ini
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {joints.length > 0 && (
        <Card
          title="Sudut sendi dari 2 HP"
          icon={Hand}
          actions={<Badge tone="warning">eksperimen</Badge>}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {joints.map((j) => (
              <div
                key={`${j.joint.id}-${j.side}`}
                className="rounded-(--radius-control) bg-surface-2 p-3"
              >
                <div className="text-base font-semibold">
                  {j.joint.label} {SIDE_LABEL[j.side]}
                </div>
                {j.result.status === "ok" ? (
                  <>
                    <div className="text-3xl font-bold tabular-nums">
                      {j.result.angleDeg.toFixed(0)}°
                    </div>
                    <div className="text-sm text-muted tabular-nums">
                      {SEGMENTS[j.joint.proximal].label}{" "}
                      {j.result.proximalDeg.toFixed(0)}° ·{" "}
                      {SEGMENTS[j.joint.distal].label}{" "}
                      {j.result.distalDeg.toFixed(0)}°
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted">
                    {j.result.status === "missing"
                      ? `Butuh HP di ${SEGMENTS[j.joint.proximal].label.toLowerCase()} dan ${SEGMENTS[j.joint.distal].label.toLowerCase()} sisi yang sama.`
                      : j.result.status === "stale"
                        ? "Data salah satu HP terlambat."
                        : "Kedua HP harus sudah kalibrasi dan berjalan."}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Perkiraan = kemiringan segmen bawah dikurangi segmen atas, dengan
            asumsi keduanya bergerak di satu bidang dan dikalibrasi di posisi
            awal yang sama. Hanya tampilan. Batas keamanan tetap dicek di
            masing-masing HP. Belum divalidasi tim.
          </p>
        </Card>
      )}

      {dupes.map((d) => (
        <Alert
          key={`${d.placement.segment}-${d.placement.side}`}
          tone="warning"
          title={`${d.devices.length} HP di ${placementLabel(d.placement)} berbeda ${d.diffDeg.toFixed(0)}°`}
        >
          HP di segmen yang sama seharusnya membaca sudut yang mirip. Selisih
          besar biasanya berarti tali bergeser atau HP terpasang miring.
        </Alert>
      ))}

      {feed.length > 0 && (
        <Card title="Kejadian melewati batas (sesi live ini)" icon={Activity}>
          <ul className="space-y-1 text-base tabular-nums">
            {feed.map((b) => {
              const peer = phonePeers.find((p) => p.deviceId === b.deviceId);
              return (
                <li key={`${b.deviceId}-${b.at}`}>
                  {new Date(b.at).toLocaleTimeString("id-ID")} ·{" "}
                  {peer?.placement ? placementLabel(peer.placement) : "HP"} ·{" "}
                  {b.kind === "angle" ? "sudut" : "kecepatan"}{" "}
                  {b.value.toFixed(0)} (batas {b.limit})
                </li>
              );
            })}
          </ul>
          <div className="mt-2">
            <ExampleBadge />
          </div>
        </Card>
      )}
    </div>
  );
}
