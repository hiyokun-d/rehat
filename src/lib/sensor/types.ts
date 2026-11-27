/** One motion reading. Units follow the DeviceMotion spec. */
export interface Sample {
  t: number; // ms, monotonic clock of the device that produced it
  ax: number; // accelerationIncludingGravity, m/s²
  ay: number;
  az: number;
  gx: number; // rotationRate around device x (spec: beta), °/s
  gy: number; // around y (spec: gamma), °/s
  gz: number; // around z (spec: alpha), °/s
  // Optional: acceleration WITHOUT gravity (DeviceMotion `acceleration`), m/s². Shown and
  // recorded for analysis only; safety logic never uses it (and we never integrate it).
  lx?: number;
  ly?: number;
  lz?: number;
}

export type SensorStatus = "ok" | "lost";

/** Where samples come from. Only shown to people; the pipeline never branches on it. */
export type SourceKind = "phone" | "replay" | "ble";

/** Everything after this interface must not know where samples come from. */
export interface SensorSource {
  start(): Promise<void>;
  stop(): void;
  onSample(cb: (s: Sample) => void): void;
  onStatus(cb: (s: SensorStatus) => void): void;
}

/** "lost" = no sample for longer than this. From the brief, not from literature. */
export const LOST_AFTER_MS = 500;
