// Therapist-owned CRUD for Program, PlanExercise and SafetyEnvelope.
//
// Ownership (AGENTS.md "caregiver A -> patient B = 403", no BOLA): every row reached here must
// trace back to the acting therapist. A Program is owned when Program.therapistId == therapist.id
// AND the patient is one of the therapist's patients (Profile.therapistId == therapist.id).
// PlanExercise and SafetyEnvelope inherit that ownership through their Program. A row the
// therapist does not own is reported as 404 so existence is not leaked.
//
// SafetyEnvelope is append-only (schema + AGENTS.md): setting limits inserts a NEW row with
// version+1 and never mutates an older row, because past sessions point at the version that was
// in force when they ran. Range checks (M1) may REJECT unreasonable numbers but must never clamp
// or substitute a therapist's number, and there is no default.
//
// Every create/update/delete writes an AuditLog row (ids and field names only, no health values).
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import { BreachAction, Role } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/auth/http";
import type { prisma } from "@/lib/prisma";

type Db = typeof prisma;

const PROGRAM_NOT_FOUND = "Program tidak ditemukan.";
const PLAN_EXERCISE_NOT_FOUND = "Latihan tidak ditemukan.";
const PATIENT_NOT_FOUND = "Pasien tidak ditemukan.";
const EXERCISE_NOT_FOUND = "Latihan katalog tidak ditemukan.";

// --- schemas (strict at the route boundary) --------------------------------

export const createProgramSchema = z.strictObject({
  patientId: z.uuid(),
  title: z.string().min(1).max(200),
  active: z.boolean(),
});

