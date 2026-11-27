// Mode 1 messages between phone and screen (relayed as-is by the server).
// The phone does all safety logic (edge); the screen only displays and sends config.

import type { Capability, DeviceExtras } from "../sensor/deviceExtras";
import type { RateStats } from "../sensor/rateMeter";
import type { Recording } from "../sensor/recording";
import type { Sample, SensorStatus, SourceKind } from "../sensor/types";
import type { CalibrationResult } from "./angle";
import type { BreachEvent } from "./envelope";
import type { SessionConfig, SessionSnapshot } from "./session";
import type { SessionSummary } from "./summary";

export interface TelemetryPoint extends Sample {
  angleDeg: number;
  velDegS: number;
}

export interface PhoneState extends SessionSnapshot {
  sensor: SensorStatus | "off";
  rate: RateStats;
  reportedIntervalMs: number | null;
  source: SourceKind;
  config: SessionConfig;
  latest: Sample | null;
  extras: DeviceExtras;
  /** BLE only: packets lost in transit (seq gaps). */
  lostPackets: number | null;
}

export interface PhoneInfo {
  userAgent: string;
  hasIndonesianVoice: boolean;
  deviceId: string;
  deviceLabel: string;
  capabilities: Capability[];
}

export type PhonePayloads = {
  hello: PhoneInfo;
  telemetry: { points: TelemetryPoint[] };
  state: PhoneState;
  breach: BreachEvent;
  calibration: CalibrationResult;
  recording: Recording;
  /** History sync: sessions the screen does not have yet (or one that just finished/changed). */
  sessions: { sessions: SessionSummary[] };
};

// History sync, idempotent by session id:
//   phone joins -> "hello" -> screen answers "sync-request" with the ids it already has from
//   this device -> phone sends the rest -> screen stores them and answers "sessions-ack" ->
//   phone marks them synced. A finished or edited session is sent again; the screen upserts.
export type ScreenPayloads = {
  config: SessionConfig;
  "sync-request": { deviceId: string; have: string[] };
  "sessions-ack": { ids: string[] };
};
