// Slow, secondary readings next to the motion stream: orientation, compass, battery, screen
// orientation, and the optional Generic Sensor API sensors (magnetometer, ambient light).
// None of these feed safety logic. They are context for whoever reads the data later
// (was the phone upside down? did the battery die?) and they answer an open question in
// AGENTS.md: battery draw per session is not measured yet. See docs/SENSORS.md.

export interface DeviceExtras {
  /** deviceorientation, degrees. alpha = compass-ish (unreliable without a magnetometer). */
  orientation: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean;
  } | null;
  /** iOS only (webkitCompassHeading), degrees from magnetic north. */
  headingDeg: number | null;
  /** Battery Status API (Chrome/Android only). level 0..1. */
  battery: { level: number; charging: boolean } | null;
  /** screen.orientation.type, e.g. "portrait-primary". */
  screen: string | null;
  /** Generic Sensor API, behind a Chrome flag on most phones. */
  lightLux: number | null;
  magnetUT: { x: number; y: number; z: number } | null;
}

export const EMPTY_EXTRAS: DeviceExtras = {
  orientation: null,
  headingDeg: null,
  battery: null,
  screen: null,
  lightLux: null,
  magnetUT: null,
};

type IOSOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};
type IOSOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};
interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}
// Generic Sensor API classes are not in TypeScript's DOM lib.
interface GenericSensor extends EventTarget {
  start(): void;
  stop(): void;
}
type SensorCtor<T> = new (opts?: { frequency?: number }) => GenericSensor & T;

/** Extras are "nice to have": every listener is optional and every failure is silent. */
export class DeviceExtrasReader {
  private state: DeviceExtras = { ...EMPTY_EXTRAS };
  private cleanups: (() => void)[] = [];

  /** iOS: like motion, orientation needs its own prompt from inside a tap. Start it in the same tap. */
  static async requestPermission(): Promise<void> {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window))
      return;
    const DOE = DeviceOrientationEvent as IOSOrientation;
    if (typeof DOE.requestPermission === "function")
      await DOE.requestPermission().catch(() => "denied");
  }

  start(): void {
    this.stop();
    const onOrient = (e: DeviceOrientationEvent) => {
      this.state.orientation = {
        alpha: e.alpha,
        beta: e.beta,
        gamma: e.gamma,
        absolute: e.absolute,
      };
      const h = (e as IOSOrientationEvent).webkitCompassHeading;
      if (typeof h === "number") this.state.headingDeg = h;
    };
    window.addEventListener("deviceorientation", onOrient);
    this.cleanups.push(() =>
      window.removeEventListener("deviceorientation", onOrient),
    );

    const onScreen = () => {
      this.state.screen = screen.orientation?.type ?? null;
    };
    onScreen();
    screen.orientation?.addEventListener("change", onScreen);
    this.cleanups.push(() =>
      screen.orientation?.removeEventListener("change", onScreen),
    );

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    nav
      .getBattery?.()
      .then((b) => {
        const read = () => {
          this.state.battery = { level: b.level, charging: b.charging };
        };
        read();
        b.addEventListener("levelchange", read);
        b.addEventListener("chargingchange", read);
        this.cleanups.push(() => {
          b.removeEventListener("levelchange", read);
          b.removeEventListener("chargingchange", read);
        });
      })
      .catch(() => {});

    // 2 Hz is plenty for context values; higher only costs battery.
    this.generic<{ illuminance: number }>("AmbientLightSensor", (s) => {
      this.state.lightLux = s.illuminance;
    });
    this.generic<{ x: number; y: number; z: number }>("Magnetometer", (s) => {
      this.state.magnetUT = { x: s.x, y: s.y, z: s.z };
    });
  }

  stop(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  snapshot(): DeviceExtras {
    return {
      ...this.state,
      orientation: this.state.orientation && { ...this.state.orientation },
    };
  }

  private generic<T>(name: string, read: (s: T) => void): void {
    const Ctor = (window as unknown as Record<string, SensorCtor<T>>)[name];
    if (typeof Ctor !== "function") return;
    try {
      const s = new Ctor({ frequency: 2 });
      const onReading = () => read(s);
      s.addEventListener("reading", onReading);
      s.addEventListener("error", () => s.stop()); // permission denied / no hardware
      s.start();
      this.cleanups.push(() => {
        s.removeEventListener("reading", onReading);
        s.stop();
      });
    } catch {
      // SecurityError (permissions policy) or the sensor does not exist: just skip it.
    }
  }
}

