"use client";
// /gesture — Mode 2 (EXPERIMENTAL). Front camera sees the free hand, the phone IMU sees the
// holding hand. Segments are classified against the user's OWN recorded templates.
// This is NOT a sign-language translator.
import {
  Camera,
  FlaskConical,
  GraduationCap,
  Hand,
  MonitorSmartphone,
  Play,
  Settings2,
  Timer,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RelayPill, SensorPill } from "@/components/ConnectionPills";
import { CandidatesList } from "@/components/gesture/CandidatesList";
import { GestureStatePill } from "@/components/gesture/GestureStatePill";
import {
  HandOverlay,
  type HandOverlayHandle,
} from "@/components/gesture/HandOverlay";
import { SubtitleBar } from "@/components/gesture/SubtitleBar";
import { TestPanel } from "@/components/gesture/TestPanel";
import { TrainPanel } from "@/components/gesture/TrainPanel";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeInput } from "@/components/ui/CodeInput";
import { Disclosure } from "@/components/ui/Disclosure";
import { Screen } from "@/components/ui/Screen";
import { Slider } from "@/components/ui/Slider";
import { Tabs } from "@/components/ui/Tabs";
import { useCamera } from "@/hooks/useCamera";
import {
  type SegmentReady,
  useGestureSession,
} from "@/hooks/useGestureSession";
import { type HandFrame, useHandTracker } from "@/hooks/useHandTracker";
import { useRelay } from "@/hooks/useRelay";
import { useSubtitle } from "@/hooks/useSubtitle";
import { useWakeLock } from "@/hooks/useWakeLock";
import { type GestureTestRow, getDb, USER_NAME_KEY } from "@/lib/db";
import {
  type ClassifyResult,
  classify,
  classifyPartial,
  DEFAULT_CLASSIFY,
  EarlyDecider,
  type Template,
} from "@/lib/gesture/classifier";
import { resample } from "@/lib/gesture/dtw";
import { explainResult } from "@/lib/gesture/explain";
import type { Frame } from "@/lib/gesture/features";
import {
  type GestureResultMsg,
  type GestureStatusMsg,
  SEED_VOCAB,
} from "@/lib/gesture/messages";
import { DEFAULT_SEGMENTER } from "@/lib/gesture/segmenter";
import { expand, VOCAB_GROUPS } from "@/lib/gesture/vocab";
import { PhoneSource } from "@/lib/sensor/phoneSource";
import { downloadJson, stamp } from "@/lib/sensor/recording";
import type { SensorStatus } from "@/lib/sensor/types";
import {
  indonesianVoice,
  speak,
  unlockSpeech,
  waitForVoices,
} from "@/lib/speech";

type Tab = "recognize" | "train" | "test";
const VOCAB_KEY = "gesture-vocab";
const TEST_N = 10;

