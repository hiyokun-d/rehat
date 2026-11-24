"use client";
// /screen — the laptop. Shows the room code, live data from the phone, and the therapist-side
// settings. It never decides anything about safety: the phone does, the screen displays.
import {
  Activity,
  Gauge,
  Hand,
  HandHelping,
  LineChart,
  Ruler,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AslApp } from "@/app/gesture/AslApp";
import { PhasePill, RelayPill, SensorPill } from "@/components/ConnectionPills";
import { CandidatesList } from "@/components/gesture/CandidatesList";
import { DeskCamera, useDeskImu } from "@/components/gesture/DeskCamera";
import { GestureStatePill } from "@/components/gesture/GestureStatePill";
import { SubtitleBar } from "@/components/gesture/SubtitleBar";
import { type ChartPoint, LiveChart } from "@/components/LiveChart";
import { PairingCard, RoomCodeDisplay } from "@/components/RoomCodeDisplay";
import { EnvelopeCard } from "@/components/rehab/EnvelopeCard";
import { RawSampleCard } from "@/components/rehab/RawSampleCard";
import { RecordingsCard } from "@/components/rehab/RecordingsCard";
import { ValidationPanel } from "@/components/rehab/ValidationPanel";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { useRelay } from "@/hooks/useRelay";
import { useSubtitle } from "@/hooks/useSubtitle";
import { getDb } from "@/lib/db";
import type {
  GestureImuMsg,
  GestureResultMsg,
  GestureStatusMsg,
} from "@/lib/gesture/messages";
import type { BreachEvent } from "@/lib/rehab/envelope";
import type {
  PhoneInfo,
  PhonePayloads,
  PhoneState,
  TelemetryPoint,
} from "@/lib/rehab/messages";
import { DEFAULT_CONFIG, type SessionConfig } from "@/lib/rehab/session";
import { downloadJson, stamp } from "@/lib/sensor/recording";

