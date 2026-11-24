// The Mode 1 session state machine, with no React and no browser APIs so it can be tested
// with recorded or synthetic samples. The phone page feeds it samples and sensor status and
// reacts to what it returns (speak, send to screen).
//
//   idle --calibrate--> calibrating --ok--> running <--resume-- paused
//                           |fail                  \--sensor lost--^
//                           v
//                          idle
import type { Sample, SensorStatus } from "../sensor/types";
import {
  angleBetweenDeg,
  type CalibrationResult,
  calibrate,
  TiltFilter,
} from "./angle";
import {
  CALIBRATION_MS,
  CALIBRATION_RESET_DEG,
  CALIBRATION_TIMEOUT_MS,
  EXAMPLE_ENVELOPE,
  EXAMPLE_REPS,
  type ExerciseId,
} from "./defaults";
import {
  type BreachEvent,
  EnvelopeChecker,
  type SafetyEnvelope,
} from "./envelope";
import { type RepConfig, RepCounter } from "./reps";

export type Phase = "idle" | "calibrating" | "running" | "paused";

export interface SessionConfig {
  exercise: ExerciseId;
  envelope: SafetyEnvelope;
  reps: RepConfig;
}

export const DEFAULT_CONFIG: SessionConfig = {
  exercise: "shoulder-flexion",
  envelope: EXAMPLE_ENVELOPE,
  reps: EXAMPLE_REPS,
};

export interface SessionSnapshot {
  phase: Phase;
  angleDeg: number;
  tiltDeg: number;
  velDegS: number;
  reps: number;
  maxAngleDeg: number;
  gyroSign: 1 | -1 | 0;
  calibrationProgress: number; // 0..1 while calibrating
}

export interface StepResult {
  breach?: BreachEvent;
  rep?: boolean;
  calibration?: CalibrationResult;
}

export class RehabSession {
  phase: Phase = "idle";
  config: SessionConfig;
  private filter: TiltFilter | null = null;
  private reps: RepCounter;
  private envelope: EnvelopeChecker;
  private calibBuf: Sample[] = [];
  private calibStart: number | null = null;
  private last = { angleDeg: 0, tiltDeg: 0, velDegS: 0 };
  private maxAngleDeg = 0;

  constructor(config: SessionConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.reps = new RepCounter(config.reps);
    this.envelope = new EnvelopeChecker(config.envelope);
  }

  /** Limits can change mid-session (therapist moves a slider); counters are kept. */
  setConfig(config: SessionConfig): void {
    this.config = config;
    this.reps.cfg = config.reps;
    this.envelope.env = config.envelope;
  }

  beginCalibration(): void {
    this.phase = "calibrating";
    this.calibBuf = [];
    this.calibStart = null;
  }

  sample(s: Sample): StepResult {
    if (this.phase === "calibrating") return this.collectCalibration(s);
    if (this.phase !== "running" || !this.filter) return {};

    this.last = this.filter.update(s);
    this.maxAngleDeg = Math.max(this.maxAngleDeg, this.last.angleDeg);
    const rep = this.reps.update(this.last.angleDeg);
    const breach =
      this.envelope.update(s.t, this.last.angleDeg, this.last.velDegS) ??
      undefined;
    return { rep, breach };
  }

  /** Not monitored = not safe: losing the sensor always pauses. */
  status(st: SensorStatus): void {
    if (st !== "lost") return;
    if (this.phase === "running") this.phase = "paused";
    if (this.phase === "calibrating") this.phase = "idle";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "running";
  }

  stop(): void {
    this.phase = "idle";
    this.filter = null;
  }

  snapshot(): SessionSnapshot {
    // Progress = length of the current steady streak; it drops back when the arm moves.
    const buf = this.calibBuf;
    const progress =
      this.phase === "calibrating" && buf.length > 1
        ? Math.min(1, (buf[buf.length - 1].t - buf[0].t) / CALIBRATION_MS)
        : 0;
    return {
      phase: this.phase,
      ...this.last,
      reps: this.reps.count,
      maxAngleDeg: this.maxAngleDeg,
      gyroSign: this.filter?.gyroSign ?? 0,
      calibrationProgress: progress,
    };
  }

  private collectCalibration(s: Sample): StepResult {
    this.calibStart ??= s.t;
    const buf = this.calibBuf;
    // A clear movement restarts the steady streak (instead of failing the whole calibration).
    if (buf.length) {
      const mean = buf.reduce(
        (a, x) => ({ x: a.x + x.ax, y: a.y + x.ay, z: a.z + x.az }),
        { x: 0, y: 0, z: 0 },
      );
      if (
        angleBetweenDeg({ x: s.ax, y: s.ay, z: s.az }, mean) >
        CALIBRATION_RESET_DEG
      )
        buf.length = 0;
    }
    buf.push(s);
    while (buf.length && s.t - buf[0].t > CALIBRATION_MS) buf.shift(); // sliding window

    const timedOut = s.t - this.calibStart > CALIBRATION_TIMEOUT_MS;
    if (buf[buf.length - 1].t - buf[0].t < CALIBRATION_MS * 0.97 && !timedOut)
      return {};
    const calibration = calibrate(buf);
    if (!calibration.ok && !timedOut) return {}; // keep sliding: a steadier 3 s may follow
    if (calibration.ok) {
      this.filter = new TiltFilter(calibration.g0);
      this.reps = new RepCounter(this.config.reps);
      this.envelope = new EnvelopeChecker(this.config.envelope);
      this.maxAngleDeg = 0;
      this.last = { angleDeg: 0, tiltDeg: 0, velDegS: 0 };
      this.phase = "running";
    } else {
      this.phase = "idle";
    }
    return { calibration };
  }
}
