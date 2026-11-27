// What one exercise session leaves behind, so the patient, a caregiver or a nurse can look at it
// later (not only live) and the therapist can receive it on the laptop.
//
// Data minimization (AGENTS.md: store events and session summaries, not raw sensor streams):
// we keep the summary, each rep's peak, the limit events, and the DERIVED angle downsampled to
// TRACE_HZ for the chart. No raw accelerometer/gyro samples. Raw recordings stay a separate,
// explicit "Rekam" action for testing.
//
// Pure TS (no React, no Dexie) so it is unit-tested with synthetic samples.
import type { SourceKind } from "../sensor/types";
import type { ExerciseId } from "./defaults";
import type { BreachEvent } from "./envelope";
import type { SessionConfig } from "./session";

/** 5 points/s is enough to see each rep's shape; 5 min ≈ 1500 points ≈ 20 KB. Tuned by eye. */
export const TRACE_HZ = 5;
/** A gap between samples longer than this is a pause, not exercise time (= the sensor "lost" rule). */
const GAP_MS = 500;

export type Reporter = "patient" | "caregiver";
export type Difficulty = "mudah" | "sedang" | "sulit";

export interface RepRecord {
  atMs: number; // when the rep finished, ms since session start
  peakDeg: number;
  durMs: number;
}

export interface SessionBreach extends BreachEvent {
  atMs: number;
}

export interface SessionSummary {
  version: 1;
  id: string;
  deviceId: string;
  deviceLabel: string;
  exercise: ExerciseId;
  source: SourceKind;
  startedAt: string; // ISO, wall clock of the phone
  endedAt: string;
  activeMs: number; // time with the sensor running, pauses excluded
  reps: number;
  maxAngleDeg: number;
  maxVelDegS: number;
  repList: RepRecord[];
  breaches: SessionBreach[];
  pauses: number;
  /** The limits in force at the end (set by the therapist, or on the phone in phone-only mode). */
  config: SessionConfig;
  /** [ms since start, angle °], derived angle only. */
  trace: [number, number][];
  /** Battery level 0..1 at start/end when the browser exposes it (Chrome/Android). */
  battery: { start: number; end: number } | null;
  /** AGENTS.md: every log stores who reported it. */
  reportedBy: Reporter;
  difficulty?: Difficulty;
  note?: string;
  /** Phone: when a screen confirmed it has this session. */
  syncedAt?: string;
  /** Screen: when it arrived. */
  receivedAt?: string;
  /** Screen only: the therapist's note (TherapistReview in the domain model). Never sent back. */
  therapistNote?: string;
}

export interface RecorderMeta {
  id: string;
  deviceId: string;
  deviceLabel: string;
  exercise: ExerciseId;
  source: SourceKind;
  config: SessionConfig;
  batteryStart: number | null;
  reportedBy: Reporter;
  startedAt?: Date;
}

export class SessionRecorder {
  private meta: RecorderMeta;
  private startedAt: Date;
  private t0: number | null = null;
  private lastT: number | null = null;
  private lastTraceT = -Infinity;
  private activeMs = 0;
  private maxAngleDeg = 0;
  private maxVelDegS = 0;
  private repList: RepRecord[] = [];
  private breaches: SessionBreach[] = [];
  private pauses = 0;
  private trace: [number, number][] = [];
  private repPeak = 0;
  private repStart: number | null = null;

  constructor(meta: RecorderMeta) {
    this.meta = meta;
    this.startedAt = meta.startedAt ?? new Date();
  }

  /** Feed every sample while the session is running (after the filter). */
  sample(t: number, angleDeg: number, velDegS: number, rep: boolean): void {
    this.t0 ??= t;
    if (this.lastT !== null) {
      const dt = t - this.lastT;
      if (dt > 0 && dt < GAP_MS) this.activeMs += dt;
    }
    this.lastT = t;
    const at = t - this.t0;
    this.maxAngleDeg = Math.max(this.maxAngleDeg, angleDeg);
    this.maxVelDegS = Math.max(this.maxVelDegS, velDegS);

    // A rep starts when the angle leaves the "down" zone and ends when the counter says so.
    const down = this.meta.config.reps.downDeg;
    if (this.repStart === null && angleDeg > down) {
      this.repStart = at;
      this.repPeak = 0;
    }
    if (this.repStart !== null) this.repPeak = Math.max(this.repPeak, angleDeg);
    if (rep) {
      this.repList.push({
        atMs: at,
        peakDeg: round1(this.repPeak),
        durMs: Math.round(at - (this.repStart ?? at)),
      });
      this.repStart = null;
    }

    if (t - this.lastTraceT >= 1000 / TRACE_HZ) {
      this.lastTraceT = t;
      this.trace.push([Math.round(at), round1(angleDeg)]);
    }
  }

  breach(b: BreachEvent): void {
    this.breaches.push({ ...b, atMs: this.t0 === null ? 0 : b.t - this.t0 });
  }

  pause(): void {
    this.pauses++;
  }

  /** Limits can change mid-session; the summary keeps the latest. */
  setConfig(config: SessionConfig): void {
    this.meta = { ...this.meta, config };
  }

  get hasData(): boolean {
    return this.trace.length > 0;
  }

  finish(batteryEnd: number | null, endedAt = new Date()): SessionSummary {
    const m = this.meta;
    return {
      version: 1,
      id: m.id,
      deviceId: m.deviceId,
      deviceLabel: m.deviceLabel,
      exercise: m.exercise,
      source: m.source,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      activeMs: Math.round(this.activeMs),
      reps: this.repList.length,
      maxAngleDeg: round1(this.maxAngleDeg),
      maxVelDegS: round1(this.maxVelDegS),
      repList: this.repList,
      breaches: this.breaches,
      pauses: this.pauses,
      config: m.config,
      trace: this.trace,
      battery:
        m.batteryStart !== null && batteryEnd !== null
          ? { start: m.batteryStart, end: batteryEnd }
          : null,
      reportedBy: m.reportedBy,
    };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function isSessionSummary(x: unknown): x is SessionSummary {
  const s = x as SessionSummary;
  return (
    s?.version === 1 &&
    typeof s.id === "string" &&
    Array.isArray(s.trace) &&
    typeof s.startedAt === "string"
  );
}

/** Export file: one JSON with many sessions, so it can travel by WhatsApp/email/USB. */
export interface SessionExport {
  kind: "rehat-sessions";
  version: 1;
  exportedAt: string;
  sessions: SessionSummary[];
}

export function makeExport(sessions: SessionSummary[]): SessionExport {
  return {
    kind: "rehat-sessions",
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessions.map(({ syncedAt: _s, receivedAt: _r, ...rest }) => rest),
  };
}

/** Accepts an export file or a bare array; drops anything that is not a session. */
export function parseImport(data: unknown): SessionSummary[] {
  const list = Array.isArray(data)
    ? data
    : (data as SessionExport)?.kind === "rehat-sessions"
      ? (data as SessionExport).sessions
      : [];
  return list.filter(isSessionSummary);
}