type Tab = "live" | "validate" | "raw" | "gesture" | "asl";
const ROOM_KEY = "rehat-room";
/** No state message from a connected phone for this long = we are not seeing it any more. */
const STALE_MS = 1500;
const CHART_KEEP_MS = 12_000;

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
  const [gStatus, setGStatus] = useState<GestureStatusMsg | null>(null);
  const [gResult, setGResult] = useState<
    (GestureResultMsg & { receivedAt: number }) | null
  >(null);
  const subtitle = useSubtitle();
  const deskImu = useDeskImu();
  const points = useRef<ChartPoint[]>([]);
  const latest = useRef<TelemetryPoint | null>(null);
  const lastStateAt = useRef(0);

  // sessionStorage: a reload of this tab keeps the same room code, so the phone stays paired.
  useEffect(() => {
    try {
      setSavedRoom(sessionStorage.getItem(ROOM_KEY));
    } catch {}
    setReady(true);
  }, []);

  const relay = useRelay({
    role: "screen",
    roomId: savedRoom,
    enabled: ready,
    onMessage: (m) => {
      const p = m.payload;
      switch (m.type) {
        case "joined":
          try {
            sessionStorage.setItem(ROOM_KEY, m.roomId);
          } catch {}
          break;
        case "hello":
          setInfo(p as PhoneInfo);
          relay.send("config", config);
          break;
        case "state":
          lastStateAt.current = performance.now();
          setPhone(p as PhoneState);
          break;
        case "telemetry":
          for (const pt of (p as PhonePayloads["telemetry"]).points) {
            points.current.push({ t: pt.t, v: pt.angleDeg });
            latest.current = pt;
          }
          if (points.current.length > 0) {
            const cutoff =
              points.current[points.current.length - 1].t - CHART_KEEP_MS;
            while (points.current.length && points.current[0].t < cutoff)
              points.current.shift();
          }
          break;
        case "breach":
          setBreaches((b) => [p as BreachEvent, ...b].slice(0, 8));
          break;
        case "g-imu":
          deskImu.push(p as GestureImuMsg);
          break;
        case "g-status":
          setGStatus(p as GestureStatusMsg);
          break;
        case "g-result": {
          const r = p as GestureResultMsg;
          setGResult({ ...r, receivedAt: Date.now() });
          if (r.word) subtitle.add(r.word);
          break;
        }
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
  const lastBreach = breaches[0];

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

      {noPhone && relay.state === "open" && tab !== "asl" && (
        <PairingCard
          code={relay.roomId}
          path={tab === "gesture" ? "/gesture" : "/phone"}
        />
      )}

      <Tabs<Tab>
        items={[
          { id: "live", label: "Live", icon: LineChart },
          { id: "validate", label: "Validasi", icon: Ruler },
          { id: "raw", label: "Data mentah", icon: Activity },
          { id: "gesture", label: "Mode 2: Gestur", icon: Hand },
          { id: "asl", label: "ASL siap pakai", icon: HandHelping },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Laptop camera + pretrained ASL, full width. Its own room/QR for a mirroring phone. */}
      {tab === "asl" && <AslApp embedded />}

      {tab === "live" && (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <Card>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="Sudut"
                  value={phone ? phone.angleDeg.toFixed(0) : "–"}
                  unit="°"
                  tone={
                    lastBreach &&
                    phone &&
                    phone.angleDeg > config.envelope.maxAngleDeg
                      ? "danger"
                      : "default"
                  }
                />
                <Stat label="Repetisi" value={phone?.reps ?? "–"} />
                <Stat
                  label="Sudut maks"
                  value={phone ? phone.maxAngleDeg.toFixed(0) : "–"}
                  unit="°"
                />
                <Stat
                  label="Laju sampel"
                  value={phone ? phone.rate.hz.toFixed(0) : "–"}
                  unit="Hz"
                />
              </div>
            </Card>
            <Card title="Sudut, 10 detik terakhir" icon={Gauge}>
              <LiveChart
                points={points}
                limit={config.envelope.maxAngleDeg}
                label="Grafik sudut 10 detik terakhir"
              />
              <p className="mt-2 text-xs text-muted">
                Garis putus-putus merah = sudut maksimum yang diatur (contoh).
              </p>
            </Card>
            <Card title="Kejadian melewati batas">
              {breaches.length === 0 ? (
                <p className="text-sm text-muted">Belum ada.</p>
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

      {tab === "validate" && (
        <ValidationPanel
          readApp={() => (phone?.phase === "running" ? latest.current : null)}
          exercise={config.exercise}
          device={info?.userAgent ?? "unknown"}
        />
      )}

      {tab === "gesture" && (
        <div className="space-y-4">
          <Alert
            tone="warning"
            title="Eksperimen, bukan penerjemah bahasa isyarat"
          >
            Kata berasal dari gerakan uji yang direkam tim sendiri, bukan
            isyarat BISINDO.
          </Alert>
          <SubtitleBar
            words={subtitle.words}
            pending={gStatus?.state === "signing"}
            size="xl"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Status HP">
              <div className="space-y-2">
                {gStatus ? (
                  <GestureStatePill state={gStatus.state} />
                ) : (
                  <p className="text-sm text-muted">
                    Belum ada HP di /gesture.
                  </p>
                )}
                {gStatus && (
                  <p className="text-sm text-muted tabular-nums">
                    {gStatus.fps} FPS ({gStatus.delegate ?? "-"}) ·{" "}
                    {gStatus.phase}
                  </p>
                )}
              </div>
            </Card>
            <Card title="Hasil terakhir (3 teratas, jarak DTW)">
              {gResult && (
                <p className="mb-2 text-sm">
                  {gResult.word
                    ? `"${gResult.word}"`
                    : `Tidak dikenali (${gResult.reason})`}{" "}
                  · {gResult.latencyMs.toFixed(0)} ms di HP
                </p>
              )}
              <CandidatesList candidates={gResult?.candidates ?? []} />
              <p className="mt-2 text-xs text-muted">
                Latensi diukur di HP (akhir gerakan sampai hasil). Jeda jaringan
                tidak diukur: jam HP dan laptop tidak sinkron.
              </p>
            </Card>
          </div>
          <Card title="Eksperimen: kamera laptop + posisi HP" icon={Hand}>
            <DeskCamera gyro={deskImu.gyro} />
          </Card>
        </div>
      )}

      {tab === "raw" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RawSampleCard
            sample={phone?.latest ?? null}
            rate={phone?.rate ?? { hz: 0, dtMedianMs: 0, dtMaxMs: 0 }}
            reportedIntervalMs={phone?.reportedIntervalMs ?? null}
            extra={[
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
            ]}
          />
          <RecordingsCard />
        </div>
      )}
    </Screen>
  );
}
