"use client";
// EXPERIMENT: laptop webcam watches the person. Both hands are tracked; the hand that moves in
// sync with the phone's gyro is taken as the phone hand and gets a "perkiraan HP" box.
// No phone detector model: the box is an estimate around that palm (see docs/NOTES.md).
import { Camera, CameraOff } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useCamera } from "@/hooks/useCamera";
import { type HandFrame, useHandTracker } from "@/hooks/useHandTracker";
import { type Landmark, landmarkSpeed } from "@/lib/gesture/features";
import { HAND_BONES } from "@/lib/gesture/handTopology";
import type { GestureImuMsg } from "@/lib/gesture/messages";
import {
  MIN_MATCH,
  palmBox,
  phoneMatch,
  type TimedValue,
} from "@/lib/gesture/phoneHand";

const WINDOW_MS = 1500; // correlation window, tuned by testing
type Pick = "auto" | "Left" | "Right";

/** Parent pushes phone gyro batches in through `imuRef` (laptop receive time). */
export function useDeskImu() {
  const gyro = useRef<TimedValue[]>([]);
  const push = (m: GestureImuMsg) => {
    const pts = m.points;
    if (!pts.length) return;
    // Phone and laptop clocks differ: anchor the newest sample at "now", keep relative spacing.
    const now = performance.now();
    const last = pts[pts.length - 1].t;
    for (const p of pts) gyro.current.push({ t: now - (last - p.t), v: p.g });
    while (gyro.current.length && now - gyro.current[0].t > WINDOW_MS * 2)
      gyro.current.shift();
  };
  return { gyro, push };
}

export function DeskCamera({ gyro }: { gyro: React.RefObject<TimedValue[]> }) {
  const camera = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pick, setPick] = useState<Pick>("auto");
  const [match, setMatch] = useState<Record<string, number>>({});
  const speeds = useRef<Record<string, TimedValue[]>>({});
  const prev = useRef<Record<string, { lm: Landmark[]; t: number }>>({});
  const lastUi = useRef(0);

  const onFrame = useEffectEvent((f: HandFrame) => {
    // Per-hand speed history, keyed by MediaPipe's handedness label.
    const scores: Record<string, number> = {};
    for (const h of f.hands) {
      const p = prev.current[h.handedness];
      const v = p ? landmarkSpeed(p.lm, h.landmarks, f.t - p.t) : 0;
      prev.current[h.handedness] = { lm: h.landmarks, t: f.t };
      speeds.current[h.handedness] ??= [];
      const arr = speeds.current[h.handedness];
      arr.push({ t: f.t, v });
      while (arr.length && f.t - arr[0].t > WINDOW_MS) arr.shift();
      scores[h.handedness] = phoneMatch(arr, gyro.current ?? []);
    }
    let phoneHand: string | null = pick === "auto" ? null : pick;
    if (pick === "auto") {
      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= MIN_MATCH) phoneHand = best[0];
    }
    draw(f, phoneHand);
    if (f.t - lastUi.current > 250) {
      lastUi.current = f.t;
      setMatch(scores);
    }
  });

  const tracker = useHandTracker(camera.videoRef, camera.state === "on", (f) =>
    onFrame(f),
  );

  const draw = (f: HandFrame, phoneHand: string | null) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w) {
      c.width = w;
      c.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const X = (x: number) => (1 - x) * w; // mirrored like the video
    for (const hand of f.hands) {
      const isPhone = hand.handedness === phoneHand;
      ctx.strokeStyle = css
        .getPropertyValue(isPhone ? "--color-warning" : "--color-primary")
        .trim();
      ctx.lineWidth = 3;
      for (const [a, b] of HAND_BONES) {
        ctx.beginPath();
        ctx.moveTo(X(hand.landmarks[a].x), hand.landmarks[a].y * h);
        ctx.lineTo(X(hand.landmarks[b].x), hand.landmarks[b].y * h);
        ctx.stroke();
      }
      if (isPhone) {
        const b = palmBox(hand.landmarks);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(X(b.x + b.w), b.y * h, b.w * w, b.h * h);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "600 14px var(--font-poppins), sans-serif";
        ctx.fillText("perkiraan HP", X(b.x + b.w), b.y * h - 6);
      }
    }
  };

  useEffect(() => {
    if (camera.state === "off")
      canvasRef.current?.getContext("2d")?.clearRect(0, 0, 9999, 9999);
  }, [camera.state]);

  return (
    <div className="space-y-3">
      {camera.error && (
        <Alert tone="danger" title="Kamera laptop tidak bisa dipakai">
          {camera.error === "busy"
            ? "Kamera dipakai aplikasi lain."
            : "Izinkan kamera untuk situs ini."}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {camera.state === "on" ? (
          <Button variant="secondary" icon={CameraOff} onClick={camera.stop}>
            Matikan kamera laptop
          </Button>
        ) : (
          <Button
            icon={Camera}
            onClick={camera.start}
            loading={camera.state === "starting"}
          >
            Pakai kamera laptop
          </Button>
        )}
        <Tabs<Pick>
          items={[
            { id: "auto", label: "HP: otomatis" },
            { id: "Left", label: "Kiri" },
            { id: "Right", label: "Kanan" },
          ]}
          value={pick}
          onChange={setPick}
        />
      </div>
      <div className="relative aspect-video overflow-hidden rounded-(--radius-card) bg-text">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          className="size-full -scale-x-100 object-cover"
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 size-full"
        />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          <Badge>
            {tracker.status === "loading"
              ? "Memuat model..."
              : `${tracker.fps} FPS ${tracker.delegate ?? ""}`}
          </Badge>
          {Object.entries(match).map(([k, v]) => (
            <Badge key={k} tone={v >= MIN_MATCH ? "warning" : "neutral"}>
              {k}: cocok {v.toFixed(2)}
            </Badge>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        Kotak HP adalah perkiraan di sekitar telapak tangan yang bergerak
        bersamaan dengan gyro HP (buka /gesture di HP dengan kode ruang ini).
        Label kiri/kanan dari MediaPipe bisa tertukar pada kamera yang tidak
        dicerminkan.
      </p>
    </div>
  );
}
