// Measures the REAL sample rate from timestamps over a sliding window. Phones differ a lot
// (iPhone Safari ~60 Hz, many Androids 50-200 Hz, some throttle when the battery is low),
// so we never assume a rate.
const WINDOW_MS = 2000; // long enough to smooth jitter, short enough to show throttling quickly

export interface RateStats {
  hz: number; // samples per second over the window
  dtMedianMs: number;
  dtMaxMs: number; // largest gap: spikes here explain "lost" events
}

export class RateMeter {
  private ts: number[] = [];

  push(t: number): void {
    this.ts.push(t);
    while (this.ts.length > 2 && t - this.ts[0] > WINDOW_MS) this.ts.shift();
  }

  stats(): RateStats {
    const n = this.ts.length;
    if (n < 2) return { hz: 0, dtMedianMs: 0, dtMaxMs: 0 };
    const dts = this.ts.slice(1).map((t, i) => t - this.ts[i]);
    const sorted = [...dts].sort((a, b) => a - b);
    return {
      hz: ((n - 1) * 1000) / (this.ts[n - 1] - this.ts[0]),
      dtMedianMs: sorted[Math.floor(sorted.length / 2)],
      dtMaxMs: sorted[sorted.length - 1],
    };
  }

  reset(): void {
    this.ts = [];
  }
}