export const updateProgramSchema = z
  .strictObject({
    title: z.string().min(1).max(200).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.active !== undefined, {
    message: "Tidak ada perubahan.",
  });

export const createPlanExerciseSchema = z.strictObject({
  programId: z.uuid(),
  exerciseId: z.uuid(),
  position: z.int().min(0).max(10_000),
});

export const updatePlanExerciseSchema = z.strictObject({
  position: z.int().min(0).max(10_000),
});

// Reasonableness bounds only: they reject impossible values (M1). They are not clinical limits
// and must never silently alter the therapist's number — zod rejects, it does not clamp.
export const putEnvelopeSchema = z.strictObject({
  planExerciseId: z.uuid(),
  maxAngleDeg: z.number().positive().finite().max(360),
  maxVelDegPerS: z.number().positive().finite().max(10_000),
  debounceMs: z.int().min(0).max(600_000),
  onBreach: z.enum(BreachAction),
  notifyCaregiver: z.boolean(),
});

// --- ownership helpers ------------------------------------------------------

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

/** Loads a Program the therapist owns (and whose patient is theirs), or throws 404. */
async function ownedProgram(db: Db, therapist: Profile, programId: string) {
  const program = await db.program.findFirst({
    where: {
      id: programId,
      therapistId: therapist.id,
      deletedAt: null,
      patient: { therapistId: therapist.id, deletedAt: null },
    },
    select: { id: true, patientId: true },
  });
  if (!program) throw new HttpError(404, PROGRAM_NOT_FOUND);
  return program;
}

/** Loads a PlanExercise whose Program the therapist owns, or throws 404. */
async function ownedPlanExercise(
  db: Db,
  therapist: Profile,
  planExerciseId: string,
) {
  const planExercise = await db.planExercise.findFirst({
    where: {
      id: planExerciseId,
      deletedAt: null,
      program: {
        therapistId: therapist.id,
        deletedAt: null,
        patient: { therapistId: therapist.id, deletedAt: null },
      },
    },
    select: {
      id: true,
      programId: true,
      program: { select: { patientId: true } },
    },
  });
  if (!planExercise) throw new HttpError(404, PLAN_EXERCISE_NOT_FOUND);
  return planExercise;
}

/**
 * One active program per patient (schema comment). Deactivates the patient's other active
 * programs inside the caller's transaction, so a failure later in the transaction rolls this back.
 * Program.updatedAt is bumped by Prisma, which is what the bundle cursor and tombstones read.
 */
async function deactivateOthers(
  tx: Tx,
  patientId: string,
  exceptId?: string,
): Promise<string[]> {
  const rows = await tx.program.findMany({
    where: {
      patientId,
      active: true,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (rows.length === 0) return [];
  await tx.program.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    // Explicit updatedAt: the bundle cursor and tombstones depend on it moving, whether or not
    // the database driver applies @updatedAt to updateMany.
    data: { active: false, updatedAt: new Date() },
  });
  return rows.map((row) => row.id);
}

// --- Program CRUD -----------------------------------------------------------

export async function listPrograms(db: Db, therapist: Profile) {
  return db.program.findMany({
    where: {
      therapistId: therapist.id,
      deletedAt: null,
      patient: { therapistId: therapist.id, deletedAt: null },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createProgram(
  db: Db,
  therapist: Profile,
  input: z.infer<typeof createProgramSchema>,
) {
  const patient = await db.profile.findFirst({
    where: {
      id: input.patientId,
      role: Role.PATIENT,
      therapistId: therapist.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!patient) throw new HttpError(404, PATIENT_NOT_FOUND);

  return db.$transaction(async (tx) => {
    const deactivated = input.active
      ? await deactivateOthers(tx, patient.id)
      : [];
    const program = await tx.program.create({
      data: {
        title: input.title,
        active: input.active,
        patientId: patient.id,
        therapistId: therapist.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: patient.id,
        action: "program.create",
        entityType: "Program",
        entityId: program.id,
        ...(deactivated.length > 0 ? { metadata: { deactivated } } : {}),
      },
    });
    return program;
  });
}

export async function updateProgram(
  db: Db,
  therapist: Profile,
  programId: string,
  input: z.infer<typeof updateProgramSchema>,
) {
  const owned = await ownedProgram(db, therapist, programId);
  return db.$transaction(async (tx) => {
    const deactivated =
      input.active === true
        ? await deactivateOthers(tx, owned.patientId, owned.id)
        : [];
    const program = await tx.program.update({
      where: { id: owned.id },
      data: { title: input.title, active: input.active },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: owned.patientId,
        action: "program.update",
        entityType: "Program",
        entityId: program.id,
        ...(deactivated.length > 0 ? { metadata: { deactivated } } : {}),
      },
    });
    return program;
  });
}

export async function deleteProgram(
  db: Db,
  therapist: Profile,
  programId: string,
  now = new Date(),
) {
  const owned = await ownedProgram(db, therapist, programId);
  await db.$transaction(async (tx) => {
    await tx.program.update({
      where: { id: owned.id },
      data: { deletedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: owned.patientId,
        action: "program.delete",
        entityType: "Program",
        entityId: owned.id,
      },
    });
  });
}

// --- PlanExercise CRUD ------------------------------------------------------

export async function createPlanExercise(
  db: Db,
  therapist: Profile,
  input: z.infer<typeof createPlanExerciseSchema>,
) {
  const program = await ownedProgram(db, therapist, input.programId);
  const exercise = await db.exercise.findFirst({
    where: { id: input.exerciseId },
    select: { id: true },
  });
  if (!exercise) throw new HttpError(404, EXERCISE_NOT_FOUND);

  return db.$transaction(async (tx) => {
    // One live row per exercise per program. The migration adds the matching partial unique
    // index; this check gives the therapist a 422 instead of a database error.
    const duplicate = await tx.planExercise.findFirst({
      where: {
        programId: program.id,
        exerciseId: exercise.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new HttpError(422, "Latihan ini sudah ada di program.");
    }
    const planExercise = await tx.planExercise.create({
      data: {
        programId: program.id,
        exerciseId: exercise.id,
        position: input.position,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: program.patientId,
        action: "planExercise.create",
        entityType: "PlanExercise",
        entityId: planExercise.id,
      },
    });
    return planExercise;
  });
}

export async function updatePlanExercise(
  db: Db,
  therapist: Profile,
  planExerciseId: string,
  input: z.infer<typeof updatePlanExerciseSchema>,
) {
  const owned = await ownedPlanExercise(db, therapist, planExerciseId);
  return db.$transaction(async (tx) => {
    const planExercise = await tx.planExercise.update({
      where: { id: owned.id },
      data: { position: input.position },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: owned.program.patientId,
        action: "planExercise.update",
        entityType: "PlanExercise",
        entityId: planExercise.id,
      },
    });
    return planExercise;
  });
}

export async function deletePlanExercise(
  db: Db,
  therapist: Profile,
  planExerciseId: string,
  now = new Date(),
) {
  const owned = await ownedPlanExercise(db, therapist, planExerciseId);
  await db.$transaction(async (tx) => {
    await tx.planExercise.update({
      where: { id: owned.id },
      data: { deletedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: owned.program.patientId,
        action: "planExercise.delete",
        entityType: "PlanExercise",
        entityId: owned.id,
      },
    });
  });
}

// --- SafetyEnvelope (append-only) ------------------------------------------

/**
 * Sets the safety envelope for a PlanExercise by inserting a NEW version. The previous version
 * stays untouched so sessions that ran under it keep pointing at their own numbers. The therapist
 * numbers are stored exactly as given (validated for range, never clamped).
 */
export async function putEnvelope(
  db: Db,
  therapist: Profile,
  input: z.infer<typeof putEnvelopeSchema>,
) {
  const owned = await ownedPlanExercise(db, therapist, input.planExerciseId);

  return db.$transaction(async (tx) => {
    const latest = await tx.safetyEnvelope.findFirst({
      where: { planExerciseId: owned.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const envelope = await tx.safetyEnvelope.create({
      data: {
        version: nextVersion,
        maxAngleDeg: input.maxAngleDeg,
        maxVelDegPerS: input.maxVelDegPerS,
        debounceMs: input.debounceMs,
        onBreach: input.onBreach,
        notifyCaregiver: input.notifyCaregiver,
        planExerciseId: owned.id,
        createdById: therapist.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: owned.program.patientId,
        action: "envelope.put",
        entityType: "SafetyEnvelope",
        entityId: envelope.id,
        metadata: { planExerciseId: owned.id, version: nextVersion },
      },
    });
    return envelope;
  });
}
