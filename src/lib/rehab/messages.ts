// Mode 1 messages between phone and screen (relayed as-is by the server).
// The phone does all safety logic (edge); the screen only displays and sends config.
import type { RateStats } from "../sensor/rateMeter";
import type { Recording } from "../sensor/recording";
import type { Sample, SensorStatus } from "../sensor/types";
import type { CalibrationResult } from "./angle";
import type { BreachEvent } from "./envelope";
import type { SessionConfig, SessionSnapshot } from "./session";

export interface TelemetryPoint extends Sample {
  angleDeg: number;
  velDegS: number;
}

export interface PhoneState extends SessionSnapshot {
  sensor: SensorStatus | "off";
  rate: RateStats;
  reportedIntervalMs: number | null;
  source: "phone" | "replay";
  config: SessionConfig;
  latest: Sample | null;
}

export interface PhoneInfo {
  userAgent: string;
  hasIndonesianVoice: boolean;
}

export type PhonePayloads = {
  hello: PhoneInfo;
  telemetry: { points: TelemetryPoint[] };
  state: PhoneState;
  breach: BreachEvent;
  calibration: CalibrationResult;
  recording: Recording;
};

export type ScreenPayloads = {
  config: SessionConfig;
};
