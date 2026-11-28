"use client";
// /screen — the laptop. Shows the room code, live data from the phone, and the therapist-side
// settings. It never decides anything about safety: the phone does, the screen displays.
import { Activity, Cpu, Gauge, History, LineChart, Ruler } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { PhasePill, RelayPill, SensorPill } from "@/components/ConnectionPills";
import { type ChartPoint, LiveChart } from "@/components/LiveChart";
import { LiveMultiChart, type SeriesPoint } from "@/components/LiveMultiChart";
import {
  PairingCard,
  PhoneCard,
  RoomCodeDisplay,
} from "@/components/RoomCodeDisplay";
import { AngleGauge } from "@/components/rehab/AngleGauge";
import { CapabilityList } from "@/components/rehab/CapabilityList";
import { EnvelopeCard } from "@/components/rehab/EnvelopeCard";
import { extrasRows } from "@/components/rehab/extrasRows";
import { RawSampleCard } from "@/components/rehab/RawSampleCard";
import { RecordingsCard } from "@/components/rehab/RecordingsCard";
import { SessionHistory } from "@/components/rehab/SessionHistory";
import { ValidationPanel } from "@/components/rehab/ValidationPanel";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { useRelay } from "@/hooks/useRelay";
import { useSessions } from "@/hooks/useSessions";
import { createApiClient } from "@/lib/api/client";
import { makeTicketProvider } from "@/lib/api/wsTicket";
import { getDb } from "@/lib/db";
import type { BreachEvent } from "@/lib/rehab/envelope";
import type {
  PhoneInfo,
  PhonePayloads,
  PhoneState,
  TelemetryPoint,
} from "@/lib/rehab/messages";
import { DEFAULT_CONFIG, type SessionConfig } from "@/lib/rehab/session";
import type { SessionSummary } from "@/lib/rehab/summary";
import { downloadJson, stamp } from "@/lib/sensor/recording";
import { fetchSessions } from "./_lib/historyApi";
import { liveRelayEnabled } from "./_lib/liveGate";
import { LocalModeNotice } from "./LocalModeNotice";
import { ServerHistory } from "./ServerHistory";

type Tab = "live" | "history" | "validate" | "raw";
const ROOM_KEY = "rehat-room";
/** No state message from a connected phone for this long = we are not seeing it any more. */
const STALE_MS = 1500;
const CHART_KEEP_MS = 12_000;

/** Store sessions from a phone (or a file); keep the therapist's note on re-sync. */
async function storeSessions(list: SessionSummary[]): Promise<string[]> {
  const db = getDb();
  const at = new Date().toISOString();
  const old = await db.sessions.bulkGet(list.map((x) => x.id));
  await db.sessions.bulkPut(
    list.map((x, i) => ({
      ...x,
      syncedAt: undefined,
      receivedAt: at,
      therapistNote: old[i]?.therapistNote,
    })),
  );
  return list.map((x) => x.id);
}

function trim<T extends { t: number }>(arr: T[]) {
  if (!arr.length) return;
  const cutoff = arr[arr.length - 1].t - CHART_KEEP_MS;
  while (arr.length && arr[0].t < cutoff) arr.shift();
}