export function GestureApp() {
  const [started, setStarted] = useState(false);
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<Tab>("recognize");
  const [propped, setPropped] = useState(false);
  // Early recognition: speak while the hand is still moving (stricter rules, see classifier.ts).
  const [earlyOn, setEarlyOn] = useState(true);
  // Face channel: off by default (extra ~3.6 MB model and lower FPS on phones).
  const [faceOn, setFaceOn] = useState(false);
  const [faceWeight, setFaceWeight] = useState(0.5); // tuned by testing, not from literature
  const early = useRef(new EarlyDecider());
  const segStart = useRef<number | null>(null);
  const [segCfg, setSegCfg] = useState(DEFAULT_SEGMENTER);
  const [clsCfg, setClsCfg] = useState(DEFAULT_CLASSIFY);
  const [vocab, setVocab] = useState<string[]>(SEED_VOCAB);
  const [userName, setUserName] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [trainWord, setTrainWord] = useState<string | null>(null);
  const [result, setResult] = useState<
    (ClassifyResult & { latencyMs: number; handRatio?: number }) | null
  >(null);
  const [imuStatus, setImuStatus] = useState<SensorStatus | "off">("off");
  const [motionDenied, setMotionDenied] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const [test, setTest] = useState<{
    runId: string;
    prompts: string[];
    i: number;
  } | null>(null);
  const [testRows, setTestRows] = useState<GestureTestRow[]>([]);
  const overlay = useRef<HandOverlayHandle>(null);
  const imuSource = useRef<PhoneSource | null>(null);
  const imuBatch = useRef<{ t: number; g: number }[]>([]);
  const subtitle = useSubtitle();

  const relay = useRelay({
    role: "phone",
    roomId: code,
    enabled: started && code.length === 4,
    onMessage: () => {},
  });
  const camera = useCamera();
  useWakeLock(started);

  // Load saved vocabulary and templates from this phone.
  const reloadTemplates = useCallback(
    async () => setTemplates(await getDb().templates.toArray()),
    [],
  );
  useEffect(() => {
    reloadTemplates();
    getDb()
      .settings.get(VOCAB_KEY)
      // Saved list + any new seed words (so an updated seed list shows up for existing users).
      .then(
        (r) =>
          r &&
          setVocab([...new Set([...SEED_VOCAB, ...(r.value as string[])])]),
      )
      .catch(() => {});
    getDb()
      .settings.get(USER_NAME_KEY)
      .then((r) => r && setUserName(r.value as string))
      .catch(() => {});
    const room = new URLSearchParams(location.search).get("room");
    if (room && /^\d{4}$/.test(room)) setCode(room);
  }, [reloadTemplates]);

  const saveVocab = (v: string[]) => {
    setVocab(v);
    getDb()
      .settings.put({ key: VOCAB_KEY, value: v })
      .catch(() => {});
  };

  // Phone on a stand: the IMU carries no gesture information, so it gets no weight.
  const clsWeights = {
    hand: 1,
    imu: propped ? 0 : 1,
    face: faceOn ? faceWeight : 0,
  };

  /** Show, speak and send one recognition result. */
  const emitWord = (r: ClassifyResult, latencyMs: number, isEarly: boolean) => {
    setResult({ ...r, latencyMs });
    // Wrong words spoken out loud are worse than silence: speak only accepted words.
    const shown = r.word ? expand(r.word, userName) : null; // "nama saya {nama}" -> real name
    if (shown) {
      subtitle.add(shown);
      speak(shown);
    }
    const msg: GestureResultMsg = {
      word: shown,
      reason: "reason" in r ? r.reason : undefined,
      candidates: r.candidates.slice(0, 3),
      latencyMs,
      early: isEarly,
      sentAt: Date.now(),
    };
    relay.send("g-result", msg);
  };

  const handlePartial = (frames: Frame[], t: number) => {
    if (!earlyOn || tab === "train" || !templates.length || !frames.length)
      return;
    if (segStart.current !== frames[0].t) {
      segStart.current = frames[0].t; // a new gesture started
      early.current.reset();
    }
    if (!early.current.due(t)) return;
    const r = classifyPartial(frames, templates, {
      ...clsCfg,
      weights: clsWeights,
    });
    // latency is filled in when the hand actually stops (handleSegment)
    if (early.current.push(r.word, performance.now())) emitWord(r, 0, true);
  };

  const handleSegment = async ({ frames, endedAt }: SegmentReady) => {
    if (tab === "train") {
      if (!trainWord) return;
      await getDb().templates.add({
        word: trainWord,
        frames: resample(frames),
        createdAt: new Date().toISOString(),
      });
      reloadTemplates();
      return;
    }
    // Already spoken early for this gesture: do not say it twice. Latency is then negative:
    // the word came out before the hand stopped.
    const fired = early.current.fired;
    segStart.current = null;
    const r: ClassifyResult = fired
      ? { word: fired, candidates: [] }
      : classify(frames, templates, { ...clsCfg, weights: clsWeights });
    const latencyMs =
      (fired ? early.current.firedAt : performance.now()) - endedAt;
    const handRatio =
      frames.filter((f) => f.hand).length / Math.max(1, frames.length);
    if (fired) setResult((prev) => prev && { ...prev, latencyMs, handRatio });
    else {
      emitWord(r, latencyMs, false);
      setResult({ ...r, latencyMs, handRatio });
    }
    early.current.reset();

    if (tab === "test" && test) {
      const row: GestureTestRow = {
        runId: test.runId,
        createdAt: new Date().toISOString(),
        expected: test.prompts[test.i],
        predicted: r.word,
        latencyMs,
      };
      await getDb().gestureTests.add(row);
      setTestRows((rows) => [...rows, row]);
      setTest(
        test.i + 1 < test.prompts.length ? { ...test, i: test.i + 1 } : null,
      );
    }
  };

  const g = useGestureSession({
    propped,
    segmenter: segCfg,
    onSegment: handleSegment,
    onPartial: handlePartial,
  });

  const [faceSeen, setFaceSeen] = useState(false);
  const onHandFrame = (f: HandFrame) => {
    overlay.current?.draw(f.landmarks);
    g.onHandFrame(f);
    if (faceOn && !!f.face !== faceSeen) setFaceSeen(!!f.face);
  };
  const tracker = useHandTracker(
    camera.videoRef,
    camera.state === "on",
    onHandFrame,
    faceOn,
  );

  // Status to the screen, 4x per second.
  const { send } = relay;
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      const msg: GestureStatusMsg = {
        state: g.gState,
        phase: g.phase,
        fps: tracker.fps,
        delegate: tracker.delegate,
      };
      send("g-status", msg);
    }, 250);
    // Gyro stream for the laptop-camera setup (finds which hand holds the phone).
    const imu = setInterval(() => {
      if (imuBatch.current.length) send("g-imu", { points: imuBatch.current });
      imuBatch.current = [];
    }, 100);
    return () => {
      clearInterval(id);
      clearInterval(imu);
    };
  }, [started, g.gState, g.phase, tracker.fps, tracker.delegate, send]);

  const begin = async () => {
    // iOS: speech unlock + motion permission must happen inside this tap.
    unlockSpeech();
    const perm = await PhoneSource.requestPermission();
    setStarted(true);
    if (perm === "granted") {
      const src = new PhoneSource();
      src.onSample(g.onImu);
      src.onSample((s) =>
        imuBatch.current.push({ t: s.t, g: Math.hypot(s.gx, s.gy, s.gz) }),
      );
      src.onStatus((s) => {
        setImuStatus(s);
        g.onImuStatus(s);
      });
      await src.start();
      imuSource.current = src;
    } else {
      // Without motion data only the propped (camera-only) setup can work.
      setMotionDenied(true);
      setPropped(true);
    }
    await camera.start();
    await waitForVoices();
    setNoVoice(!indonesianVoice());
  };

  useEffect(() => () => imuSource.current?.stop(), []);

  const counts = templates.reduce<Record<string, number>>((acc, t) => {
    acc[t.word] = (acc[t.word] ?? 0) + 1;
    return acc;
  }, {});
  const trainedWords = vocab.filter((w) => (counts[w] ?? 0) > 0);

  const startTest = () => {
    const prompts = Array.from(
      { length: TEST_N },
      () => trainedWords[Math.floor(Math.random() * trainedWords.length)],
    );
    setTestRows([]);
    setTest({ runId: stamp(), prompts, i: 0 });
  };

  const disclaimer = (
    <Alert tone="warning" title="Eksperimen, bukan penerjemah bahasa isyarat">
      BISINDO memakai dua tangan, ekspresi wajah dan tata bahasanya sendiri. Di
      sini hanya beberapa gerakan uji yang direkam sendiri lalu dipetakan ke
      kata.
    </Alert>
  );

  if (!started) {
    return (
      <Screen title="Gestur ke suara" subtitle="Mode 2 (eksperimen)" narrow>
        {disclaimer}
        <Button size="xl" icon={Play} onClick={begin}>
          Mulai
        </Button>
        <p className="text-sm text-muted">
          Pegang HP dengan satu tangan, kamera depan menghadap Anda. Tangan yang
          bebas bergerak di depan kamera. Mulai meminta izin kamera, sensor
          gerak dan suara.
        </p>
        <Disclosure
          title="Sambungkan ke layar lain (opsional)"
          icon={MonitorSmartphone}
          defaultOpen={code.length === 4}
        >
          <CodeInput
            label="Kode ruang dari layar"
            value={code}
            onChange={setCode}
          />
        </Disclosure>
      </Screen>
    );
  }

  return (
    <Screen
      title="Gestur ke suara"
      subtitle="Eksperimen, bukan penerjemah"
      narrow
      right={
        <>
          {!propped && <SensorPill status={imuStatus} />}
          {code.length === 4 && <RelayPill state={relay.state} />}
        </>
      }
    >
      {camera.error && (
        <Alert tone="danger" title="Kamera tidak bisa dipakai">
          {camera.error === "denied" &&
            "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser."}
          {camera.error === "busy" &&
            "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi."}
          {(camera.error === "unsupported" || camera.error === "other") &&
            "Browser ini tidak memberi akses kamera (butuh HTTPS)."}
        </Alert>
      )}
      {motionDenied && (
        <Alert tone="warning" title="Sensor gerak tidak diizinkan">
          Berjalan dalam mode HP disandarkan (hanya kamera).
        </Alert>
      )}
      {noVoice && (
        <Alert tone="warning" title="Suara bahasa Indonesia tidak ada">
          Kata diucapkan dengan suara bawaan.
        </Alert>
      )}
      {tracker.status === "error" && (
        <Alert tone="danger" title="Model tangan gagal dimuat">
          Jalankan bun run assets di laptop lalu muat ulang.
        </Alert>
      )}
      {g.phase === "paused" && (
        <Alert tone="danger" title="Sensor gerak terputus, deteksi dijeda">
          Pastikan layar menyala dan halaman ini terbuka.
        </Alert>
      )}

      <div className="relative aspect-[4/3] overflow-hidden rounded-(--radius-card) bg-text">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          className="size-full -scale-x-100 object-cover"
        />
        <HandOverlay ref={overlay} />
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge tone="neutral">
            {tracker.status === "loading"
              ? "Memuat model..."
              : `${tracker.fps} FPS ${tracker.delegate ?? ""}`}
          </Badge>
          {faceOn && (
            <Badge tone={faceSeen ? "success" : "warning"}>
              {faceSeen ? "Wajah terlihat" : "Wajah tidak terlihat"}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <GestureStatePill state={g.gState} />
        <div
          className="h-2 w-28 overflow-hidden rounded-full bg-surface-2"
          title="Energi gerak relatif terhadap istirahat"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{
              width: `${Math.min(100, (g.energy / segCfg.startRatio) * 50)}%`,
            }}
          />
        </div>
      </div>
      {g.discarded && <p className="text-sm text-warning">{g.discarded}</p>}

      {g.phase !== "ready" && g.phase !== "paused" && (
        <Button
          size="xl"
          icon={Hand}
          onClick={g.calibrateRest}
          disabled={tracker.status !== "ready" || g.phase === "calibrating"}
        >
          {g.phase === "calibrating"
            ? "Diam 3 detik..."
            : "Kalibrasi istirahat"}
        </Button>
      )}
      {g.phase === "idle" && (
        <p className="text-sm text-muted">
          Taruh tangan di posisi istirahat dan diam 3 detik, supaya aplikasi
          tahu kapan Anda mulai bergerak.
        </p>
      )}

      <SubtitleBar
        words={subtitle.words}
        pending={g.gState === "signing" && tab === "recognize"}
      />
      {subtitle.words.length > 1 && (
        <Button
          variant="secondary"
          icon={Volume2}
          onClick={() => speak(subtitle.words.join(" "))}
        >
          Ucapkan kalimat
        </Button>
      )}

      <Tabs<Tab>
        items={[
          { id: "recognize", label: "Kenali", icon: Camera },
          { id: "train", label: "Latih", icon: GraduationCap },
          { id: "test", label: "Uji", icon: FlaskConical },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "recognize" && (
        <Card title="Hasil terakhir" icon={Timer}>
          {result && (
            <p className="mb-2 text-base">
              {result.word
                ? `"${result.word}"`
                : "Tidak dikenali (tidak diucapkan)"}
              <span className="ml-2 text-sm text-muted">
                {result.latencyMs < 0
                  ? `${(-result.latencyMs).toFixed(0)} ms sebelum tangan berhenti`
                  : `${result.latencyMs.toFixed(0)} ms`}
              </span>
            </p>
          )}
          <CandidatesList
            candidates={result?.candidates ?? []}
            maxDistance={clsCfg.maxDistance}
          />
          {result && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {explainResult(result, clsCfg, counts, result.handRatio).map(
                (h) => (
                  <li key={h}>{h}</li>
                ),
              )}
            </ul>
          )}
          {templates.length === 0 && (
            <p className="mt-2 text-sm text-muted">
              Belum ada contoh. Rekam dulu di tab Latih.
            </p>
          )}
        </Card>
      )}

      {tab === "train" && (
        <Card>
          <TrainPanel
            vocab={vocab}
            groups={VOCAB_GROUPS}
            userName={userName}
            counts={counts}
            selected={trainWord}
            demo={templates.find((t) => t.word === trainWord)?.frames}
            onSelect={setTrainWord}
            onAddWord={(w) => !vocab.includes(w) && saveVocab([...vocab, w])}
            onDeleteWord={async (w) => {
              await getDb().templates.where("word").equals(w).delete();
              reloadTemplates();
            }}
            onExport={() =>
              downloadJson(`templat-gestur-${stamp()}.json`, {
                vocab,
                templates,
              })
            }
            onImport={async (file) => {
              const data = JSON.parse(await file.text()) as {
                vocab?: string[];
                templates?: Template[];
              };
              if (data.vocab)
                saveVocab([...new Set([...vocab, ...data.vocab])]);
              if (data.templates)
                await getDb().templates.bulkAdd(
                  data.templates.map(({ id: _id, ...t }) => t),
                );
              reloadTemplates();
            }}
          />
        </Card>
      )}

      {tab === "test" && (
        <Card>
          <TestPanel
            prompt={test ? test.prompts[test.i] : null}
            index={test?.i ?? 0}
            total={TEST_N}
            rows={testRows}
            canStart={trainedWords.length >= 2 && g.phase === "ready"}
            onStart={startTest}
            onExport={() =>
              downloadJson(`uji-gestur-${stamp()}.json`, testRows)
            }
          />
        </Card>
      )}

      <Disclosure title="Pengaturan (dituning lewat uji coba)" icon={Settings2}>
        <label className="block">
          <span className="mb-1 block font-medium">
            Nama Anda (untuk "nama saya ...")
          </span>
          <input
            value={userName}
            onChange={(e) => {
              setUserName(e.target.value);
              getDb()
                .settings.put({ key: USER_NAME_KEY, value: e.target.value })
                .catch(() => {});
            }}
            className="h-11 w-full rounded-(--radius-control) border border-border bg-surface px-3 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3">
          <span>
            <span className="block font-medium">Kenali lebih cepat</span>
            <span className="block text-sm text-muted">
              Ucapkan kata sebelum tangan berhenti (aturan lebih ketat)
            </span>
          </span>
          <input
            type="checkbox"
            checked={earlyOn}
            onChange={(e) => setEarlyOn(e.target.checked)}
            className="size-6 accent-primary"
          />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3">
          <span>
            <span className="block font-medium">Pakai ekspresi wajah</span>
            <span className="block text-sm text-muted">
              Alis, mata, mulut, gerak kepala. Butuh wajah terlihat di kamera;
              FPS bisa turun.
            </span>
          </span>
          <input
            type="checkbox"
            checked={faceOn}
            onChange={(e) => setFaceOn(e.target.checked)}
            className="size-6 accent-primary"
          />
        </label>
        {faceOn && (
          <Slider
            label="Bobot wajah"
            min={0}
            max={2}
            step={0.1}
            value={faceWeight}
            onChange={setFaceWeight}
          />
        )}
        <label className="flex min-h-12 items-center justify-between gap-3">
          <span className="font-medium">HP disandarkan (hanya kamera)</span>
          <input
            type="checkbox"
            checked={propped}
            onChange={(e) => setPropped(e.target.checked)}
            className="size-6 accent-primary"
          />
        </label>
        <Slider
          label="Mulai bila energi > x istirahat"
          min={1.5}
          max={10}
          step={0.5}
          value={segCfg.startRatio}
          onChange={(v) => setSegCfg({ ...segCfg, startRatio: v })}
        />
        <Slider
          label="Diam untuk berhenti"
          unit="ms"
          min={200}
          max={1000}
          step={50}
          value={segCfg.endMs}
          onChange={(v) => setSegCfg({ ...segCfg, endMs: v })}
        />
        <Slider
          label="Tolak bila jarak >"
          min={0.2}
          max={3}
          step={0.05}
          value={clsCfg.maxDistance}
          onChange={(v) => setClsCfg({ ...clsCfg, maxDistance: v })}
        />
        <Slider
          label="Tolak bila selisih kandidat <"
          unit="%"
          min={0}
          max={50}
          value={Math.round(clsCfg.minMargin * 100)}
          onChange={(v) => setClsCfg({ ...clsCfg, minMargin: v / 100 })}
        />
      </Disclosure>
    </Screen>
  );
}
