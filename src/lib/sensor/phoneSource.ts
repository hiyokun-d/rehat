// Reads the phone's own motion sensors through the browser `devicemotion` event.
import { BaseSource } from "./baseSource";

export type PermissionResult = "granted" | "denied" | "unsupported";

type IOSMotion = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export class PhoneSource extends BaseSource {
  /** Last `event.interval` the browser reported (ms). Shown next to our own measured rate. */
  reportedIntervalMs: number | null = null;

  /**
   * iOS only grants motion access from inside a user tap, so call this FIRST in the
   * click handler, before any `await`. Android/Chrome has no prompt and returns "granted".
   */
  static async requestPermission(): Promise<PermissionResult> {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window))
      return "unsupported";
    const DME = DeviceMotionEvent as IOSMotion;
    if (typeof DME.requestPermission !== "function") return "granted";
    try {
      return await DME.requestPermission();
    } catch {
      return "denied";
    }
  }

  async start(): Promise<void> {
    window.addEventListener("devicemotion", this.handle);
    this.startWatchdog();
  }

  stop(): void {
    window.removeEventListener("devicemotion", this.handle);
    this.stopWatchdog();
  }

  private handle = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    const r = e.rotationRate;
    // Desktop browsers fire devicemotion with nulls; treat that as "no sample".
    if (
      a?.x == null ||
      a.y == null ||
      a.z == null ||
      r?.alpha == null ||
      r.beta == null ||
      r.gamma == null
    ) {
      return;
    }
    this.reportedIntervalMs = e.interval;
    const lin = e.acceleration; // null on some devices (no fused linear acceleration)
    this.emit({
      t: e.timeStamp || performance.now(),
      ax: a.x,
      ay: a.y,
      az: a.z,
      // Spec: alpha = around z, beta = around x, gamma = around y.
      gx: r.beta,
      gy: r.gamma,
      gz: r.alpha,
      ...(lin?.x != null && lin.y != null && lin.z != null
        ? { lx: lin.x, ly: lin.y, lz: lin.z }
        : {}),
    });
  };
}
