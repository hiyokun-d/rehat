"use client";
// Pretrained ASL recogniser (no training needed): 250 isolated American Sign Language signs.
// Needs face + hand + arm in view, so a laptop webcam or a phone on a stand works best.
// Everything runs in the browser; no video leaves the device.
//
// Laptop + phone: the laptop shows a pairing QR. A paired phone whose own camera is off mirrors
// the laptop: it receives only the tracked points (no video) and draws them (skeleton/avatar),
// plus the results and live checks. If the phone starts its own camera, it works on its own.
import type { HolisticLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  BookOpen,
  Camera,
  Cat,
  Eye,
  Link2,
  PersonStanding,
  Settings2,
  Sparkles,
  Target,
  Volume2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CameraChecks } from "@/components/asl/CameraChecks";
import {
  HolisticOverlay,
  type HolisticOverlayHandle,
  type OverlayMode,
} from "@/components/asl/HolisticOverlay";
import { RelayPill } from "@/components/ConnectionPills";
import { ScoreBars } from "@/components/gesture/ScoreBars";
import { SubtitleBar } from "@/components/gesture/SubtitleBar";
import { PairingCard } from "@/components/RoomCodeDisplay";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Disclosure } from "@/components/ui/Disclosure";
import { Screen } from "@/components/ui/Screen";
import { Slider } from "@/components/ui/Slider";
import { Tabs } from "@/components/ui/Tabs";
import { useAslRecognizer } from "@/hooks/useAslRecognizer";
import { useCamera } from "@/hooks/useCamera";
import { useRelay } from "@/hooks/useRelay";
import { useSubtitle } from "@/hooks/useSubtitle";
import { useWakeLock } from "@/hooks/useWakeLock";
import { glossEn, glossId } from "@/lib/asl/glossId";
import { MotionGate } from "@/lib/asl/motionGate";
import { PhoneLocator } from "@/lib/asl/phoneLocator";
import {
  type AslFrameMsg,
  type AslImuMsg,
  type AslResultMsg,
  type AslStatusMsg,
  packFrame,
  unpackFrame,
} from "@/lib/asl/remote";
import { syntheticFrame } from "@/lib/asl/synthetic";
import type { TimedValue } from "@/lib/gesture/phoneHand";
import { PhoneSource } from "@/lib/sensor/phoneSource";
import { speak, unlockSpeech } from "@/lib/speech";

type Lang = "id" | "en";
type Role = "local" | "host" | "viewer"; // host = laptop sharing its tracker; viewer = phone mirroring it
const FRAME_SEND_MS = 66; // ~15 fps of landmarks to the phone
const STATUS_SEND_MS = 250;
const REMOTE_STALE_MS = 1500;

/** External dictionary (opens in a new tab): videos of each sign. */
const howTo = (sign: string) =>
  `https://www.signasl.org/sign/${encodeURIComponent(glossEn(sign).split("/")[0])}`;

interface Shown {
  top: { sign: string; p: number }[];
  handFrames: number;
  ms: number;
  all?: Float32Array; // only for local results (target rank)
  afterStillMs?: number; // gyro mode: how fast the word came after the hand stopped
}