export type CapabilityStatus = "yes" | "no" | "flag";

export interface Capability {
  id: string;
  label: string;
  status: CapabilityStatus;
  use: string; // what Rehat does with it, in plain words
}

/**
 * What this browser offers, by feature detection (never by user-agent guessing).
 * "flag" = the API exists in Chrome but only behind chrome://flags on most phones.
 */
export function detectCapabilities(): Capability[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as Record<string, unknown>;
  const nav = navigator as unknown as Record<string, unknown>;
  const has = (o: Record<string, unknown>, k: string) => k in o;
  const yn = (b: boolean): CapabilityStatus => (b ? "yes" : "no");
  const flag = (k: string): CapabilityStatus => (has(w, k) ? "yes" : "flag");
  return [
    {
      id: "motion",
      label: "Akselerometer + giroskop",
      status: yn(has(w, "DeviceMotionEvent")),
      use: "Sudut dan kecepatan lengan (inti keamanan).",
    },
    {
      id: "orientation",
      label: "Orientasi HP",
      status: yn(has(w, "DeviceOrientationEvent")),
      use: "Konteks: posisi HP terpasang. Tidak dipakai untuk batas.",
    },
    {
      id: "linear",
      label: "Akselerasi tanpa gravitasi",
      status: yn(has(w, "DeviceMotionEvent")),
      use: "Grafik guncangan/getaran. Tidak diintegrasi jadi jarak.",
    },
    {
      id: "generic",
      label: "Generic Sensor API",
      status: yn(has(w, "Accelerometer") && has(w, "Gyroscope")),
      use: "Alternatif devicemotion di Chrome. Belum dipakai.",
    },
    {
      id: "magnet",
      label: "Magnetometer",
      status: flag("Magnetometer"),
      use: "Konteks arah. Hanya Chrome dengan flag.",
    },
    {
      id: "light",
      label: "Sensor cahaya",
      status: flag("AmbientLightSensor"),
      use: "Konteks: ruangan gelap. Hanya Chrome dengan flag.",
    },
    {
      id: "vibrate",
      label: "Getar",
      status: yn(has(nav, "vibrate")),
      use: "Isyarat L1 saat melewati batas (Android). iPhone: suara saja.",
    },
    {
      id: "battery",
      label: "Baterai",
      status: yn(has(nav, "getBattery")),
      use: "Ukur pemakaian baterai per sesi.",
    },
    {
      id: "wakelock",
      label: "Layar tetap menyala",
      status: yn(has(nav, "wakeLock")),
      use: "Mencegah layar terkunci saat latihan.",
    },
    {
      id: "speech",
      label: "Suara (text-to-speech)",
      status: yn(has(w, "speechSynthesis")),
      use: "Isyarat suara.",
    },
    {
      id: "camera",
      label: "Kamera",
      status: yn(typeof navigator.mediaDevices?.getUserMedia === "function"),
      use: "Pindai QR (dan Mode 2).",
    },
    {
      id: "qr",
      label: "Pembaca QR bawaan",
      status: yn(has(w, "BarcodeDetector")),
      use: "Pindai QR di dalam aplikasi. iPhone: pakai aplikasi Kamera.",
    },
    {
      id: "bluetooth",
      label: "Web Bluetooth",
      status: yn(has(nav, "bluetooth")),
      use: "Sensor ESP32 (Tier 1, eksperimen). Tidak ada di iPhone.",
    },
    {
      id: "share",
      label: "Bagikan file",
      status: yn(typeof navigator.canShare === "function"),
      use: "Kirim riwayat lewat WhatsApp/email tanpa laptop.",
    },
  ];
}
