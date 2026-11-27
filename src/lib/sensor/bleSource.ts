// Tier 1 (EXPERIMENT): samples from an ESP32 + MPU6050 over Web Bluetooth.
// Works in Chrome on Android, Windows, macOS, ChromeOS. Not in any iPhone browser (Safari has no
// Web Bluetooth). Web Bluetooth cannot link the phone to the laptop: it only talks to BLE
// peripherals, so the phone <-> laptop link stays on the Wi-Fi relay.
// The firmware does not exist yet; the UUIDs below are ours and the firmware must use them.
import { BaseSource } from "./baseSource";
import { decodePacket, seqGap } from "./blePacket";

export const REHAT_SERVICE = "8f1d0000-5c3a-4a8e-9b1e-7a2f6c0d4e01";
export const STREAM_CHAR = "8f1d0001-5c3a-4a8e-9b1e-7a2f6c0d4e01"; // Notify, 18-byte packets
export const CONTROL_CHAR = "8f1d0002-5c3a-4a8e-9b1e-7a2f6c0d4e01"; // Write: start/stop/...

// Minimal shapes of the Web Bluetooth objects we touch (not in TypeScript's DOM lib).
interface Characteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<Characteristic>;
  stopNotifications(): Promise<Characteristic>;
  writeValue(v: BufferSource): Promise<void>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<Characteristic>;
      }>;
    }>;
    disconnect(): void;
  };
}
type Bluetooth = {
  requestDevice(opts: {
    filters: { services: string[] }[];
  }): Promise<BleDevice>;
};

export function hasWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export class BleSource extends BaseSource {
  deviceName: string | null = null;
  /** Packets lost in transit (from seq gaps). Loose jumpers or range show up here first. */
  lostPackets = 0;
  private device: BleDevice | null = null;
  private stream: Characteristic | null = null;
  private lastSeq: number | null = null;
  // Device ms -> page ms. The ESP32 clock is not ours; anchor its first packet to now.
  private offset: number | null = null;

  /** Must be called from a user tap (the browser shows a device chooser). */
  async start(): Promise<void> {
    const bt = (navigator as unknown as { bluetooth: Bluetooth }).bluetooth;
    this.device ??= await bt.requestDevice({
      filters: [{ services: [REHAT_SERVICE] }],
    });
    this.deviceName = this.device.name ?? null;
    const server = await this.device.gatt?.connect();
    if (!server) throw new Error("GATT tidak tersedia");
    const svc = await server.getPrimaryService(REHAT_SERVICE);
    this.stream = await svc.getCharacteristic(STREAM_CHAR);
    this.stream.addEventListener("characteristicvaluechanged", this.onValue);
    await this.stream.startNotifications();
    // Disconnect = no more samples = the watchdog reports "lost" -> session pauses.
    this.startWatchdog();
    const control = await svc.getCharacteristic(CONTROL_CHAR).catch(() => null);
    await control?.writeValue(new TextEncoder().encode("start"));
  }

  stop(): void {
    this.stopWatchdog();
    this.stream?.removeEventListener(
      "characteristicvaluechanged",
      this.onValue,
    );
    this.stream?.stopNotifications().catch(() => {});
    this.device?.gatt?.disconnect();
    this.stream = null;
    this.lastSeq = null;
    this.offset = null;
  }

  private onValue = (e: Event) => {
    const view = (e.target as Characteristic).value;
    const p = view && decodePacket(view);
    if (!p) return;
    this.lostPackets += seqGap(this.lastSeq, p.seq);
    this.lastSeq = p.seq;
    this.offset ??= performance.now() - p.sample.t;
    this.emit({ ...p.sample, t: p.sample.t + this.offset });
  };
}
