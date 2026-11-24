// Shared plumbing for every SensorSource: callback lists and the "lost" watchdog.
// The watchdog is why a sleeping phone, a background tab or a revoked permission all end
// up as the same thing downstream: no samples for LOST_AFTER_MS -> status "lost".
import {
  LOST_AFTER_MS,
  type Sample,
  type SensorSource,
  type SensorStatus,
} from "./types";

export abstract class BaseSource implements SensorSource {
  private sampleCbs: ((s: Sample) => void)[] = [];
  private statusCbs: ((s: SensorStatus) => void)[] = [];
  private status: SensorStatus | null = null;
  private lastSampleAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  abstract start(): Promise<void>;
  abstract stop(): void;

  onSample(cb: (s: Sample) => void): void {
    this.sampleCbs.push(cb);
  }

  onStatus(cb: (s: SensorStatus) => void): void {
    this.statusCbs.push(cb);
  }

  protected startWatchdog(): void {
    this.lastSampleAt = performance.now();
    this.status = null;
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastSampleAt > LOST_AFTER_MS)
        this.setStatus("lost");
    }, 100);
  }

  protected stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  protected emit(s: Sample): void {
    this.lastSampleAt = performance.now();
    this.setStatus("ok");
    for (const cb of this.sampleCbs) cb(s);
  }

  protected setStatus(s: SensorStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }
}
