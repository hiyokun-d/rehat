"use client";
// Glue between a SensorSource, the pure RehabSession and the outside world (voice + relay).
// All safety logic runs here on the phone; the laptop only displays what we send.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartPoint } from "@/components/LiveChart";
import { newId } from "@/lib/device";
import { vibrateCue } from "@/lib/haptics";
import type { CalibrationResult } from "@/lib/rehab/angle";
import { CUE_GAP_MS } from "@/lib/rehab/defaults";
import type { BreachEvent } from "@/lib/rehab/envelope";
import type { PhoneState, TelemetryPoint } from "@/lib/rehab/messages";
import { RehabSession, type SessionConfig } from "@/lib/rehab/session";
import {
  type Reporter,
  SessionRecorder,
  type SessionSummary,
} from "@/lib/rehab/summary";
import { BleSource } from "@/lib/sensor/bleSource";
import { DeviceExtrasReader, EMPTY_EXTRAS } from "@/lib/sensor/deviceExtras";
import { PhoneSource } from "@/lib/sensor/phoneSource";
import { RateMeter, type RateStats } from "@/lib/sensor/rateMeter";
import type { Recording } from "@/lib/sensor/recording";
import type {
  Sample,
  SensorSource,
  SensorStatus,
  SourceKind,
} from "@/lib/sensor/types";
import { speak } from "@/lib/speech";

type Send = <P>(type: string, payload: P) => void;

export interface PhoneSessionOptions {
  send: Send;
  /** Who is holding the phone (AGENTS.md: every log stores reported_by). */
  reporter: Reporter;
  device: { id: string; label: string } | null;
  /** Called once per finished session that has data. The page stores and syncs it. */
  onSessionEnd: (s: SessionSummary) => void;
}

const kindOf = (src: SensorSource | null): SourceKind =>
  src instanceof PhoneSource
    ? "phone"
    : src instanceof BleSource
      ? "ble"
      : "replay";

const CUES: Record<BreachEvent["kind"], string> = {
  angle: "Pelan-pelan, turunkan tangan.",
  velocity: "Pelan-pelan, gerakkan lebih lambat.",
};

const TELEMETRY_EVERY_MS = 100; // batch ~6 samples per message instead of 60 messages/s
const BREACH_VISIBLE_MS = 4000;
const CHART_KEEP_MS = 12_000;
const STATE_EVERY_MS = 250; // UI + screen refresh 4x per second is enough to read numbers

