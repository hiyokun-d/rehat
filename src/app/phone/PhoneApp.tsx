"use client";
// /phone — works on its own (phone-only) or paired with a screen (laptop or another phone).
// Step 1: tap "Mulai" (permissions + voice unlock); the room code is optional.
// Step 2: calibrate, exercise, get cues. All safety logic runs here (edge), see usePhoneSession.
import {
  Crosshair,
  FlaskConical,
  MonitorSmartphone,
  OctagonX,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  VolumeX,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { PhasePill, RelayPill, SensorPill } from "@/components/ConnectionPills";
import { LiveChart } from "@/components/LiveChart";
import { EnvelopeCard } from "@/components/rehab/EnvelopeCard";
import { RawSampleCard } from "@/components/rehab/RawSampleCard";
import { RecordingsCard } from "@/components/rehab/RecordingsCard";
import { Alert } from "@/components/ui/Alert";
import { ExampleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeInput } from "@/components/ui/CodeInput";
import { Disclosure } from "@/components/ui/Disclosure";
import { Screen } from "@/components/ui/Screen";
import { Stat } from "@/components/ui/Stat";
import { usePhoneSession } from "@/hooks/usePhoneSession";
import { useRelay } from "@/hooks/useRelay";
import { useWakeLock } from "@/hooks/useWakeLock";
import { getDb } from "@/lib/db";
import { CUES } from "@/lib/rehab/cues";
import { EXERCISES } from "@/lib/rehab/defaults";
import type { ScreenPayloads } from "@/lib/rehab/messages";
import type { SessionConfig } from "@/lib/rehab/session";
import { PhoneSource } from "@/lib/sensor/phoneSource";
import type { Recording } from "@/lib/sensor/recording";
import { ReplaySource } from "@/lib/sensor/replaySource";
import { syntheticFlexion } from "@/lib/sensor/synthetic";
import { indonesianVoice, unlockSpeech, waitForVoices } from "@/lib/speech";

type Problem = "insecure" | "denied" | "unsupported" | null;
const CONFIG_KEY = "phone-config";

export function PhoneApp() {
  const [code, setCode] = useState("");
  const [fromQr, setFromQr] = useState(false);
  const [started, setStarted] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [noVoice, setNoVoice] = useState(false);
  const [stoppedSick, setStoppedSick] = useState(false);
  const paired = code.length === 4;

  const relay = useRelay({
    role: "phone",
    roomId: code,
    enabled: started && paired,
    onMessage: (m) => {
      if (m.type === "config")
        s.setConfig(m.payload as ScreenPayloads["config"]);
      if (m.type === "joined")
        relay.send("hello", {
          userAgent: navigator.userAgent,
          hasIndonesianVoice: !noVoice,
        });
    },
  });
  const s = usePhoneSession(relay.send);
  useWakeLock(started);
  // A connected screen owns the settings; otherwise the phone sets them itself.
  const screenOwnsConfig = relay.state === "open" && relay.peers.screens > 0;

  useEffect(() => {
    if (!window.isSecureContext) setProblem("insecure");
    // Opened from the QR on a screen: /phone?room=1234 pre-fills the code.
    // The user still taps Mulai, because iOS only grants motion access from a tap.
    const room = new URLSearchParams(location.search).get("room");
    if (room && /^\d{4}$/.test(room)) {
      setCode(room);
      setFromQr(true);
    }
  }, []);

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

  const begin = async () => {
    // Order matters on iOS: both calls must happen inside this tap, before any other await.
    unlockSpeech();
    const perm = await PhoneSource.requestPermission();
    if (perm !== "granted") return setProblem(perm);
    setStarted(true);
    await s.start(new PhoneSource());
    await waitForVoices();
    setNoVoice(!indonesianVoice());
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

  if (!started) {
    return (
      <Screen title="Rehat" subtitle="Latihan dengan HP sebagai sensor" narrow>
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

        <Button size="xl" icon={Play} onClick={begin}>
          Mulai
        </Button>
        <p className="text-base text-muted">
          HP akan meminta izin sensor gerak. Layar tetap menyala selama latihan.
        </p>
        {paired && (
          <p className="text-base font-medium">Terhubung ke layar terapis.</p>
        )}

        <Disclosure
          title="Hubungkan ke layar terapis"
          icon={MonitorSmartphone}
          defaultOpen={!fromQr && paired}
        >
          <CodeInput
            label="Kode ruang dari layar"
            value={code}
            onChange={setCode}
          />
          <p className="text-base text-muted">
            Kosongkan untuk latihan hanya dengan HP ini.
          </p>
        </Disclosure>

        <Disclosure title="Latihan percobaan" icon={FlaskConical}>
          <Button
            variant="secondary"
            icon={FlaskConical}
            onClick={synthetic}
            className="w-full"
          >
            Data sintetis (bukan pengukuran)
          </Button>
          <RecordingsCard onReplay={(r) => replay(r)} />
        </Disclosure>
      </Screen>
    );
  }

  const ex = EXERCISES[s.config.exercise];
  const { phase } = s.snap;
  const live = phase === "running" || phase === "paused";
  const breach = s.lastBreach;
  const limitLabel = screenOwnsConfig ? "Batas dari terapis" : "Batas";
  const calibrate = () => {
    setStoppedSick(false);
    s.calibrate();
  };
  const stopSick = () => {
    s.stop();
    setStoppedSick(true);
  };
  return (
    <Screen
      title={ex.name}
      subtitle={
        s.sourceKind === "replay"
          ? "Memutar rekaman, bukan sensor langsung"
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
        <div className="mb-3">
          <PhasePill phase={phase} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <Stat
            label="Sudut"
            value={live ? s.snap.angleDeg.toFixed(0) : "–"}
            unit="°"
            size="xl"
            tone={breach ? "danger" : "default"}
          />
          <Stat label="Repetisi" value={s.snap.reps} size="xl" />
        </div>
        {live && (
          <p className="mt-3 text-lg font-medium tabular-nums">
            {limitLabel} {s.config.envelope.maxAngleDeg}°
          </p>
        )}
      </Card>

      <div className="sticky top-2 z-10 space-y-2 empty:hidden">
        <AnimatePresence>
          {breach && (
            <Alert
              key={`b-${breach.t}`}
              tone="danger"
              big
              title={CUES[breach.kind]}
            >
              {breach.kind === "angle" ? "Sudut" : "Kecepatan"}{" "}
              {breach.value.toFixed(0)}
              {breach.kind === "angle" ? "°" : "°/s"} melewati batas{" "}
              {breach.limit}
              {breach.kind === "angle" ? "°" : "°/s"} yang diatur.
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
      </div>

      {phase === "idle" && (
        <>
          {stoppedSick && (
            <Alert tone="info" title="Latihan dihentikan">
              Beri tahu pendamping atau terapis kamu.
            </Alert>
          )}
          <p className="text-lg">{ex.placement}</p>
          <Button
            size="xl"
            icon={Crosshair}
            onClick={calibrate}
            disabled={s.sensor !== "ok"}
          >
            Kalibrasi (diam 3 detik)
          </Button>
        </>
      )}
      {phase === "calibrating" && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-xl font-semibold">Tahan di posisi awal...</p>
          <p className="text-base text-muted">
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
        <>
          <Button size="xl" variant="secondary" icon={Square} onClick={s.stop}>
            Selesai
          </Button>
          <Button size="xl" variant="danger" icon={OctagonX} onClick={stopSick}>
            Berhenti, saya sakit
          </Button>
        </>
      )}
      {phase === "paused" && (
        <>
          <div className="sticky top-2 z-10">
            <Alert tone="danger" big title="Sensor terputus, latihan dijeda">
              Tidak terpantau berarti tidak aman. Pastikan layar menyala dan
              halaman ini terbuka, lalu lanjutkan.
            </Alert>
          </div>
          <Button
            size="xl"
            icon={RotateCcw}
            onClick={s.resume}
            disabled={s.sensor !== "ok"}
          >
            Lanjutkan
          </Button>
          <Button size="xl" variant="danger" icon={OctagonX} onClick={stopSick}>
            Berhenti, saya sakit
          </Button>
        </>
      )}

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
          <Disclosure title="Atur latihan & batas" icon={ShieldAlert}>
            <EnvelopeCard config={s.config} onChange={changeConfig} />
          </Disclosure>
        )
      )}

      <Disclosure title="Detail teknis" icon={Wrench}>
        {live && (
          <LiveChart
            points={s.points}
            limit={s.config.envelope.maxAngleDeg}
            height={120}
            label="Grafik sudut 10 detik terakhir"
          />
        )}
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
          extra={[["Tanda gyro (dipelajari)", String(s.snap.gyroSign)]]}
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
