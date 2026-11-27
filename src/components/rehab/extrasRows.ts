// Context readings as label/value rows for RawSampleCard (phone and laptop show the same table).
import type { DeviceExtras } from "@/lib/sensor/deviceExtras";

const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : v.toFixed(0);

/** Context readings as table rows (shared shape with the laptop's raw view). */
export function extrasRows(
  e: DeviceExtras,
  lostPackets: number | null,
): [string, string][] {
  const rows: [string, string][] = [
    [
      "Orientasi α / β / γ (°)",
      e.orientation
        ? `${n0(e.orientation.alpha)} / ${n0(e.orientation.beta)} / ${n0(e.orientation.gamma)}`
        : "–",
    ],
    [
      "Arah kompas (iPhone)",
      e.headingDeg === null ? "–" : `${n0(e.headingDeg)}°`,
    ],
    [
      "Baterai",
      e.battery
        ? `${Math.round(e.battery.level * 100)}%${e.battery.charging ? " (mengisi)" : ""}`
        : "–",
    ],
    ["Layar", e.screen ?? "–"],
    ["Cahaya", e.lightLux === null ? "–" : `${n0(e.lightLux)} lux`],
    [
      "Magnetometer (µT)",
      e.magnetUT
        ? `${n0(e.magnetUT.x)} / ${n0(e.magnetUT.y)} / ${n0(e.magnetUT.z)}`
        : "–",
    ],
  ];
  if (lostPackets !== null)
    rows.push(["Paket BLE hilang", String(lostPackets)]);
  return rows;
}