export function usePhoneSession({
  send,
  reporter,
  device,
  onSessionEnd,
}: PhoneSessionOptions) {
  const [session] = useState(() => new RehabSession());
  const [snap, setSnap] = useState<PhoneState>(() => ({
    ...session.snapshot(),
    sensor: "off",
    rate: { hz: 0, dtMedianMs: 0, dtMaxMs: 0 },
    reportedIntervalMs: null,
    source: "phone",
    config: session.config,
    latest: null,
    extras: EMPTY_EXTRAS,
    lostPackets: null,
  }));
  const [sensor, setSensor] = useState<SensorStatus | "off">("off");
  const [rate, setRate] = useState<RateStats>({
    hz: 0,
    dtMedianMs: 0,
    dtMaxMs: 0,
  });
  const [latest, setLatest] = useState<Sample | null>(null);
  const [lastBreach, setLastBreach] = useState<BreachEvent | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind>("phone");
  const [config, setConfigState] = useState<SessionConfig>(
    () => session.config,
  );

  const sourceRef = useRef<SensorSource | null>(null);
  const meter = useRef(new RateMeter());
  const batch = useRef<TelemetryPoint[]>([]);
  const points = useRef<ChartPoint[]>([]);
  const recBuf = useRef<Sample[]>([]);
  const recordingRef = useRef(false);
  const lastCueAt = useRef(0);
  const latestRef = useRef<Sample | null>(null);
  const sensorRef = useRef<SensorStatus | "off">("off");
  const extras = useRef<DeviceExtrasReader | null>(null);
  const recorder = useRef<SessionRecorder | null>(null);
  // Read inside sample callbacks without re-creating them.
  const meta = useRef({ reporter, device, onSessionEnd });
  useEffect(() => {
    meta.current = { reporter, device, onSessionEnd };
  });

  const buildState = useCallback(
    (): PhoneState => ({
      ...session.snapshot(),
      sensor: sensorRef.current,
      rate: meter.current.stats(),
      reportedIntervalMs:
        sourceRef.current instanceof PhoneSource
          ? sourceRef.current.reportedIntervalMs
          : null,
      source: kindOf(sourceRef.current),
      config: session.config,
      latest: latestRef.current,
      extras: extras.current?.snapshot() ?? EMPTY_EXTRAS,
      lostPackets:
        sourceRef.current instanceof BleSource
          ? sourceRef.current.lostPackets
          : null,
    }),
    [session],
  );

  const publish = useCallback(() => {
    const st = buildState();
    setSnap(st);
    setRate(st.rate);
    setLatest(latestRef.current);
    send("state", st);
  }, [buildState, send]);

  const onSample = useCallback(
    (s: Sample) => {
      meter.current.push(s.t);
      latestRef.current = s;
      if (recordingRef.current) recBuf.current.push(s);

      const r = session.sample(s);
      const snapNow = session.snapshot();
      batch.current.push({
        ...s,
        angleDeg: snapNow.angleDeg,
        velDegS: snapNow.velDegS,
      });
      // Local chart buffer, so the phone can show its own graph without a laptop.
      const pts = points.current;
      pts.push({ t: s.t, v: snapNow.angleDeg });
      while (pts.length && s.t - pts[0].t > CHART_KEEP_MS) pts.shift();

      if (session.phase === "running")
        recorder.current?.sample(
          s.t,
          snapNow.angleDeg,
          snapNow.velDegS,
          !!r.rep,
        );

      if (r.breach) {
        setLastBreach(r.breach);
        recorder.current?.breach(r.breach);
        send("breach", r.breach);
        if (s.t - lastCueAt.current > CUE_GAP_MS) {
          lastCueAt.current = s.t;
          speak(CUES[r.breach.kind]);
          vibrateCue();
        }
      }
      if (r.calibration?.ok) {
        // A new calibration starts a new session record.
        const d = meta.current.device;
        recorder.current = new SessionRecorder({
          id: newId(),
          deviceId: d?.id ?? "unknown",
          deviceLabel: d?.label ?? "unknown",
          exercise: session.config.exercise,
          source: kindOf(sourceRef.current),
          config: session.config,
          batteryStart: extras.current?.snapshot().battery?.level ?? null,
          reportedBy: meta.current.reporter,
        });
      }
      if (r.calibration) {
        setCalibration(r.calibration);
        send("calibration", r.calibration);
        speak(
          r.calibration.ok
            ? "Kalibrasi selesai. Silakan mulai."
            : "HP bergerak. Ulangi kalibrasi.",
        );
        publish();
      }
    },
    [session, send, publish],
  );

  const onStatus = useCallback(
    (st: SensorStatus) => {
      sensorRef.current = st;
      setSensor(st);
      const before = session.phase;
      session.status(st);
      if (st === "lost" && before === "running") {
        speak("Sensor terputus. Latihan dijeda.");
        vibrateCue();
        recorder.current?.pause();
      }
      publish();
    },
    [session, publish],
  );

  // Periodic flush of telemetry and state.
  useEffect(() => {
    const a = setInterval(() => {
      if (batch.current.length) {
        send("telemetry", { points: batch.current });
        batch.current = [];
      }
    }, TELEMETRY_EVERY_MS);
    const b = setInterval(publish, STATE_EVERY_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [send, publish]);

  const start = useCallback(
    async (source: SensorSource) => {
      sourceRef.current?.stop();
      sourceRef.current = source;
      setSourceKind(kindOf(source));
      meter.current.reset();
      source.onSample(onSample);
      source.onStatus(onStatus);
      // Context readings (orientation, battery, ...) only make sense for the phone's own sensors.
      extras.current?.stop();
      extras.current = null;
      if (source instanceof PhoneSource) {
        extras.current = new DeviceExtrasReader();
        extras.current.start();
      }
      await source.start();
    },
    [onSample, onStatus],
  );

  useEffect(
    () => () => {
      sourceRef.current?.stop();
      extras.current?.stop();
    },
    [],
  );

  const finishRecording = useCallback(() => {
    const rec = recorder.current;
    recorder.current = null;
    if (!rec?.hasData) return;
    meta.current.onSessionEnd(
      rec.finish(extras.current?.snapshot().battery?.level ?? null),
    );
  }, []);

  // Stable identity: pages call this from effects (saved settings, config from the screen).
  const setConfig = useCallback(
    (c: SessionConfig) => {
      session.setConfig(c);
      recorder.current?.setConfig(c);
      setConfigState(c);
      publish();
    },
    [session, publish],
  );

  // Keep a breach on screen for a few seconds, then clear it (a new breach restarts the timer).
  useEffect(() => {
    if (!lastBreach) return;
    const id = setTimeout(() => setLastBreach(null), BREACH_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [lastBreach]);

  return {
    snap,
    points,
    config,
    sensor,
    rate,
    latest,
    lastBreach,
    calibration,
    recording,
    sourceKind,
    start,
    calibrate: () => {
      finishRecording(); // re-calibrating mid-session closes the previous record
      setCalibration(null);
      session.beginCalibration();
      publish();
    },
    resume: () => {
      session.resume();
      publish();
    },
    stop: () => {
      session.stop();
      finishRecording();
      publish();
    },
    setConfig,
    startRecording: () => {
      recBuf.current = [];
      recordingRef.current = true;
      setRecording(true);
    },
    stopRecording: (): Recording => {
      recordingRef.current = false;
      setRecording(false);
      return {
        version: 1,
        createdAt: new Date().toISOString(),
        device: navigator.userAgent,
        samples: recBuf.current,
      };
    },
  };
}
