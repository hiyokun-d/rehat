"use client";
// Mode 2 pipeline on the phone: camera hand frames + phone IMU -> rest calibration ->
// segmentation -> (recognise | train | test). Pure logic lives in src/lib/gesture/.
import { useCallback, useEffect, useRef, useState } from "react";
import type { HandFrame } from "@/hooks/useHandTracker";
import {
  type Frame,
  imuFeatures,
  type Landmark,
  landmarkSpeed,
  normalizeHand,
} from "@/lib/gesture/features";
import {
  type Baseline,
  type GState,
  motionEnergy,
  Segmenter,
  type SegmenterConfig,
} from "@/lib/gesture/segmenter";
import type { Sample, SensorStatus } from "@/lib/sensor/types";

const REST_MS = 3000;

export type GPhase = "idle" | "calibrating" | "ready" | "paused";

export interface SegmentReady {
  frames: Frame[];
  endedAt: number; // performance.now() when the segment was declared ended
}

export function useGestureSession(opts: {
  propped: boolean; // phone on a stand: camera only, IMU just for "still"
  segmenter: SegmenterConfig;
  onSegment: (s: SegmentReady) => void;
  /** Called on every frame while signing, with the gesture so far (for early recognition). */
  onPartial?: (frames: Frame[], t: number) => void;
  onState?: (s: GState) => void;
}) {
  const [phase, setPhase] = useState<GPhase>("idle");
  const [gState, setGState] = useState<GState>("rest");
  const [energy, setEnergy] = useState(0);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [discarded, setDiscarded] = useState<string | null>(null);

  const imuRef = useRef<Sample | null>(null);
  // The IMU runs faster (60-100 Hz) than the camera (~15-30 FPS). Average all gyro samples
  // between two camera frames instead of taking only the latest: no motion is missed.
  const gyroAcc = useRef({ gx: 0, gy: 0, gz: 0, n: 0 });
  const prevLm = useRef<{ lm: Landmark[] | null; t: number }>({
    lm: null,
    t: 0,
  });
  const restBuf = useRef<{
    gyro: number[];
    speed: number[];
    t0: number;
  } | null>(null);
  const segRef = useRef(new Segmenter(opts.segmenter));
  const baselineRef = useRef<Baseline | null>(null);
  const phaseRef = useRef<GPhase>("idle");
  const lastEnergyUi = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const setPhaseBoth = useCallback((p: GPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const onImu = useCallback((s: Sample) => {
    imuRef.current = s;
    const a = gyroAcc.current;
    a.gx += s.gx;
    a.gy += s.gy;
    a.gz += s.gz;
    a.n++;
  }, []);

  /** Not monitored = not safe: if the IMU stops, stop listening for gestures. */
  const onImuStatus = useCallback(
    (st: SensorStatus) => {
      if (
        st === "lost" &&
        phaseRef.current === "ready" &&
        !optsRef.current.propped
      ) {
        segRef.current = new Segmenter(optsRef.current.segmenter);
        setGState("rest");
        setPhaseBoth("paused");
      }
      if (st === "ok" && phaseRef.current === "paused") setPhaseBoth("ready");
    },
    [setPhaseBoth],
  );

  const calibrateRest = useCallback(() => {
    restBuf.current = { gyro: [], speed: [], t0: performance.now() };
    setPhaseBoth("calibrating");
  }, [setPhaseBoth]);

  const onHandFrame = useCallback(
    (h: HandFrame) => {
      const o = optsRef.current;
      const last = imuRef.current;
      const acc = gyroAcc.current;
      const imu: Sample | null =
        last && acc.n
          ? {
              ...last,
              gx: acc.gx / acc.n,
              gy: acc.gy / acc.n,
              gz: acc.gz / acc.n,
            }
          : last;
      gyroAcc.current = { gx: 0, gy: 0, gz: 0, n: 0 };
      const gyro = imu ? Math.hypot(imu.gx, imu.gy, imu.gz) : 0;
      const speed = landmarkSpeed(
        prevLm.current.lm,
        h.landmarks,
        h.t - prevLm.current.t,
      );
      prevLm.current = { lm: h.landmarks, t: h.t };

      if (phaseRef.current === "calibrating" && restBuf.current) {
        const b = restBuf.current;
        b.gyro.push(gyro);
        b.speed.push(speed);
        if (h.t - b.t0 >= REST_MS) {
          // Baseline = mean + 2 SD of rest: "normal jitter" for this person, phone and light.
          const stat = (xs: number[]) => {
            const m = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
            const sd = Math.sqrt(
              xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length),
            );
            return m + 2 * sd;
          };
          const bl = { gyroDegS: stat(b.gyro), handSpeed: stat(b.speed) };
          baselineRef.current = bl;
          setBaseline(bl);
          segRef.current = new Segmenter(o.segmenter);
          restBuf.current = null;
          setPhaseBoth("ready");
        }
        return;
      }
      if (phaseRef.current !== "ready" || !baselineRef.current) return;

      const seg = segRef.current;
      seg.cfg = o.segmenter; // sliders apply live
      const e = motionEnergy(gyro, speed, baselineRef.current, !o.propped);
      const frame: Frame = {
        t: h.t,
        hand: h.landmarks ? normalizeHand(h.landmarks, h.handedness) : null,
        imu: o.propped ? [0, 0, 0, 0, 0, 0] : imuFeatures(imu),
        face: h.face,
      };
      const before = seg.state;
      const ev = seg.push(frame, e);
      if (seg.state !== before) {
        setGState(seg.state);
        o.onState?.(seg.state);
      }
      if (h.t - lastEnergyUi.current > 100) {
        lastEnergyUi.current = h.t;
        setEnergy(e);
      }
      if (seg.state === "signing") o.onPartial?.(seg.current, h.t);
      if (ev?.kind === "segment") {
        setDiscarded(null);
        o.onSegment({ frames: ev.frames, endedAt: performance.now() });
      } else if (ev?.kind === "discarded") {
        setDiscarded(
          ev.reason === "too-short"
            ? "Gerakan terlalu singkat"
            : "Gerakan terlalu lama (> 4 detik)",
        );
      }
    },
    [setPhaseBoth],
  );

  return {
    phase,
    gState,
    energy,
    baseline,
    discarded,
    onImu,
    onImuStatus,
    onHandFrame,
    calibrateRest,
  };
}
