// Decoder for the ESP32 sensor packet (AGENTS.md, Option A, one IMU per node):
//   seq u16 | tMs u32 | ax ay az i16 | gx gy gz i16   = 18 bytes, little-endian.
// Pure function so it is unit-tested and shared by BleSource and tests (and later the app).
// Tier 1 hardware does not exist yet: the scale factors below must match the firmware config.
import type { Sample } from "./types";

export const PACKET_BYTES = 18;

/**
 * MPU6050 defaults, from the datasheet: ±2 g range = 16384 LSB/g, ±250 °/s = 131 LSB/(°/s).
 * If the firmware changes the range, change these (or send the range in the Status char).
 */
export const ACCEL_LSB_PER_G = 16384;
export const GYRO_LSB_PER_DPS = 131;
const G = 9.80665; // m/s² per g, to match DeviceMotion units

export interface DecodedPacket {
  seq: number;
  sample: Sample;
}

export function decodePacket(view: DataView): DecodedPacket | null {
  if (view.byteLength < PACKET_BYTES) return null;
  const i16 = (o: number) => view.getInt16(o, true);
  const a = (o: number) => (i16(o) / ACCEL_LSB_PER_G) * G;
  const g = (o: number) => i16(o) / GYRO_LSB_PER_DPS;
  return {
    seq: view.getUint16(0, true),
    sample: {
      t: view.getUint32(2, true),
      ax: a(6),
      ay: a(8),
      az: a(10),
      gx: g(12),
      gy: g(14),
      gz: g(16),
    },
  };
}

/** Packets missing between two sequence numbers (u16 wraps at 65536). */
export function seqGap(prev: number | null, seq: number): number {
  if (prev === null) return 0;
  return (seq - prev - 1 + 0x10000) % 0x10000;
}

/** Inverse of decodePacket, used by tests (and a future firmware simulator). */
export function encodePacket(seq: number, s: Sample): ArrayBuffer {
  const buf = new ArrayBuffer(PACKET_BYTES);
  const v = new DataView(buf);
  const ai = (x: number) => Math.round((x / G) * ACCEL_LSB_PER_G);
  const gi = (x: number) => Math.round(x * GYRO_LSB_PER_DPS);
  v.setUint16(0, seq, true);
  v.setUint32(2, s.t >>> 0, true);
  const vals = [ai(s.ax), ai(s.ay), ai(s.az), gi(s.gx), gi(s.gy), gi(s.gz)];
  for (const [i, n] of vals.entries()) v.setInt16(6 + i * 2, n, true);
  return buf;
}