export function ScreenApp() {
  const [ready, setReady] = useState(false);
  const [savedRoom, setSavedRoom] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [phone, setPhone] = useState<PhoneState | null>(null);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [breaches, setBreaches] = useState<BreachEvent[]>([]);
  const [stale, setStale] = useState(false);
  const [received, setReceived] = useState<string | null>(null);
  // null = not known yet; false = no therapist login, so this screen is in local mode.
  const [therapist, setTherapist] = useState<boolean | null>(null);
  const therapistRef = useRef(false);
  therapistRef.current = therapist === true;
  const [getTicket] = useState(() =>
    makeTicketProvider(createApiClient(), () => therapistRef.current),
  );
  const points = useRef<ChartPoint[]>([]);
  const accel = useRef<SeriesPoint[]>([]);
  const gyro = useRef<SeriesPoint[]>([]);
  const linear = useRef<SeriesPoint[]>([]);
  const sessions = useSessions();
  const latest = useRef<TelemetryPoint | null>(null);
  const lastStateAt = useRef(0);

  // sessionStorage: a reload of this tab keeps the same room code, so the phone stays paired.
  useEffect(() => {
    try {
      setSavedRoom(sessionStorage.getItem(ROOM_KEY));
    } catch {}
    setReady(true);
    // One probe so the Live tab can say it is the local fallback without opening Riwayat.
    fetchSessions()
      .then((r) => setTherapist(r.ok))
      .catch(() => setTherapist(false));
  }, []);

  const relay = useRelay({
    role: "screen",
    roomId: savedRoom,
    enabled: liveRelayEnabled(ready, therapist),
    getTicket,
    onMessage: (m) => {
      const p = m.payload;
      switch (m.type) {
        case "joined":
          try {
            sessionStorage.setItem(ROOM_KEY, m.roomId);
          } catch {}
          break;
        case "hello": {
          const hi = p as PhoneInfo;
          setInfo(hi);
          relay.send("config", config);
          // Ask for the history we do not have yet (see messages.ts for the sync flow).
          getDb()
            .sessions.where("deviceId")
            .equals(hi.deviceId)
            .primaryKeys()
            .then((have) =>
              relay.send("sync-request", { deviceId: hi.deviceId, have }),
            )
            .catch(() => {});
          break;
        }
        case "sessions":
          storeSessions((p as PhonePayloads["sessions"]).sessions)
            .then((ids) => relay.send("sessions-ack", { ids }))
            .catch(() => {});
          break;
        case "state":
          lastStateAt.current = performance.now();
          setPhone(p as PhoneState);
          break;
        case "telemetry":
          for (const pt of (p as PhonePayloads["telemetry"]).points) {
            points.current.push({ t: pt.t, v: pt.angleDeg });
            accel.current.push({ t: pt.t, v: [pt.ax, pt.ay, pt.az] });
            gyro.current.push({ t: pt.t, v: [pt.gx, pt.gy, pt.gz] });
            if (pt.lx !== undefined)
              linear.current.push({
                t: pt.t,
                v: [pt.lx, pt.ly ?? 0, pt.lz ?? 0],
              });
            latest.current = pt;
          }
          trim(points.current);
          for (const r of [accel, gyro, linear]) trim(r.current);
          break;
        case "breach":
          setBreaches((b) => [p as BreachEvent, ...b].slice(0, 8));
          break;
        case "recording": {
          const rec = p as PhonePayloads["recording"];
          const name = `rekaman-hp-${stamp()}`;
          getDb().recordings.add({ ...rec, name });
          downloadJson(`${name}.json`, rec);
          setReceived(name);
          break;
        }
      }
    },
  });

  // Push settings to the phone whenever they change or a phone (re)joins.
  const { send } = relay;
  useEffect(() => {
    if (relay.state === "open" && relay.peers.phones > 0)
      send("config", config);
  }, [config, relay.state, relay.peers.phones, send]);

  useEffect(() => {
    const id = setInterval(() => {
      setStale(
        relay.peers.phones > 0 &&
          lastStateAt.current > 0 &&
          performance.now() - lastStateAt.current > STALE_MS,
      );
    }, 250);
    return () => clearInterval(id);
  }, [relay.peers.phones]);

  const noPhone = relay.peers.phones === 0;
  const sensor = noPhone ? "off" : stale ? "stale" : (phone?.sensor ?? "off");
  // Not monitored = not safe: the phone pausing itself, its data going quiet, or the phone
  // dropping off the relay mid-exercise all show as "paused" here.
  const linkLost = phone?.phase === "running" && (stale || noPhone);
  const paused = phone?.phase === "paused" || linkLost;

  return (
    <Screen
      title="Layar terapis"
      subtitle="Prototipe Mode 1: sudut sendi dari sensor HP"
      right={
        <>
          <RelayPill state={relay.state} />
          <SensorPill status={sensor} />
          {phone && !noPhone && <PhasePill phase={phone.phase} />}
          <RoomCodeDisplay code={relay.roomId} />
        </>
      }
    >
      <div className="sticky top-2 z-10 space-y-2 empty:hidden">
        <AnimatePresence>
          {paused && (
            <Alert
              key="paused"
              tone="danger"
              big
              title="Latihan dijeda: sensor tidak terpantau"
            >
              {noPhone
                ? "HP terputus dari server."
                : stale
                  ? "Data dari HP berhenti masuk (jaringan atau HP tidur)."
                  : "HP melaporkan sensor terputus."}
            </Alert>
          )}
          {received && (
            <Alert key="rec" tone="success" title="Rekaman diterima dari HP">
              Disimpan sebagai {received} dan diunduh.
            </Alert>
          )}
        </AnimatePresence>
      </div>

      {noPhone && relay.state === "open" && (
        <PairingCard code={relay.roomId} path="/phone" minimizable />
      )}
      {!noPhone && info && (
        <PhoneCard
          label={info.deviceLabel}
          hz={phone?.rate.hz ?? null}
          battery={phone?.extras.battery ?? null}
          sessions={sessions.filter((x) => x.deviceId === info.deviceId).length}
          stale={stale}
        />
      )}

      <Tabs<Tab>
        items={[
          { id: "live", label: "Live", icon: LineChart },
          { id: "history", label: "Riwayat", icon: History },
          { id: "validate", label: "Validasi", icon: Ruler },
          { id: "raw", label: "Data Awal", icon: Activity },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "live" && therapist === false && <LocalModeNotice />}

      {tab === "live" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <Card>
              <div className="grid items-center gap-4 sm:grid-cols-[minmax(180px,240px)_1fr]">
                <AngleGauge
                  angleDeg={phone ? phone.angleDeg : null}
                  limitDeg={config.envelope.maxAngleDeg}
                  over={!!phone && phone.angleDeg > config.envelope.maxAngleDeg}
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Stat label="Repetisi" value={phone?.reps ?? "–"} size="xl" />
                  <Stat
                    label="Kecepatan"
                    value={phone ? phone.velDegS.toFixed(0) : "–"}
                    unit="°/s"
                    size="xl"
                  />
                  <Stat
                    label="Sudut maks"
                    value={phone ? phone.maxAngleDeg.toFixed(0) : "–"}
                    unit="°"
                    size="xl"
                  />
                </div>
              </div>
            </Card>
            <Card title="Sudut, 10 detik terakhir" icon={Gauge}>
              <LiveChart
                points={points}
                limit={config.envelope.maxAngleDeg}
                label="Grafik sudut 10 detik terakhir"
              />
              <p className="mt-2 text-sm text-muted">
                Garis putus-putus merah = sudut maksimum yang diatur (contoh).
              </p>
            </Card>
            <Card title="Kejadian melewati batas">
              {breaches.length === 0 ? (
                <p className="text-base text-muted">Belum ada.</p>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {breaches.map((b) => (
                      <Alert
                        key={`${b.kind}-${b.t}`}
                        tone="danger"
                        title={`Melewati batas yang diatur terapis: ${b.kind === "angle" ? "sudut" : "kecepatan"}`}
                      >
                        {b.value.toFixed(0)}
                        {b.kind === "angle" ? "°" : "°/s"} (batas {b.limit}),
                        bertahan {b.heldMs.toFixed(0)} ms
                      </Alert>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </Card>
          </div>
          <EnvelopeCard config={config} onChange={setConfig} />
        </div>
      )}

      {tab === "history" && <ServerHistory onTherapist={setTherapist} />}

      {tab === "history" && (
        <SessionHistory
          sessions={sessions}
          side="screen"
          onChange={(x) => {
            getDb()
              .sessions.put(x)
              .catch(() => {});
          }}
          onDelete={(id) => {
            getDb()
              .sessions.delete(id)
              .catch(() => {});
          }}
          onImport={(list) => {
            storeSessions(list).catch(() => {});
          }}
        />
      )}

      {tab === "validate" && (
        <ValidationPanel
          readApp={() => (phone?.phase === "running" ? latest.current : null)}
          exercise={config.exercise}
          device={info?.userAgent ?? "unknown"}
        />
      )}

      {tab === "raw" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="space-y-5 lg:col-span-2">
            <LiveMultiChart
              points={accel}
              title="Akselerasi termasuk gravitasi"
              unit="m/s²"
              minRange={12}
            />
            <LiveMultiChart
              points={gyro}
              title="Kecepatan putar (giroskop)"
              unit="°/s"
              minRange={30}
            />
            <LiveMultiChart
              points={linear}
              title="Akselerasi tanpa gravitasi"
              unit="m/s²"
              minRange={2}
            />
            <p className="text-xs text-muted">
              Sumbu mengikuti HP (x kanan, y atas, z keluar layar). Hanya sudut
              dan kecepatan putar yang dipakai untuk batas. Akselerasi tidak
              diintegrasi menjadi jarak (drift).
            </p>
          </Card>
          <RawSampleCard
            sample={phone?.latest ?? null}
            rate={phone?.rate ?? { hz: 0, dtMedianMs: 0, dtMaxMs: 0 }}
            reportedIntervalMs={phone?.reportedIntervalMs ?? null}
            extra={[
              ["Sudut maks", phone ? `${phone.maxAngleDeg.toFixed(0)}°` : "–"],
              [
                "Sumber",
                phone?.source === "replay" ? "Rekaman (replay)" : "Sensor HP",
              ],
              ["Tanda gyro (dipelajari)", String(phone?.gyroSign ?? "–")],
              [
                "Suara Indonesia di HP",
                info ? (info.hasIndonesianVoice ? "ada" : "tidak ada") : "–",
              ],
              ["Perangkat", info?.userAgent ?? "–"],
              ...(phone ? extrasRows(phone.extras, phone.lostPackets) : []),
            ]}
          />
          <Card title="Sensor yang tersedia di HP" icon={Cpu}>
            <CapabilityList items={info?.capabilities ?? []} />
          </Card>
          <RecordingsCard />
        </div>
      )}
    </Screen>
  );
}
