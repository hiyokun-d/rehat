"use client";
// /phone — works on its own (phone-only) or paired with a screen (laptop or another phone).
// Home: who holds the phone, "Mulai", pairing (QR or code), history, sensors on this phone.
// Session: calibrate, exercise, get cues. All safety logic runs here (edge), see usePhoneSession.
// History: every finished session is saved on this phone (works offline) and synced to a paired
// screen; it can also be shared as a file. See SessionHistory and docs/NOTES.md.
import {
  Bluetooth,
  CloudCheck,
  Cpu,
  Crosshair,
  FlaskConical,
  History,
  Link2Off,
  MonitorSmartphone,
  Play,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Square,
  VolumeX,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { PhasePill, RelayPill, SensorPill } from "@/components/ConnectionPills";
import { LiveChart } from "@/components/LiveChart";
import { QrScanner } from "@/components/QrScanner";
import { AngleGauge } from "@/components/rehab/AngleGauge";
import { CapabilityList } from "@/components/rehab/CapabilityList";
import { EnvelopeCard } from "@/components/rehab/EnvelopeCard";
import { extrasRows } from "@/components/rehab/extrasRows";
import { RawSampleCard } from "@/components/rehab/RawSampleCard";
import { RecordingsCard } from "@/components/rehab/RecordingsCard";
import { SessionHistory } from "@/components/rehab/SessionHistory";
import { Alert } from "@/components/ui/Alert";
import { ExampleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeInput } from "@/components/ui/CodeInput";
import { Disclosure } from "@/components/ui/Disclosure";
import { Screen } from "@/components/ui/Screen";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { usePhoneSession } from "@/hooks/usePhoneSession";
import { useRelay } from "@/hooks/useRelay";
import { useSessions } from "@/hooks/useSessions";
import { useWakeLock } from "@/hooks/useWakeLock";
import { getDb } from "@/lib/db";
import { type DeviceIdentity, getDeviceIdentity } from "@/lib/device";
import { EXERCISES } from "@/lib/rehab/defaults";
import type { PhoneInfo, ScreenPayloads } from "@/lib/rehab/messages";
import type { SessionConfig } from "@/lib/rehab/session";
import type { Reporter, SessionSummary } from "@/lib/rehab/summary";
import { BleSource } from "@/lib/sensor/bleSource";
import {
  type Capability,
  DeviceExtrasReader,
  detectCapabilities,
} from "@/lib/sensor/deviceExtras";
import { PhoneSource } from "@/lib/sensor/phoneSource";
import type { Recording } from "@/lib/sensor/recording";
import { ReplaySource } from "@/lib/sensor/replaySource";
import { syntheticFlexion } from "@/lib/sensor/synthetic";
import { indonesianVoice, unlockSpeech, waitForVoices } from "@/lib/speech";

type Problem = "insecure" | "denied" | "unsupported" | "ble" | null;
const CONFIG_KEY = "phone-config";
const REPORTER_KEY = "reporter";
/** Sessions per relay message: keeps each message well under ~200 KB. */
const SYNC_CHUNK = 10;

export function PhoneApp() {
  const [code, setCode] = useState("");
  const [fromQr, setFromQr] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<"main" | "history">("main");
  const [problem, setProblem] = useState<Problem>(null);
  const [noVoice, setNoVoice] = useState(false);
  const [device, setDevice] = useState<DeviceIdentity | null>(null);
  const [reporter, setReporter] = useState<Reporter>("patient");
  const [caps, setCaps] = useState<Capability[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const sessions = useSessions();
  const paired = code.length === 4;
  // From feature detection after mount (not during render: the server render has no window).
  const canScan = caps.some((c) => c.id === "qr" && c.status === "yes");
  const canBle = caps.some((c) => c.id === "bluetooth" && c.status === "yes");

  // Pairing no longer waits for Mulai: a paired phone can sync its history before exercising.
  const relay = useRelay({
    role: "phone",
    roomId: code,
    enabled: paired,
    onMessage: (m) => {
      if (m.type === "config")
        s.setConfig(m.payload as ScreenPayloads["config"]);
      if (m.type === "sync-request") {
        const { deviceId, have } = m.payload as ScreenPayloads["sync-request"];
        if (deviceId !== device?.id) return;
        const known = new Set(have);
        sendSessions(sessions.filter((x) => !known.has(x.id) || !x.syncedAt));
      }
      if (m.type === "sessions-ack") {
        const at = new Date().toISOString();
        const { ids } = m.payload as ScreenPayloads["sessions-ack"];
        getDb()
          .sessions.where("id")
          .anyOf(ids)
          .modify({ syncedAt: at })
          .catch(() => {});
      }
    },
  });
  const linked = relay.state === "open" && relay.peers.screens > 0;
  const { send } = relay;

  const sendSessions = useCallback(
    (list: SessionSummary[]) => {
      for (let i = 0; i < list.length; i += SYNC_CHUNK)
        send("sessions", {
          sessions: list
            .slice(i, i + SYNC_CHUNK)
            .map(({ syncedAt: _, ...rest }) => rest),
        });
    },
    [send],
  );

  // Every finished session is stored first, then sent: losing Wi-Fi never loses a session.
  const saveSession = useCallback(
    (x: SessionSummary) => {
      const row = { ...x, syncedAt: undefined };
      getDb()
        .sessions.put(row)
        .catch(() => {});
      sendSessions([row]);
    },
    [sendSessions],
  );

  const s = usePhoneSession({
    send,
    reporter,
    device,
    onSessionEnd: (x) => {
      saveSession(x);
      setLastSaved(x.id);
    },
  });
  useWakeLock(started);
  // A connected screen owns the settings; otherwise the phone sets them itself.
  const screenOwnsConfig = linked;

  useEffect(() => {
    if (!window.isSecureContext) setProblem("insecure");
    setCaps(detectCapabilities());
    // Opened from the QR on a screen: /phone?room=1234 pre-fills the code.
    // The user still taps Mulai, because iOS only grants motion access from a tap.
    const room = new URLSearchParams(location.search).get("room");
    if (room && /^\d{4}$/.test(room)) {
      setCode(room);
      setFromQr(true);
    }
    getDeviceIdentity()
      .then(setDevice)
      .catch(() => {});
    getDb()
      .settings.get(REPORTER_KEY)
      .then((r) => r && setReporter(r.value as Reporter))
      .catch(() => {});
  }, []);

  // Introduce ourselves on every (re)join; the screen answers with config + a sync request.
  useEffect(() => {
    if (relay.state !== "open" || !device) return;
    send<PhoneInfo>("hello", {
      userAgent: navigator.userAgent,
      hasIndonesianVoice: !noVoice,
      deviceId: device.id,
      deviceLabel: device.label,
      capabilities: caps,
    });
  }, [relay.state, device, noVoice, caps, send]);

  // Phone-only mode remembers the last limits on this device.
  const { setConfig } = s;
  useEffect(() => {
    getDb()
      .settings.get(CONFIG_KEY)
      .then((row) => row && setConfig(row.value as SessionConfig))
      .catch(() => {});
  }, [setConfig]);

  const changeConfig = (c: SessionConfig) => {
    s.setConfig(c);
    getDb()
      .settings.put({ key: CONFIG_KEY, value: c })
      .catch(() => {});
  };

  const changeReporter = (r: Reporter) => {
    setReporter(r);
    getDb()
      .settings.put({ key: REPORTER_KEY, value: r })
      .catch(() => {});
  };

  const onScanned = useCallback((c: string) => {
    setCode(c);
    setScanning(false);
  }, []);

  const begin = async () => {
    // Order matters on iOS: every permission prompt must START inside this tap, before any
    // other await. So the orientation prompt is started, not awaited, before the motion one.
    unlockSpeech();
    const orient = DeviceExtrasReader.requestPermission();
    const perm = await PhoneSource.requestPermission();
    await orient;
    if (perm !== "granted") return setProblem(perm);
    setStarted(true);
    await s.start(new PhoneSource());
    await waitForVoices();
    setNoVoice(!indonesianVoice());
  };

  const beginBle = async () => {
    unlockSpeech();
    try {
      // requestDevice runs synchronously inside s.start, so it is still inside this tap.
      const p = s.start(new BleSource());
      setStarted(true);
      await p;
    } catch {
      setStarted(false);
      setProblem("ble");
    }
  };

  const replay = async (r: Recording, loop = false) => {
    unlockSpeech();
    setStarted(true);
    await s.start(new ReplaySource(r, { loop }));
  };

  // SYNTHETIC (generated) movement, for trying the app without a sensor. Not a measurement.
  const synthetic = () =>
    replay(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        device: "synthetic",
        samples: syntheticFlexion({ reps: 20, peakDeg: 100, stillMs: 8000 }),
      },
      true,
    );

  const unsynced = sessions.filter((x) => !x.syncedAt).length;
  const historyButton = (
    <Button
      variant="secondary"
      size="xl"
      icon={History}
      onClick={() => setView("history")}
    >
      Riwayat latihan
      <span className="text-base font-medium text-muted">
        {sessions.length} sesi
      </span>
    </Button>
  );

  if (view === "history") {
    return (
      <Screen
        title="Riwayat latihan"
        subtitle="Tersimpan di HP ini. Bisa dilihat tanpa internet."
        narrow
        right={
          <Button variant="secondary" onClick={() => setView("main")}>
            Kembali
          </Button>
        }
      >
        {paired && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CloudCheck size={16} aria-hidden />
            {linked
              ? unsynced
                ? `Mengirim ${unsynced} sesi ke laptop...`
                : "Semua sesi sudah di laptop."
              : "Laptop belum tersambung. Sesi dikirim saat tersambung."}
          </p>
        )}
        <SessionHistory
          sessions={sessions}
          side="phone"
          onChange={saveSession}
          onDelete={(id) => {
            getDb()
              .sessions.delete(id)
              .catch(() => {});
          }}
        />
      </Screen>
    );
  }

  const pairingCard = (
    <Card title="Layar laptop / terapis (opsional)" icon={MonitorSmartphone}>
      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">
              Tersambung, kode {relay.roomId}
            </div>
            <div className="text-sm text-muted">
              {unsynced
                ? `${unsynced} sesi belum terkirim`
                : "Riwayat sudah terkirim ke laptop"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={Link2Off}
            onClick={() => {
              setCode("");
              setFromQr(false);
            }}
          >
            Putuskan
          </Button>
        </div>
      ) : scanning ? (
        <QrScanner onCode={onScanned} onClose={() => setScanning(false)} />
      ) : (
        <div className="space-y-3">
          {canScan && (
            <Button
              variant="secondary"
              size="xl"
              icon={ScanLine}
              onClick={() => setScanning(true)}
            >
              Pindai QR di laptop
            </Button>
          )}
          <CodeInput
            label="Atau ketik kode ruang"
            value={code}
            onChange={setCode}
          />
          {paired && relay.state !== "open" && (
            <p className="text-sm text-muted">Menghubungkan...</p>
          )}
          {relay.error && <p className="text-sm text-danger">{relay.error}</p>}
          {!canScan && (
            <p className="text-sm text-muted">
              iPhone: buka aplikasi Kamera dan arahkan ke QR di laptop.
            </p>
          )}
        </div>
      )}
    </Card>
  );

  if (!started) {
    return (
      <Screen
        title="Rehat"
        subtitle="Latihan dengan HP sebagai sensor"
        narrow
        right={paired && <RelayPill state={relay.state} />}
      >
        {problem === "insecure" && (
          <Alert tone="danger" title="Butuh HTTPS">
            Browser hanya memberi data gerak lewat HTTPS. Buka lewat alamat
            https://, bukan http://.
          </Alert>
        )}
        {problem === "denied" && (
          <Alert tone="danger" title="Izin sensor gerak ditolak">
            iPhone: tutup tab ini, buka lagi, lalu pilih Izinkan. Atau
            Pengaturan, Safari, Akses Gerak & Orientasi.
          </Alert>
        )}
        {problem === "unsupported" && (
          <Alert tone="danger" title="Sensor gerak tidak tersedia">
            Browser ini tidak memberi data gerak. Pakai Chrome (Android) atau
            Safari (iPhone).
          </Alert>
        )}
        {problem === "ble" && (
          <Alert tone="warning" title="Sensor Bluetooth tidak tersambung">
            Perangkat tidak dipilih atau bukan sensor Rehat.
          </Alert>
        )}

        <div>
          <div className="mb-2 text-base font-medium">
            Siapa yang memegang HP?
          </div>
          <Tabs<Reporter>
            items={[
              { id: "patient", label: "Pasien" },
              { id: "caregiver", label: "Pendamping" },
            ]}
            value={reporter}
            onChange={changeReporter}
          />
        </div>

        <Button size="xl" icon={Play} onClick={begin}>
          Mulai latihan
        </Button>
        <p className="text-sm text-muted">
          Meminta izin sensor gerak dan menyalakan suara. Layar tetap menyala
          selama latihan.
        </p>

        {(fromQr || paired || sessions.length === 0) && pairingCard}
        {historyButton}
        {!(fromQr || paired || sessions.length === 0) && pairingCard}

        <Disclosure title="Sensor di HP ini" icon={Cpu}>
          <CapabilityList items={caps} />
        </Disclosure>

        <Disclosure title="Coba tanpa sensor HP" icon={FlaskConical}>
          <Button
            variant="secondary"
            icon={FlaskConical}
            onClick={synthetic}
            className="w-full"
          >
            Data sintetis (bukan pengukuran)
          </Button>
          {canBle && (
            <div className="space-y-1">
              <Button
                variant="secondary"
                icon={Bluetooth}
                onClick={beginBle}
                className="w-full"
              >
                Sensor Bluetooth (eksperimen)
              </Button>
              <p className="text-xs text-muted">
                Untuk sensor ESP32 Tier 1 (belum ada firmware). Tidak bisa di
                iPhone.
              </p>
            </div>
          )}
          <RecordingsCard onReplay={(r) => replay(r)} />
        </Disclosure>
      </Screen>
    );
  }

  const ex = EXERCISES[s.config.exercise];
  const { phase } = s.snap;
  const live = phase === "running" || phase === "paused";
  const breach = s.lastBreach;
  const saved = lastSaved ? sessions.find((x) => x.id === lastSaved) : null;
  const ext = s.snap.extras;

  return (
    <Screen
      title={ex.name}
      subtitle={
        s.sourceKind === "replay"
          ? "Memutar rekaman, bukan sensor langsung"
          : s.sourceKind === "ble"
            ? "Sensor Bluetooth (eksperimen)"
            : undefined
      }
      narrow
      right={
        <>
          <SensorPill status={s.sensor} />
          {paired && <RelayPill state={relay.state} />}
        </>
      }
    >
      {relay.error && (
        <Alert tone="warning" title="Layar">
          {relay.error}
        </Alert>
      )}
      {noVoice && (
        <Alert
          tone="warning"
          title="Suara bahasa Indonesia tidak ada"
          icon={VolumeX}
        >
          Peringatan memakai suara bawaan. Android: pasang data suara Indonesia
          di pengaturan Text-to-speech.
        </Alert>
      )}

      <Card>
        <div className="mb-1 flex items-center justify-between">
          <PhasePill phase={phase} />
          <span className="text-sm text-muted tabular-nums">
            {s.rate.hz.toFixed(0)} Hz
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <AngleGauge
            angleDeg={live ? s.snap.angleDeg : null}
            limitDeg={s.config.envelope.maxAngleDeg}
            over={!!breach || s.snap.angleDeg > s.config.envelope.maxAngleDeg}
          />
          <div className="pb-3">
            <Stat label="Repetisi" value={s.snap.reps} size="xl" />
          </div>
        </div>
        {live && (
          <div className="mt-2">
            <LiveChart
              points={s.points}
              limit={s.config.envelope.maxAngleDeg}
              height={110}
              label="Grafik sudut 10 detik terakhir"
            />
          </div>
        )}
      </Card>

      <AnimatePresence>
        {breach && (
          <Alert
            key={`b-${breach.t}`}
            tone="danger"
            big
            title="Melewati batas yang diatur terapis"
          >
            {breach.kind === "angle" ? "Sudut" : "Kecepatan"}{" "}
            {breach.value.toFixed(0)}
            {breach.kind === "angle" ? "°" : "°/s"} (batas {breach.limit}).
            Pelan-pelan.
          </Alert>
        )}
        {s.calibration && !s.calibration.ok && phase === "idle" && (
          <Alert key="calib-fail" tone="warning" title="Kalibrasi gagal">
            {s.calibration.reason === "moved"
              ? `Dalam 10 detik tidak ada 3 detik yang cukup tenang (goyang ${s.calibration.spreadDeg.toFixed(1)}°). Sandarkan lengan lalu ulangi.`
              : "Data sensor terlalu sedikit. Ulangi."}
          </Alert>
        )}
      </AnimatePresence>

      {phase === "idle" && saved && (
        <Alert tone="success" title="Sesi tersimpan di HP ini">
          {saved.reps} repetisi, sudut puncak {saved.maxAngleDeg.toFixed(0)}°.{" "}
          {saved.syncedAt
            ? "Sudah terkirim ke laptop."
            : linked
              ? "Mengirim ke laptop..."
              : "Akan dikirim saat laptop tersambung."}
        </Alert>
      )}

      {phase === "idle" && (
        <>
          <p className="text-base">{ex.placement}</p>
          <Button
            size="xl"
            icon={Crosshair}
            onClick={s.calibrate}
            disabled={s.sensor !== "ok"}
          >
            Kalibrasi (diam 3 detik)
          </Button>
          {historyButton}
        </>
      )}
      {phase === "calibrating" && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-xl font-semibold">Tahan di posisi awal...</p>
          <p className="text-sm text-muted">
            Goyang sedikit tidak apa-apa. Bila lengan bergerak jelas, bar mulai
            lagi dari awal.
          </p>
          <div className="h-4 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full bg-primary"
              animate={{ width: `${s.snap.calibrationProgress * 100}%` }}
            />
          </div>
        </div>
      )}
      {phase === "running" && (
        <Button size="xl" variant="secondary" icon={Square} onClick={s.stop}>
          Selesai dan simpan
        </Button>
      )}
      {phase === "paused" && (
        <>
          <Alert tone="danger" big title="Sensor terputus, latihan dijeda">
            Tidak terpantau berarti tidak aman. Pastikan layar menyala dan
            halaman ini terbuka, lalu lanjutkan.
          </Alert>
          <Button
            size="xl"
            icon={RotateCcw}
            onClick={s.resume}
            disabled={s.sensor !== "ok"}
          >
            Lanjutkan
          </Button>
          <Button size="xl" variant="secondary" icon={Square} onClick={s.stop}>
            Selesai dan simpan
          </Button>
        </>
      )}

      {phase === "idle" && !linked && pairingCard}

      {screenOwnsConfig ? (
        <Card title="Batas dari layar terapis" icon={ShieldAlert}>
          <p className="text-base tabular-nums">
            Sudut maks {s.config.envelope.maxAngleDeg}° · kecepatan maks{" "}
            {s.config.envelope.maxVelDegPerS}°/s
          </p>
          <div className="mt-2">
            <ExampleBadge />
          </div>
        </Card>
      ) : (
        phase !== "calibrating" && (
          <Disclosure
            title="Latihan & batas (isi sesuai arahan terapis)"
            icon={ShieldAlert}
          >
            <EnvelopeCard config={s.config} onChange={changeConfig} />
          </Disclosure>
        )
      )}

      <Disclosure title="Detail teknis" icon={Wrench}>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Sudut maks"
            value={s.snap.maxAngleDeg.toFixed(0)}
            unit="°"
          />
          <Stat
            label="Kecepatan"
            value={s.snap.velDegS.toFixed(0)}
            unit="°/s"
          />
        </div>
        <RawSampleCard
          sample={s.latest}
          rate={s.rate}
          reportedIntervalMs={s.snap.reportedIntervalMs}
          extra={[
            ["Tanda gyro (dipelajari)", String(s.snap.gyroSign)],
            ...extrasRows(ext, s.snap.lostPackets),
          ]}
        />
        <RecordingsCard
          recording={s.recording}
          onStart={s.startRecording}
          onStop={s.stopRecording}
          onSend={
            relay.state === "open"
              ? (r) => relay.send("recording", r)
              : undefined
          }
        />
      </Disclosure>
    </Screen>
  );
}
