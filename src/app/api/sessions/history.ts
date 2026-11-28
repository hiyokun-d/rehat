// Therapist-side read of session history and breach events (used by /screen "Riwayat").
//
// Ownership follows programs.ts (no BOLA): a session is visible only when its patient has
// Profile.therapistId == the acting therapist. Anything else is reported as 404 so existence is
// not leaked. Reads are not audited (F2 audits mutations only).
//
// Pagination is page/limit with a +1 lookahead row for `hasMore` (no total count query).
// shortcut: offset pagination, fine for a therapist's own list; switch to a cursor on
// (startedAt, id) if one patient's history grows past a few thousand rows.
//
// Breaches are read PER SESSION (GET /api/breaches?sessionId=...): the screen opens one session
// at a time, and a per-session read stays bounded by that session's own events.
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/auth/http";
import type { prisma } from "@/lib/prisma";

type Db = typeof prisma;

const PATIENT_NOT_FOUND = "Pasien tidak ditemukan.";
const SESSION_NOT_FOUND = "Sesi tidak ditemukan.";

export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 20;

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT);

export const listSessionsQuerySchema = z.strictObject({
  patientId: z.uuid().optional(),
  page,
  limit,
});

export const listBreachesQuerySchema = z.strictObject({
  sessionId: z.uuid(),
  page,
  limit,
});

/** Query string -> plain object for a strict zod schema. A repeated key keeps the last value. */
export function queryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}

const ownedPatient = (therapist: Profile) => ({
  therapistId: therapist.id,
  role: Role.PATIENT,
  deletedAt: null,
});

export async function listSessions(
  db: Db,
  therapist: Profile,
  query: z.infer<typeof listSessionsQuerySchema>,
) {
  if (query.patientId) {
    const patient = await db.profile.findFirst({
      where: { id: query.patientId, ...ownedPatient(therapist) },
      select: { id: true },
    });
    if (!patient) throw new HttpError(404, PATIENT_NOT_FOUND);
  }

  const rows = await db.rehabSession.findMany({
    where: {
      deletedAt: null,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      patient: ownedPatient(therapist),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit + 1,
    select: {
      id: true,
      patientId: true,
      planExerciseId: true,
      status: true,
      reportedBy: true,
      startedAt: true,
      endedAt: true,
      envelopeVersion: true,
      attempt: {
        select: {
          reps: true,
          activeMs: true,
          maxAngleDeg: true,
          maxVelDegPerS: true,
          pauses: true,
        },
      },
    },
  });

  return {
    items: rows.slice(0, query.limit),
    page: query.page,
    limit: query.limit,
    hasMore: rows.length > query.limit,
  };
}

export async function listBreaches(
  db: Db,
  therapist: Profile,
  query: z.infer<typeof listBreachesQuerySchema>,
) {
  const session = await db.rehabSession.findFirst({
    where: {
      id: query.sessionId,
      deletedAt: null,
      patient: ownedPatient(therapist),
    },
    select: { id: true, patientId: true },
  });
  if (!session) throw new HttpError(404, SESSION_NOT_FOUND);

  const rows = await db.breachEvent.findMany({
    where: { sessionId: session.id, deletedAt: null },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit + 1,
    select: {
      id: true,
      sessionId: true,
      kind: true,
      value: true,
      limit: true,
      heldMs: true,
      occurredAt: true,
    },
  });

  return {
    sessionId: session.id,
    patientId: session.patientId,
    items: rows.slice(0, query.limit),
    page: query.page,
    limit: query.limit,
    hasMore: rows.length > query.limit,
  };
}
