// The program + safety envelope bundle the phone pulls to know its limits (F3 / K4).
//
// The phone treats the envelope version stored for an exercise as the source of limits for a
// session (dossier: "envelope used = last version stored locally"). GET /api/bundle?since=<cursor>
// returns the plan exercises that changed since the last pull, so the phone can fetch only the
// delta. `since` omitted or 0 returns the full set.
//
// Cursor (K4): the bundle's top-level `version` is a global marker, the newest `updatedAt` among the
// patient's programs and plan exercises, in ms since epoch. It is NOT an envelope version: each
// exercise carries its own `envelope.version`. A timestamp is used because an exercise can change
// without a new envelope (added, removed, moved), and a phone holding only envelope versions would
// never learn about those changes.
//
// Deletions travel as tombstones (`removed`: plan exercise ids). A delta pull removes them from the
// phone's cache; without them a deleted exercise would stay on the phone forever, since it simply
// stops appearing in the response.
//
// Limits are the therapist's (AGENTS.md): the server never fills in a default. A plan exercise
// with no envelope yet is returned without limits, so the phone can show "belum ada batas" rather
// than inventing one.
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";
import type { BreachAction } from "@/lib/rehab/envelope";

/** `?since=` is a cursor in ms since epoch; anything invalid is treated as 0 (full bundle). */
const MAX_TIME_MS = Date.parse("9999-12-31T23:59:59.999Z");
export const sinceSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(MAX_TIME_MS)
  .catch(0);

export interface BundleEnvelope {
  version: number;
  maxAngleDeg: number;
  maxVelDegPerS: number;
  debounceMs: number;
  onBreach: BreachAction;
  notifyCaregiver: boolean;
}

export interface BundleExercise {
  planExerciseId: string;
  exerciseSlug: string;
  exerciseName: string;
  position: number;
  /** Null while the therapist has not set a limit for this exercise yet. */
  envelope: BundleEnvelope | null;
}

export interface Bundle {
  /** Cursor: newest change among this patient's programs and plan exercises (ms since epoch). */
  version: number;
  exercises: BundleExercise[];
  /** Plan exercise ids removed since `since`; empty on a full pull. */
  removed: string[];
}

/** The real Prisma client. Tests pass an in-memory fake cast through `unknown`, as invites.ts does. */
export type BundleDb = typeof prisma;

type Tombstone = { id: string; rowAt: Date; programAt: Date };

/**
 * Ids of plan exercises that are no longer live: soft-deleted, or belonging to an inactive or
 * soft-deleted program. The Prisma client's soft-delete extension hides soft-deleted PlanExercise
 * rows from every normal read (by design), so this one query bypasses it. It selects ids and
 * timestamps only, never health values, and only runs on a delta pull.
 */
async function tombstonesSince(
  db: BundleDb,
  patientId: string,
  since: Date,
): Promise<Tombstone[]> {
  return db.$queryRaw<Tombstone[]>`
    SELECT pe."id" AS "id",
           pe."updatedAt" AS "rowAt",
           p."updatedAt" AS "programAt"
    FROM "PlanExercise" pe
    JOIN "Program" p ON p."id" = pe."programId"
    WHERE p."patientId" = ${patientId}::uuid
      AND (pe."deletedAt" IS NOT NULL OR p."deletedAt" IS NOT NULL OR p."active" = false)
      AND (pe."updatedAt" >= ${since} OR p."updatedAt" >= ${since})`;
}

/**
 * Bundle for one patient. A row is live only when its program is active and neither the program
 * nor the plan exercise is soft-deleted; anything else is a tombstone on a delta pull. Rows are
 * included when their own `updatedAt` or their program's `updatedAt` is at or after `since`:
 * deactivating or deleting a program updates the Program row, not its exercises.
 *
 * The comparison is inclusive because `updatedAt` has millisecond precision: two rows written in
 * the same millisecond would otherwise be missed. Re-sending one unchanged row is harmless (the
 * phone replaces by id). A transaction that commits after a pull but carries an earlier `now()`
 * can still be missed; that is inherent to timestamp cursors and acceptable for one relay/DB.
 */
export async function buildBundle(
  db: BundleDb,
  patient: Profile,
  since: number,
): Promise<Bundle> {
  const rows = await db.planExercise.findMany({
    where: {
      program: { patientId: patient.id },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      position: true,
      updatedAt: true,
      deletedAt: true,
      exercise: { select: { slug: true, name: true } },
      program: {
        select: { active: true, deletedAt: true, updatedAt: true },
      },
      envelopes: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          version: true,
          maxAngleDeg: true,
          maxVelDegPerS: true,
          debounceMs: true,
          onBreach: true,
          notifyCaregiver: true,
        },
      },
    },
  });

  let highest = 0;
  const exercises: BundleExercise[] = [];
  const removedIds = new Set<string>();
  for (const row of rows) {
    const rowAt = row.updatedAt.getTime();
    const programAt = row.program.updatedAt.getTime();
    highest = Math.max(highest, rowAt, programAt);

    const live = row.program.active && !row.program.deletedAt && !row.deletedAt;
    if (!live) {
      if (since > 0 && (rowAt >= since || programAt >= since)) {
        removedIds.add(row.id);
      }
      continue;
    }
    if (since > 0 && rowAt < since && programAt < since) continue;

    const current = row.envelopes[0] ?? null;
    exercises.push({
      planExerciseId: row.id,
      exerciseSlug: row.exercise.slug,
      exerciseName: row.exercise.name,
      position: row.position,
      envelope: current
        ? {
            version: current.version,
            maxAngleDeg: current.maxAngleDeg,
            maxVelDegPerS: current.maxVelDegPerS,
            debounceMs: current.debounceMs,
            onBreach: current.onBreach,
            notifyCaregiver: current.notifyCaregiver,
          }
        : null,
    });
  }

  // A full pull replaces the phone's cache, so tombstones only matter on a delta.
  if (since > 0) {
    for (const t of await tombstonesSince(db, patient.id, new Date(since))) {
      highest = Math.max(highest, t.rowAt.getTime(), t.programAt.getTime());
      removedIds.add(t.id);
    }
  }

  // Never move the phone's cursor backwards, even if its clock or a restored cache disagrees.
  return {
    version: Math.max(highest, since),
    exercises,
    removed: [...removedIds],
  };
}
