// A stable, anonymous id for this browser, so a laptop can tell sessions from two phones apart
// and sync stays idempotent. Random, not derived from the device; no name, no account.
import { getDb } from "./db";

const KEY = "device-id";

export interface DeviceIdentity {
  id: string;
  label: string; // "Android · Chrome", for people; never used for logic
}

export function newId(): string {
  // randomUUID needs a secure context: true on https:// and localhost, which is all we serve.
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function deviceLabel(ua = navigator.userAgent): string {
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "Perangkat";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const db = getDb();
  let id = (await db.settings.get(KEY))?.value as string | undefined;
  if (!id) {
    id = newId();
    await db.settings.put({ key: KEY, value: id });
  }
  return { id, label: deviceLabel() };
}
