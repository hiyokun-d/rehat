// Plays a recorded JSON file back with its original timing, so the whole pipeline can be
// tested (and demoed) without a phone. Timestamps are re-based to this device's clock.
import { BaseSource } from "./baseSource";
import type { Recording } from "./recording";

export class ReplaySource extends BaseSource {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private i = 0;
  private t0 = 0;

  private rec: Recording;
  private opts: { loop?: boolean; speed?: number };

  constructor(rec: Recording, opts: { loop?: boolean; speed?: number } = {}) {
    super();
    this.rec = rec;
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.rec.samples.length === 0) throw new Error("Rekaman kosong");
    this.i = 0;
    this.t0 = performance.now();
    this.startWatchdog();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopWatchdog();
  }

  private tick = () => {
    const { samples } = this.rec;
    const speed = this.opts.speed ?? 1;
    const first = samples[0].t;
    const now = performance.now();
    // Emit every sample whose (scaled) time has come, then sleep until the next one.
    while (
      this.i < samples.length &&
      (samples[this.i].t - first) / speed <= now - this.t0
    ) {
      const s = samples[this.i++];
      this.emit({ ...s, t: this.t0 + (s.t - first) / speed });
    }
    if (this.i >= samples.length) {
      if (!this.opts.loop) return; // no more data -> the watchdog reports "lost", as it should
      this.i = 0;
      this.t0 = performance.now();
    }
    const wait =
      (samples[this.i].t - first) / speed - (performance.now() - this.t0);
    this.timer = setTimeout(this.tick, Math.max(0, wait));
  };
}
