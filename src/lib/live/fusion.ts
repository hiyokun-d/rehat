// Combining several phones on ONE patient. Pure functions; the dashboard calls them on every
// state update. Safety decisions are NOT made here: each phone still checks its own segment
// against the therapist's envelope on the phone itself (edge). Fusion is for the screen to see.
//
// Joint estimate from two segments (EXPERIMENT, labelled as such in the UI):
//   Each phone reports its segment's tilt from its own calibrated start pose. If both segments
//   start in the same pose and rotate in the same plane (a hinge-like joint moving in one plane,
//   e.g. elbow flexion with the upper arm resting), the joint's change from the start pose is
//   distal tilt - proximal tilt.
//   This is the simplest special case of two-IMU joint angles. The general method estimates the
//   joint axis from both gyroscopes and needs no plane assumption (Seel, Raisch, Schauer,
//   "IMU-based joint angle measurement for gait analysis", Sensors 14(4):6891, 2014). That is
//   the upgrade path if the team validates this one and needs more.
//   Known limits: segment tilts are unsigned (>= 0), so a proximal segment moving the "other"
//   way is read wrongly; rotation about gravity (yaw) is invisible without a magnetometer.
//
// Time alignment: phone clocks are not synchronised, so we align on the time the SCREEN received
// each reading. A reading older than MAX_AGE_MS is "stale" and the joint is not shown. Network
// jitter of ~100-300 ms makes this a display, never a safety signal.

import { JOINTS, type JointDef, type Placement, type Side } from "./placement";

/** Older readings are not combined. Tuned for cloud realtime jitter, not from literature. */
export const MAX_AGE_MS = 800;

export interface SegmentReading {
  deviceId: string;
  placement: Placement;
  angleDeg: number;
  /** "running" = calibrated and measuring. Anything else cannot be fused. */
  phase: string;
  /** ms, the screen's own clock when this reading arrived. */
  receivedAt: number;
}

export type JointResult =
  | { status: "ok"; angleDeg: number; proximalDeg: number; distalDeg: number }
  | { status: "missing" | "stale" | "not-running" };

export interface JointView {
  joint: JointDef;
  side: Side;
  result: JointResult;
}

export function fuseJoint(
  proximal: SegmentReading | undefined,
  distal: SegmentReading | undefined,
  now: number,
  maxAgeMs = MAX_AGE_MS,
): JointResult {
  if (!proximal || !distal) return { status: "missing" };
  if (
    now - proximal.receivedAt > maxAgeMs ||
    now - distal.receivedAt > maxAgeMs
  )
    return { status: "stale" };
  if (proximal.phase !== "running" || distal.phase !== "running")
    return { status: "not-running" };
  return {
    status: "ok",
    angleDeg: Math.max(0, distal.angleDeg - proximal.angleDeg),
    proximalDeg: proximal.angleDeg,
    distalDeg: distal.angleDeg,
  };
}

/** Every joint for which at least one of its two segments has a phone on this patient. */
export function jointsFor(
  readings: readonly SegmentReading[],
  now: number,
): JointView[] {
  const at = (seg: string, side: Side) =>
    // Newest reading wins if two phones claim the same segment.
    readings
      .filter((r) => r.placement.segment === seg && r.placement.side === side)
      .sort((a, b) => b.receivedAt - a.receivedAt)[0];
  const out: JointView[] = [];
  for (const joint of JOINTS)
    for (const side of ["L", "R"] as const) {
      const p = at(joint.proximal, side);
      const d = at(joint.distal, side);
      if (!p && !d) continue;
      out.push({ joint, side, result: fuseJoint(p, d, now) });
    }
  return out;
}

/**
 * Two phones on the SAME segment should read the same tilt. A large disagreement means a strap
 * slipped or a phone is misplaced: worth showing, never used to change a limit. Returns the
 * largest pairwise difference per duplicated segment.
 */
export function duplicateDisagreement(
  readings: readonly SegmentReading[],
  now: number,
  maxAgeMs = MAX_AGE_MS,
): { placement: Placement; diffDeg: number; devices: string[] }[] {
  const groups = new Map<string, SegmentReading[]>();
  for (const r of readings) {
    if (r.phase !== "running" || now - r.receivedAt > maxAgeMs) continue;
    const k = `${r.placement.segment}:${r.placement.side}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: { placement: Placement; diffDeg: number; devices: string[] }[] =
    [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const angles = list.map((r) => r.angleDeg);
    out.push({
      placement: list[0].placement,
      diffDeg: Math.max(...angles) - Math.min(...angles),
      devices: list.map((r) => r.deviceId),
    });
  }
  return out;
}