export function AslApp({ embedded = false }: { embedded?: boolean } = {}) {
  const camera = useCamera({ width: 1280, height: 720 }); // more pixels help small/far hands on webcams
  const overlay = useRef<HolisticOverlayHandle>(null);
  const subtitle = useSubtitle();
  const [started, setStarted] = useState(false);
  const [minConf, setMinConf] = useState(0.5); // speak only above this; tuned by testing
  const [gapFrames, setGapFrames] = useState(8); // frames without hand that end a sign (upstream default)
  const [enhance, setEnhance] = useState(false);
  const [view, setView] = useState<OverlayMode>("skeleton");
  const [lang, setLang] = useState<Lang>("id");
  const [target, setTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [last, setLast] = useState<Shown | null>(null);
  const [srcAspect, setSrcAspect] = useState(16 / 9); // width / height of what the stage shows

  const [role, setRole] = useState<Role>("local");
  const [room, setRoom] = useState<string | null>(null);
  const [remote, setRemote] = useState<AslStatusMsg | null>(null);
  const [remoteAt, setRemoteAt] = useState(0);
  const [now, setNow] = useState(0);
  const lastSent = useRef({ frame: 0, status: 0 });
  // Phone position (host): gyro series + gravity streamed by the paired phone.
  const locator = useRef(new PhoneLocator());
  const gyro = useRef<TimedValue[]>([]);
  const grav = useRef<[number, number, number] | null>(null);
  const gate = useRef(new MotionGate());
  const imuAt = useRef(0);
  const [fastSigning, setFastSigning] = useState(true);
  const [gyroNow, setGyroNow] = useState(0);
  const [phoneHand, setPhoneHand] = useState<string | null>(null);
  // Viewer: stream this phone's motion to the laptop.
  const [sendingMotion, setSendingMotion] = useState(false);
  const motionSrc = useRef<PhoneSource | null>(null);
  const motionBatch = useRef<AslImuMsg>({ points: [], grav: null });
  useWakeLock(started);

  useEffect(() => {
    const r = new URLSearchParams(location.search).get("room");
    if (r && /^\d{4}$/.test(r)) {
      setRoom(r);
      setRole("viewer");
    }
  }, []);

  const label = (s: string) => (lang === "id" ? glossId(s) : glossEn(s));
  const say = (text: string) => speak(text, lang === "id" ? "id-ID" : "en-US");
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const localCam = camera.state === "on";
  const relay = useRelay({
    role: role === "host" ? "screen" : "phone",
    roomId: room,
    enabled: role !== "local",
    onMessage: (m) => {
      if (role === "host" && m.type === "asl-imu") {
        // Clocks differ: anchor the newest sample at "now", keep the relative spacing.
        const { points, grav: g } = m.payload as AslImuMsg;
        const t = performance.now();
        const lastT = points[points.length - 1]?.t ?? 0;
        for (const p of points) {
          const tp = t - (lastT - p.t);
          gyro.current.push({ t: tp, v: p.g });
          // Faster signing: the phone's gyro decides when a sign starts and ends.
          const ev = gate.current.push(tp, p.g);
          if (ev) asl.gateEvent(ev);
        }
        while (gyro.current.length && t - gyro.current[0].t > 3000)
          gyro.current.shift();
        if (g) grav.current = g;
        imuAt.current = t;
        if (!asl.gated && fastSigning) asl.setGated(true);
        return;
      }
      if (role !== "viewer" || localCam) return; // own camera on: ignore the laptop
      if (m.type === "asl-frame") {
        const f = m.payload as AslFrameMsg;
        if (f.a && Math.abs(f.a - srcAspect) > 0.01) setSrcAspect(f.a);
        overlay.current?.draw(unpackFrame(f), {
          mode: viewRef.current,
          aspect: f.a ?? 16 / 9,
          // (box shape follows the laptop picture)
          fit: "contain", // show the laptop's whole picture on the phone
          phone: f.ph,
        });
        setRemoteAt(performance.now());
      } else if (m.type === "asl-status") setRemote(m.payload as AslStatusMsg);
      else if (m.type === "asl-result") {
        const r = m.payload as AslResultMsg;
        setLast(r);
        if (r.spoken) {
          subtitle.add(label(r.top[0].sign));
          say(label(r.top[0].sign));
        }
      }
    },
  });
  const phoneConnected = role === "host" && relay.peers.phones > 0;

  const asl = useAslRecognizer(camera.videoRef, localCam, {
    gapFrames,
    enhance,
    onFrame: (res: HolisticLandmarkerResult) => {
      const t = performance.now();
      const v = camera.videoRef.current;
      const aspect = v?.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
      if (Math.abs(aspect - srcAspect) > 0.01) setSrcAspect(aspect);
      const phone = phoneConnected
        ? locator.current.update(
            { l: res.leftHandLandmarks[0], r: res.rightHandLandmarks[0] },
            t,
            gyro.current,
            grav.current,
          )
        : null;
      overlay.current?.draw(res, {
        mode: viewRef.current,
        aspect,
        fit: "cover",
        phone,
      });
      if (phoneConnected && t - lastSent.current.frame > FRAME_SEND_MS) {
        lastSent.current.frame = t;
        relay.send("asl-frame", {
          ...packFrame(res),
          a: aspect,
          ph: phone,
        } satisfies AslFrameMsg);
        const side = phone ? (phone.side === "l" ? "kiri" : "kanan") : null;
        if (side !== phoneHand) setPhoneHand(side);
      }
    },
    onSign: (r) => {
      setLast(r);
      const best = r.top[0];
      // Wrong words spoken out loud are worse than silence: speak only confident results.
      const spoken = !!best && best.p >= minConf;
      if (phoneConnected) {
        const msg: AslResultMsg = {
          top: r.top,
          handFrames: r.handFrames,
          ms: r.ms,
          afterStillMs: r.afterStillMs,
          spoken,
        };
        relay.send("asl-result", msg);
      }
      if (spoken) {
        subtitle.add(label(best.sign));
        if (!phoneConnected) say(label(best.sign)); // the phone speaks when it is mirroring
      }
    },
  });

  // Live status to the phone (checks, FPS, live guess), a few times per second.
  useEffect(() => {
    if (!phoneConnected) return;
    const t = performance.now();
    if (t - lastSent.current.status < STATUS_SEND_MS) return;
    lastSent.current.status = t;
    const msg: AslStatusMsg = {
      fps: asl.fps,
      recording: asl.recording,
      checks: asl.checks,
      light: asl.light,
      live: asl.live?.top.slice(0, 3) ?? null,
    };
    relay.send("asl-status", msg);
  }, [
    phoneConnected,
    asl.fps,
    asl.recording,
    asl.checks,
    asl.light,
    asl.live,
    relay,
  ]);

  // Host: gyro mode only while the phone is actually streaming (not monitored = fall back).
  useEffect(() => {
    if (role !== "host") return;
    const id = setInterval(() => {
      const fresh = performance.now() - imuAt.current < 1000;
      if (asl.gated && (!fresh || !fastSigning)) asl.setGated(false);
      if (fresh) setGyroNow(gate.current.last);
    }, 150);
    return () => clearInterval(id);
  }, [role, asl.gated, asl.setGated, fastSigning]);

  // Viewer: notice when the laptop stops sending.
  useEffect(() => {
    if (role !== "viewer") return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [role]);
  const mirroring =
    role === "viewer" &&
    !localCam &&
    remoteAt > 0 &&
    now - remoteAt < REMOTE_STALE_MS;

  /** Viewer: send this phone's gyro + gravity so the laptop can find it in the picture. */
  const toggleMotion = async () => {
    if (sendingMotion) {
      motionSrc.current?.stop();
      motionSrc.current = null;
      setSendingMotion(false);
      return;
    }
    if ((await PhoneSource.requestPermission()) !== "granted") return; // iOS: inside this tap
    const src = new PhoneSource();
    src.onSample((x) => {
      motionBatch.current.points.push({
        t: x.t,
        g: Math.hypot(x.gx, x.gy, x.gz),
      });
      motionBatch.current.grav = [x.ax, x.ay, x.az];
    });
    await src.start();
    motionSrc.current = src;
    setSendingMotion(true);
  };
  useEffect(() => {
    if (!sendingMotion) return;
    const id = setInterval(() => {
      if (!motionBatch.current.points.length) return;
      relay.send("asl-imu", motionBatch.current);
      motionBatch.current = { points: [], grav: motionBatch.current.grav };
    }, 40); // small batches: every 40 ms of delay here is 40 ms later words
    return () => clearInterval(id);
  }, [sendingMotion, relay]);
  useEffect(() => () => motionSrc.current?.stop(), []);

  // "Coba tanpa kamera": SYNTHETIC figure through the same overlay (views, physics, layout).
  const [demo, setDemo] = useState(false);
  const demoActive = demo && !localCam && !mirroring;
  useEffect(() => {
    if (!demoActive) return;
    setSrcAspect(16 / 9); // the synthetic figure is drawn in a landscape picture
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      overlay.current?.draw(syntheticFrame(performance.now()), {
        mode: viewRef.current,
        aspect: 16 / 9,
        fit: "contain",
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [demoActive]);

  const begin = async () => {
    unlockSpeech(); // iOS: must happen inside this tap
    setStarted(true);
    await camera.start();
  };

  // What to show: local tracker, or the laptop's (mirror).
  const st = mirroring && remote ? remote : null;
  const fps = st ? st.fps : asl.fps;
  const recording = st ? st.recording : asl.recording;
  const checks = st ? st.checks : asl.checks;
  const light = st ? st.light : asl.light;
  const live = st ? st.live : (asl.live?.top.slice(0, 3) ?? null);
  const signs = asl.signs;

  const targetIdx = target ? signs.indexOf(target) : -1;
  const targetP = last?.all && targetIdx >= 0 ? last.all[targetIdx] : null;
  const targetRank =
    last?.all && targetP !== null
      ? Array.from(last.all).filter((p) => p > targetP).length + 1
      : null;
  const filtered = signs.filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.toLowerCase().includes(q) || glossId(s).includes(q);
  });

  const stage = (
    // The box takes the picture's shape (landscape laptop/demo, portrait phone camera), so
    // nothing is cropped and nothing is letterboxed small on a phone.
    <div
      className="relative mx-auto max-h-[75vh] w-full overflow-hidden rounded-(--radius-card) bg-text"
      style={{ aspectRatio: srcAspect, maxWidth: `calc(75vh * ${srcAspect})` }}
    >
      <video
        ref={camera.videoRef}
        playsInline
        muted
        className={`size-full -scale-x-100 object-cover ${view !== "skeleton" || !localCam ? "opacity-0" : ""}`}
      />
      <HolisticOverlay ref={overlay} />
      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
        {mirroring && <Badge tone="primary">Dari kamera laptop</Badge>}
        {demoActive && (
          <Badge tone="warning">Data sintetis (bukan pengukuran)</Badge>
        )}
        {phoneHand && <Badge tone="warning">HP di tangan {phoneHand}</Badge>}
        {asl.gated && <Badge tone="success">Isyarat cepat: gyro HP</Badge>}
        {localCam && (
          <Badge>
            {asl.status === "loading"
              ? "Memuat model (~15 MB)..."
              : `${fps} FPS`}
          </Badge>
        )}
        {(localCam ? asl.status === "ready" : mirroring) && (
          <Badge tone={recording ? "warning" : "neutral"}>
            {recording
              ? `Merekam isyarat (${recording} frame)`
              : asl.gated
                ? "Gerakkan tangan ber-HP, jeda sebentar = 1 isyarat"
                : "Angkat tangan untuk mulai"}
          </Badge>
        )}
      </div>
      {!localCam && !mirroring && !demoActive && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-surface">
          {role === "viewer"
            ? "Menunggu kamera laptop... (atau mulai kamera HP ini)"
            : "Kamera belum menyala"}
        </div>
      )}
      {live && live.length > 0 && (
        <div className="absolute inset-x-2 bottom-2 rounded-(--radius-control) bg-surface/90 p-2 text-sm">
          Sementara terbaca:{" "}
          {live
            .map((t) => `${label(t.sign)} ${Math.round(t.p * 100)}%`)
            .join(" · ")}
        </div>
      )}
    </div>
  );

  const shell = (children: React.ReactNode) =>
    embedded ? (
      <div className="space-y-4">
        {role !== "local" && <RelayPill state={relay.state} />}
        {children}
      </div>
    ) : (
      <Screen
        title="ASL siap pakai"
        subtitle="Model terlatih: 250 isyarat ASL, tanpa perlu merekam"
        right={role !== "local" && <RelayPill state={relay.state} />}
      >
        {children}
      </Screen>
    );

  return shell(
    <>
      <Alert tone="info" title="Ini ASL (Amerika), bukan BISINDO">
        Satu isyarat per kali (bukan kalimat isyarat penuh), dari kosakata
        anak-anak. Menurut pembuat model, benar 74,7% pada orang yang belum
        pernah dilihat model; akurasi untuk kita belum diukur. Bukan penerjemah.
      </Alert>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Left: the camera stage + captions (big on desktop). */}
        <div className="space-y-4">
          {camera.error && (
            <Alert tone="danger" title="Kamera tidak bisa dipakai">
              {camera.error === "denied"
                ? "Izinkan kamera untuk situs ini."
                : "Kamera sedang dipakai atau tidak ada."}
            </Alert>
          )}
          {asl.status === "error" && (
            <Alert tone="danger" title="Model gagal dimuat">
              {asl.error} (sudah jalankan `bun run assets`?)
            </Alert>
          )}
          {stage}
          <div className="flex flex-wrap gap-2">
            {!localCam && (
              <Button
                icon={Camera}
                onClick={begin}
                loading={camera.state === "starting"}
              >
                {role === "viewer" ? "Pakai kamera HP ini" : "Mulai kamera"}
              </Button>
            )}
            {!localCam && !mirroring && (
              <Button
                variant="ghost"
                icon={Sparkles}
                onClick={() => setDemo(!demo)}
              >
                {demo ? "Hentikan demo" : "Coba tanpa kamera"}
              </Button>
            )}
            {role === "local" && (
              <Button
                variant="secondary"
                icon={Link2}
                onClick={() => setRole("host")}
              >
                Tampilkan di HP
              </Button>
            )}
            {role === "viewer" && !localCam && (
              <Button
                variant={sendingMotion ? "primary" : "secondary"}
                onClick={toggleMotion}
              >
                {sendingMotion
                  ? "Gerak HP terkirim"
                  : "Kirim gerak HP (lacak posisi HP)"}
              </Button>
            )}
            <Tabs<OverlayMode>
              items={[
                { id: "skeleton", label: "Kerangka", icon: Eye },
                { id: "avatar", label: "Avatar", icon: Sparkles },
                { id: "kiko", label: "Kiko", icon: Cat },
                { id: "human", label: "Manusia 3D", icon: PersonStanding },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
          <SubtitleBar
            words={subtitle.words}
            pending={recording > 0}
            size="xl"
          />
          {subtitle.words.length > 1 && (
            <Button
              variant="secondary"
              icon={Volume2}
              onClick={() => say(subtitle.words.join(" "))}
            >
              Ucapkan kalimat
            </Button>
          )}
          {role === "host" && !phoneConnected && (
            <PairingCard code={relay.roomId} path="/gesture?mode=asl" />
          )}
        </div>

        {/* Right: diagnostics. */}
        <div className="space-y-4">
          {!started && role !== "viewer" && (
            <Card title="Cara pakai" icon={Eye}>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>
                  Wajah, bahu dan siku harus masuk kamera (laptop, atau HP
                  disandarkan).
                </li>
                <li>
                  Turunkan tangan. Angkat, lakukan satu isyarat, lalu turunkan
                  lagi.
                </li>
                <li>
                  Belum tahu isyaratnya? Pilih kata di "Latihan" dan buka "Lihat
                  caranya".
                </li>
              </ol>
            </Card>
          )}
          {role === "host" && (
            <Card title="Isyarat cepat (HP di tangan)" icon={Zap}>
              <p className="mb-2 text-sm text-muted">
                Pegang HP di tangan yang berisyarat dan tekan "Kirim gerak HP"
                di HP. Isyarat berakhir saat tangan berhenti sebentar, tidak
                perlu menurunkan tangan: bisa beruntun jadi kalimat.
              </p>
              {asl.gated ? (
                <ScoreBars
                  threshold={gate.current.thresholds.start / 300}
                  thresholdLabel={`mulai bergerak (${Math.round(gate.current.thresholds.start)}°/s)`}
                  items={[
                    {
                      key: "g",
                      label: gate.current.moving
                        ? "Bergerak (merekam)"
                        : "Diam",
                      sub: `${Math.round(gyroNow)}°/s`,
                      value: Math.min(1, gyroNow / 300),
                    },
                  ]}
                />
              ) : (
                <p className="text-sm">
                  Belum ada gerak dari HP. Sekarang memakai cara biasa: turunkan
                  tangan.
                </p>
              )}
              <label className="mt-3 flex min-h-12 items-center justify-between gap-3 border-t border-border pt-3">
                <span className="font-medium">
                  Pakai gyro HP untuk memotong isyarat
                </span>
                <input
                  type="checkbox"
                  checked={fastSigning}
                  onChange={(e) => setFastSigning(e.target.checked)}
                  className="size-6 accent-primary"
                />
              </label>
            </Card>
          )}
          <Card title="Yang dilihat kamera sekarang" icon={Eye}>
            <CameraChecks checks={checks} fps={fps} light={light} />
            {localCam && (
              <label className="mt-3 flex min-h-12 items-center justify-between gap-3 border-t border-border pt-3">
                <span>
                  <span className="block font-medium">Perjelas kamera</span>
                  <span className="block text-sm text-muted">
                    Untuk webcam laptop yang gelap/buram
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={enhance}
                  onChange={(e) => setEnhance(e.target.checked)}
                  className="size-6 accent-primary"
                />
              </label>
            )}
          </Card>

          <Card title="Seberapa yakin model" icon={Target}>
            {last ? (
              <>
                <p className="mb-3 text-base">
                  {last.top[0].p >= minConf ? (
                    <>
                      Terbaca{" "}
                      <span className="font-semibold">
                        "{label(last.top[0].sign)}"
                      </span>
                    </>
                  ) : (
                    "Tidak cukup yakin, tidak diucapkan"
                  )}
                  <span className="ml-2 text-sm text-muted">
                    {last.handFrames} frame tangan, model {last.ms.toFixed(1)}{" "}
                    ms
                    {last.afterStillMs !== undefined &&
                      ` · ${Math.round(last.afterStillMs)} ms setelah tangan berhenti`}
                  </span>
                </p>
                <ScoreBars
                  threshold={minConf}
                  thresholdLabel={`batas yakin ${Math.round(minConf * 100)}%`}
                  items={last.top.map((t) => ({
                    key: t.sign,
                    label: `${label(t.sign)}${lang === "id" ? ` (${glossEn(t.sign)})` : ""}`,
                    sub: `${Math.round(t.p * 100)}%`,
                    value: t.p,
                    highlight: t.sign === target,
                  }))}
                />
                {last.handFrames < 8 && (
                  <p className="mt-2 text-sm text-warning">
                    Tangan hanya terlihat {last.handFrames} frame. Lakukan
                    isyarat lebih lama atau lebih dekat ke kamera.
                  </p>
                )}
                {target && targetRank !== null && targetP !== null && (
                  <p className="mt-3 rounded-(--radius-control) bg-warning-soft p-3 text-sm">
                    Target "{label(target)}": peringkat {targetRank} dari 250,{" "}
                    {Math.round(targetP * 100)}%.
                    {targetRank === 1
                      ? " Berhasil!"
                      : " Bandingkan lagi dengan video contohnya."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">
                Lakukan satu isyarat lalu turunkan tangan.
              </p>
            )}
          </Card>

          <Disclosure
            title="Latihan: cari isyarat dan lihat caranya"
            icon={BookOpen}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kata (Indonesia atau Inggris)"
              aria-label="Cari isyarat"
              className="mb-3 h-11 w-full rounded-(--radius-control) border border-border bg-surface px-3 focus:border-primary focus:outline-none"
            />
            {!signs.length && (
              <p className="text-sm text-muted">
                Daftar muncul setelah kamera dimulai dan model termuat.
              </p>
            )}
            <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
              {filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={target === s}
                  onClick={() => setTarget(target === s ? null : s)}
                  className={
                    target === s
                      ? "min-h-11 rounded-full border border-warning bg-warning-soft px-3 text-sm font-medium"
                      : "min-h-11 rounded-full border border-border bg-surface px-3 text-sm"
                  }
                >
                  {glossId(s)} <span className="text-muted">{glossEn(s)}</span>
                </button>
              ))}
            </div>
            {target && (
              <a
                href={howTo(target)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline"
              >
                <BookOpen size={18} aria-hidden /> Lihat caranya: "
                {glossEn(target)}" (SignASL.org)
              </a>
            )}
          </Disclosure>

          <Disclosure title="Pengaturan" icon={Settings2}>
            <Tabs<Lang>
              items={[
                { id: "id", label: "Bahasa Indonesia" },
                { id: "en", label: "English" },
              ]}
              value={lang}
              onChange={setLang}
            />
            <Slider
              label="Ucapkan bila yakin minimal"
              min={10}
              max={95}
              step={5}
              unit="%"
              value={Math.round(minConf * 100)}
              onChange={(v) => setMinConf(v / 100)}
            />
            <Slider
              label="Isyarat selesai setelah tangan hilang (frame)"
              min={3}
              max={20}
              step={1}
              value={gapFrames}
              onChange={setGapFrames}
            />
            {role === "local" && (
              <Button
                variant="secondary"
                icon={Link2}
                onClick={() => setRole("host")}
              >
                Hubungkan HP ke kamera ini
              </Button>
            )}
          </Disclosure>
        </div>
      </div>
      <p className="text-xs text-muted">
        Model: ASL Realtime Transformer oleh ceyda akin (CC BY 4.0), dilatih
        dengan data Google Isolated Sign Language Recognition. Kode praproses:
        github.com/ceydaakin/asl-realtime (MIT). Pelacak tangan, wajah dan
        tubuh: MediaPipe Holistic. Semua berjalan di perangkat ini.
      </p>
    </>,
  );
}
