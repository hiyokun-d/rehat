// Live rooms over Supabase Realtime (works on Vercel; the ws relay in server.mts stays for LAN).
//
// Isolation: one private channel per patient, topic "patient:<id>". The database decides who may
// join (prisma/migrations/20261128000002_realtime_rooms): the patient, their therapist/nurse, or a
// caregiver with an ACTIVE consented link. Two patients never share a channel, so many patients
// exercising at once cannot collide.
// Inside a channel: many phones (one per body placement) + many screens. Every message carries
// the sender's deviceId, so per-phone state never overwrites another phone's.
//
// Message shape stays the prototype's { type, t, payload } plus `from`. Raw sensor streams are
// sent only as short live telemetry and are never stored (AGENTS.md: data minimisation).
import type { Placement } from "./placement";

export const LIVE_EVENT = "m";

export const patientTopic = (patientId: string) => `patient:${patientId}`;

export type LiveRole = "phone" | "screen";

/** What every member announces through Realtime presence. */
export interface LivePeer {
  deviceId: string;
  role: LiveRole;
  label: string;
  placement?: Placement;
  /** Who is signed in on that device: PATIENT, CAREGIVER, THERAPIST (display only). */
  account?: string;
}

export interface LiveMsg<P = unknown> {
  type: string;
  from: string; // deviceId of the sender
  t: number; // sender clock, ms (ordering within one device only)
  payload: P;
}

/**
 * Commands a screen may send to phones. Each one can only make a session SAFER or fresher:
 * pause/stop never resume anything, and "refresh-bundle" makes phones pull the therapist's
 * versioned limits from the server (limits are never pushed over the live channel, because the
 * channel is not versioned or audited).
 */
export type ScreenCommand =
  | { type: "pause"; payload: { to?: string } }
  | { type: "refresh-bundle"; payload: Record<string, never> };

const MAX_TYPE = 64;

/** Defensive parse of anything received from the channel. Returns null for junk. */
export function parseLiveMsg(x: unknown): LiveMsg | null {
  const m = x as LiveMsg;
  if (!m || typeof m !== "object") return null;
  if (typeof m.type !== "string" || !m.type || m.type.length > MAX_TYPE)
    return null;
  if (typeof m.from !== "string" || !m.from || m.from.length > 100) return null;
  if (typeof m.t !== "number" || !Number.isFinite(m.t)) return null;
  if (!m.payload || typeof m.payload !== "object") return null;
  return m;
}

/** Cloud realtime costs per message: send less often than on the LAN relay. */
export const CLOUD_RATES = { telemetryEveryMs: 250, stateEveryMs: 500 };
export const LAN_RATES = { telemetryEveryMs: 100, stateEveryMs: 250 };
