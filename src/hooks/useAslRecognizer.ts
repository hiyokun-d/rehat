"use client";
// Pretrained ASL pipeline on a <video>: MediaPipe Holistic (face + hands + body, one model)
// -> 543 landmarks per frame -> cut into signs -> model. Three ways to cut a sign:
//  - "pause" (default): the hand stops moving for ~200 ms (camera MotionGate). No need to
//    lower the hand, so signs can follow each other.
//  - gyro: same, but the phone in the signing hand decides (faster, 60-100 Hz).
//  - "hand-out": the original upstream rule (hand leaves the picture for N frames).
// While a sign is in progress a live guess runs every few frames. With "early" on, a guess
// that is confident AND the same twice in a row is accepted before the sign ends.
import type {
  HolisticLandmarker,
  HolisticLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type AslClassifier,
  type AslPrediction,
  loadAslClassifier,
} from "@/lib/asl/model";
import {
  CAMERA_GATE,
  GatedClip,
  type GateEvent,
  handSpeed,
  MotionGate,
} from "@/lib/asl/motionGate";
import {
  type AslWindow,
  type FrameChecks,
  frameChecks,
  holisticFrame,
  SignSegmenter,
  toWindow,
} from "@/lib/asl/preprocess";

const LIVE_EVERY_FRAMES = 3; // live guess cadence; model ~4-16 ms, `busy` stops pile-ups
const LIVE_MIN_FRAMES = 6;
const EARLY_MIN_FRAMES = 8; // never accept a guess from less than ~0.3-0.5 s of signing
// Bad laptop webcams: dim, low contrast. "Enhance" brightens the frame on a canvas BEFORE
// tracking (the model sees the enhanced image). Filter strength tuned by testing.
const ENHANCE_FILTER = "brightness(1.35) contrast(1.25) saturate(1.1)";
const LIGHT_EVERY_MS = 500;

/** Mean brightness 0..1 of a tiny downscaled copy of the frame (cheap). */
function measureLight(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
): number {
  ctx.drawImage(src, 0, 0, 32, 24);
  const d = ctx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4)
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4) / 255;
}

export interface AslSignResult extends AslPrediction {
  frames: number; // frames in the sign
  handFrames: number; // of which the hand was visible (what the model actually sees)
  /** Gyro mode: ms from "hand stopped" to "result ready" (end detection + model). */
  afterStillMs?: number;
  /** Accepted from the live guess before the sign ended. */
  early?: boolean;
  /** The model input, for matching user-recorded words (customSigns.ts). */
  window: AslWindow;
}

export type CutMode = "pause" | "hand-out";

