// The program bundle the phone holds locally (cached in Dexie), and how its versioned safety
// envelope reaches a session. Limits are the therapist's: the phone never invents one. An
// exercise with no envelope in the cache keeps the local example limits and is labelled as such.
import type { BreachAction, SafetyEnvelope } from "@/lib/rehab/envelope";
import type { SessionConfig } from "@/lib/rehab/session";
import type { Bundle, BundleExercise } from "./client";

export interface BundleCache {
  /** The login this cache belongs to; another account never reads it. */
  userId: string;
  /** Cursor from the last response. Sent back as `?since=` for the next delta. */
  version: number;
  /** By exercise slug. */
  exercises: Record<string, BundleExercise>;
  fetchedAt: number;
}

/**
 * Folds a response into the cache. `full` (a since=0 pull) replaces everything, so an exercise the
 * therapist removed from the program disappears. A delta adds or replaces what changed and drops
 * the ids listed in `removed` (tombstones). Removals run after the upserts and match by id, so an
 * exercise deleted and re-added between two pulls keeps its new row.
 */
export function mergeBundle(
  prev: BundleCache | null,
  userId: string,
  bundle: Bundle,
  full: boolean,
  now = Date.now(),
): BundleCache {
  const keep = !full && prev && prev.userId === userId ? prev : null;
  const exercises = { ...(keep?.exercises ?? {}) };
  for (const e of bundle.exercises) exercises[e.exerciseSlug] = e;
  for (const id of bundle.removed ?? []) {
    for (const [slug, e] of Object.entries(exercises)) {
      if (e.planExerciseId === id) delete exercises[slug];
    }
  }
  return {
    userId,
    version: Math.max(keep?.version ?? 0, bundle.version),
    exercises,
    fetchedAt: now,
  };
}

export interface VersionedEnvelope {
  version: number;
  envelope: SafetyEnvelope;
  onBreach: BreachAction;
  notifyCaregiver: boolean;
}

/** The therapist's current envelope for this exercise, or null when there is none. */
export function envelopeFor(
  cache: BundleCache | null,
  exercise: string,
): VersionedEnvelope | null {
  const e = cache?.exercises[exercise]?.envelope;
  if (!e) return null;
  return {
    version: e.version,
    envelope: {
      maxAngleDeg: e.maxAngleDeg,
      maxVelDegPerS: e.maxVelDegPerS,
      debounceMs: e.debounceMs,
    },
    onBreach: e.onBreach ?? "CUE_ONLY",
    notifyCaregiver: e.notifyCaregiver ?? false,
  };
}

const sameEnvelope = (a: SafetyEnvelope, b: SafetyEnvelope) =>
  a.maxAngleDeg === b.maxAngleDeg &&
  a.maxVelDegPerS === b.maxVelDegPerS &&
  a.debounceMs === b.debounceMs;

// Also compares the breach behavior: a therapist can change onBreach without changing a number.
const sameApplied = (config: SessionConfig, v: VersionedEnvelope) =>
  sameEnvelope(config.envelope, v.envelope) &&
  (config.onBreach ?? "CUE_ONLY") === v.onBreach &&
  (config.notifyCaregiver ?? false) === v.notifyCaregiver;

/** `config` with the cached envelope applied; the same object when nothing changes. */
export function applyBundle(
  config: SessionConfig,
  cache: BundleCache | null,
): SessionConfig {
  const v = envelopeFor(cache, config.exercise);
  if (!v || sameApplied(config, v)) return config;
  return {
    ...config,
    envelope: v.envelope,
    onBreach: v.onBreach,
    notifyCaregiver: v.notifyCaregiver,
  };
}

/**
 * The envelope version a session can honestly claim: the cached one, but only when the limits and
 * breach behavior it ran with ARE that envelope. Limits set by hand or by a screen are not the
 * server's, so no claim (null) and the session stays local.
 */
export function claimedVersion(
  config: SessionConfig,
  cache: BundleCache | null,
): number | null {
  const v = envelopeFor(cache, config.exercise);
  return v && sameApplied(config, v) ? v.version : null;
}