export function useAslRecognizer(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  opts: {
    gapFrames: number;
    enhance: boolean;
    cut: CutMode;
    stillMs: number; // "pause" mode: how long still = end of sign
    early: boolean;
    minConf: number; // early guesses must reach this
    /** true = this partial sign looks like a user-recorded word: do not accept early. */
    holdEarly?: (w: AslWindow) => boolean;
    onSign: (r: AslSignResult) => void;
    onFrame?: (res: HolisticLandmarkerResult) => void;
  },
) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [checks, setChecks] = useState<FrameChecks | null>(null);
  const [live, setLive] = useState<AslPrediction | null>(null);
  const [recording, setRecording] = useState(0); // frames in the sign so far (0 = waiting)
  const [signs, setSigns] = useState<string[]>([]);
  const [light, setLight] = useState<number | null>(null);
  const enhanceRef = useRef(opts.enhance);
  const enhance = opts.enhance;
  useEffect(() => {
    enhanceRef.current = enhance; // read inside the frame loop without restarting it
  }, [enhance]);
  const segRef = useRef(new SignSegmenter());
  // Gyro mode (phone in the signing hand): signs are cut by MotionGate events, not by the hand
  // leaving the picture. Frames wait in a short pre-roll until the gyro says "moving".
  const clipRef = useRef(new GatedClip<Float32Array>());
  const gatedRef = useRef(false);
  const clsRef = useRef<AslClassifier | null>(null);
  const [gated, setGatedState] = useState(false);
  // gateEvent is called from relay messages (not an Effect), so it reads onSign via a ref.
  const onSignRef = useRef(opts.onSign);
  useEffect(() => {
    onSignRef.current = opts.onSign;
  });
  const tune = useRef(opts);
  useEffect(() => {
    tune.current = opts; // cut/stillMs/early/minConf apply live, without restarting the loop
  });
  // One sign = one result: an early result blocks the end-of-sign result of the same sign.
  const sign = useRef({ id: 0, fired: false, prevLive: "" });
  const onFrame = useEffectEvent((r: HolisticLandmarkerResult) =>
    opts.onFrame?.(r),
  );
  const gap = opts.gapFrames;

  /** A sign ended: classify the whole clip unless an early guess already answered it. */
  const finish = useCallback(
    (frames: Float32Array[], extra: Partial<AslSignResult> = {}) => {
      const s = sign.current;
      const fired = s.fired;
      sign.current = { id: s.id + 1, fired: false, prevLive: "" };
      setRecording(0);
      setLive(null);
      const cls = clsRef.current;
      if (fired || !cls) return;
      const w = toWindow(frames);
      if (w.length < 4) return; // hand hardly visible during the sign
      cls(w).then((p) =>
        onSignRef.current({
          ...p,
          frames: frames.length,
          handFrames: w.length,
          window: w,
          ...extra,
        }),
      );
    },
    [],
  );

  useEffect(() => {
    segRef.current.gap = gap; // slider applies live
  }, [gap]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    let landmarker: HolisticLandmarker | null = null;
    let classify: AslClassifier | null = null;
    let lastVideoTime = -1;
    let clock = 0; // MediaPipe timestamps must strictly increase
    let frameNo = 0;
    let busy = false;
    let lastUi = 0;
    const frameTimes: number[] = [];
    const work = document.createElement("canvas"); // enhanced frame fed to MediaPipe
    const workCtx = work.getContext("2d");
    const tiny = document.createElement("canvas"); // light meter
    tiny.width = 32;
    tiny.height = 24;
    const tinyCtx = tiny.getContext("2d", { willReadFrequently: true });
    let lastLight = 0;
    const camGate = new MotionGate(CAMERA_GATE);
    let prevHands: Parameters<typeof handSpeed>[0] = {
      l: undefined,
      r: undefined,
    };
    let prevT = performance.now();

    (async () => {
      setStatus("loading");
      try {
        const { FilesetResolver, HolisticLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const create = (delegate: "GPU" | "CPU") =>
          HolisticLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/holistic_landmarker.task",
              delegate,
            },
            runningMode: "VIDEO",
          });
        const [lm, cls] = await Promise.all([
          create("GPU").catch(() => create("CPU")),
          loadAslClassifier(),
        ]);
        if (cancelled) return lm.close();
        landmarker = lm;
        classify = cls;
        clsRef.current = cls;
        setSigns(cls.signs);
        setStatus("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        return;
      }

      const loop = () => {
        raf = requestAnimationFrame(loop);
        const v = videoRef.current;
        if (
          !v ||
          !landmarker ||
          !classify ||
          v.readyState < 2 ||
          v.currentTime === lastVideoTime
        )
          return;
        lastVideoTime = v.currentTime;
        const now = performance.now();
        clock = Math.max(clock + 1, now);
        let input: HTMLVideoElement | HTMLCanvasElement = v;
        if (enhanceRef.current && workCtx) {
          if (work.width !== v.videoWidth) {
            work.width = v.videoWidth;
            work.height = v.videoHeight;
          }
          workCtx.filter = ENHANCE_FILTER; // ignored where unsupported: then it is the plain frame
          workCtx.drawImage(v, 0, 0);
          input = work;
        }
        if (tinyCtx && now - lastLight > LIGHT_EVERY_MS) {
          lastLight = now;
          setLight(measureLight(tinyCtx, input));
        }
        const res = landmarker.detectForVideo(input, clock);
        onFrame(res);
        const frame = holisticFrame(res);
        frameTimes.push(now);
        while (frameTimes.length && now - frameTimes[0] > 1000)
          frameTimes.shift();

        const seg = segRef.current;
        const clip = clipRef.current;
        const cur = {
          l: res.leftHandLandmarks[0],
          r: res.rightHandLandmarks[0],
        };
        if (gatedRef.current) clip.push(now, frame);
        else if (tune.current.cut === "pause") {
          clip.push(now, frame);
          camGate.cfg = { ...CAMERA_GATE, stillMs: tune.current.stillMs };
          // No hand = speed 0: a hand leaving the picture also ends the sign.
          const ev = camGate.push(
            now,
            handSpeed(prevHands, cur, (now - prevT) / 1000),
          );
          if (ev?.kind === "start") clip.start(ev.t);
          else if (ev?.kind === "discard") {
            clip.end();
            sign.current = {
              id: sign.current.id + 1,
              fired: false,
              prevLive: "",
            };
          } else if (ev?.kind === "end")
            finish(clip.end(), { afterStillMs: now - ev.stillSince });
        } else {
          const done = seg.push(frame);
          if (done) finish(done);
        }
        prevHands = cur;
        prevT = now;
        const current =
          gatedRef.current || tune.current.cut === "pause"
            ? clip.collecting
              ? clip.frames
              : []
            : seg.frames;
        if (now - lastUi > 150) {
          lastUi = now;
          setFps(frameTimes.length);
          setChecks(frameChecks(frame));
          setRecording(current.length);
        }
        if (
          current.length >= LIVE_MIN_FRAMES &&
          ++frameNo % LIVE_EVERY_FRAMES === 0 &&
          !busy
        ) {
          busy = true;
          const id = sign.current.id;
          const n = current.length;
          const win = toWindow(current);
          classify(win)
            .then((p) => {
              const s = sign.current;
              if (s.id !== id) return; // that sign already ended
              setLive(p);
              const best = p.top[0];
              const { early, minConf } = tune.current;
              // Early accept: confident, same answer as the previous live guess, long enough.
              if (
                early &&
                !s.fired &&
                best &&
                n >= EARLY_MIN_FRAMES &&
                best.p >= minConf &&
                best.sign === s.prevLive &&
                !tune.current.holdEarly?.(win)
              ) {
                s.fired = true;
                onSignRef.current({
                  ...p,
                  frames: n,
                  handFrames: n,
                  early: true,
                  window: win,
                });
              }
              s.prevLive = best?.sign ?? "";
            })
            .finally(() => {
              busy = false;
            });
        }
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      segRef.current.reset();
      setStatus("idle");
      setLive(null);
    };
  }, [enabled, videoRef, finish]);

  /** Turn gyro mode on/off (phone streaming motion from the signing hand). */
  const setGated = useCallback((on: boolean) => {
    if (gatedRef.current === on) return;
    gatedRef.current = on;
    segRef.current.reset();
    clipRef.current.end();
    setGatedState(on);
  }, []);

  /** Feed MotionGate events from the phone gyro (timestamps in performance.now() time). */
  const gateEvent = useCallback(
    (ev: GateEvent) => {
      const clip = clipRef.current;
      if (!gatedRef.current) return;
      if (ev.kind === "start") clip.start(ev.t);
      else if (ev.kind === "discard") clip.end();
      else if (ev.kind === "end")
        finish(clip.end(), { afterStillMs: performance.now() - ev.stillSince });
    },
    [finish],
  );

  return {
    status,
    error,
    fps,
    checks,
    live,
    recording,
    signs,
    light,
    gated,
    setGated,
    gateEvent,
  };
}
