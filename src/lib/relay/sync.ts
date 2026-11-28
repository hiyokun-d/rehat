// Ingestion of session summaries from the phone (F3 / K5, S6, M9). Contract: docs/SYNC-CONTRACT.md.
//
// - A batch of at most MAX_BATCH items per POST. Idempotency comes only from each item's
//   phone-generated `clientId` (the RehabSession primary key); there is no Idempotency-Key header.
// - Every item gets its own result (stored | duplicate | rejected). A bad item is rejected on its
//   own and never aborts the rest of the batch.
// - One session = one interactive transaction (session + attempt + breaches + feedback + audit),
//   so a failure mid-way leaves no orphan row and a retry writes the whole session.
// - A clientId already owned by another patient or reporter is `rejected: client_id_conflict`,
//   never `duplicate` (R1-S4), so the real phone is told its session was NOT stored.
//
// Minimization (M9): `trace`, `repList` and raw device metadata are REJECTED, not stored.
//
// Trust boundary (S6): the reporter identity comes from the login, never the body. `patientId` in
// the body is accepted from a CAREGIVER login only and validated against an ACTIVE CareLink.
// `envelopeVersion` is the version the phone CLAIMS; the server marks a mismatch with the version
// in force and rejects a version that does not exist.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import {
  AlertLevel,
  AlertStatus,
  BreachAction,
  BreachKind,
  CareLinkStatus,
  LogStatus,
  Reporter,
  Role,
} from "@/generated/prisma/enums";
import { HttpError } from "@/lib/auth/http";
import type { prisma } from "@/lib/prisma";

/** Dossier: outbox batch of at most 100 per POST. */
export const MAX_BATCH = 100;
const MAX_STR = 500;
const MAX_REPS = 10_000;
const MAX_BREACHES = 1_000;
const MAX_PAUSES = 10_000;
/** Reasonableness bounds only, not clinical limits: a session or hold longer than a day is bogus. */
const MAX_MS = 86_400_000;
const MAX_ANGLE_DEG = 360;
const MAX_VEL_DEG_S = 10_000;
/** `value` and `limit` of a breach may be an angle or a velocity, so they take the larger bound. */
const MAX_BREACH_NUM = MAX_VEL_DEG_S;
/** Postgres timestamptz and ISO strings are only safe up to year 9999. */
const MAX_TIME_MS = Date.parse("9999-12-31T23:59:59.999Z");

const isoDate = z.iso.datetime({ offset: true });
const ms = z.number().int().nonnegative().max(MAX_MS);

const breachSchema = z.strictObject({
  kind: z.enum(["angle", "velocity"]),
  value: z.number().finite().min(-MAX_BREACH_NUM).max(MAX_BREACH_NUM),
  limit: z.number().finite().min(-MAX_BREACH_NUM).max(MAX_BREACH_NUM),
  heldMs: ms,
  atMs: ms,
});

/** startedAt + atMs as an ISO string, or null when the sum is not a representable date. */
function occurredAtIso(startedAt: string, atMs: number): string | null {
  const t = Date.parse(startedAt) + atMs;
  return Number.isFinite(t) && t <= MAX_TIME_MS
    ? new Date(t).toISOString()
    : null;
}

/**
 * What the phone may send per session. strictObject rejects any unlisted key, so `trace`,
 * `repList`, `deviceId`, `deviceLabel`, `reportedBy`, `patientId` and friends are all refused: the
 * only way the reporter identity enters is from the login. `exercise` is the catalog slug.
 */
export const sessionItemSchema = z
  .strictObject({
    clientId: z.uuid(),
    exercise: z.string().min(1).max(100),
    status: z.enum(LogStatus),
    startedAt: isoDate,
    endedAt: isoDate.nullable().optional(),
    envelopeVersion: z.number().int().nonnegative().max(1_000_000),
    reps: z.number().int().min(0).max(MAX_REPS),
    activeMs: ms,
    maxAngleDeg: z.number().finite().min(-MAX_ANGLE_DEG).max(MAX_ANGLE_DEG),
    maxVelDegS: z.number().finite().min(0).max(MAX_VEL_DEG_S),
    pauses: z.number().int().nonnegative().max(MAX_PAUSES),
    breaches: z.array(breachSchema).max(MAX_BREACHES),
    difficulty: z.number().int().min(1).max(5).nullable().optional(),
    note: z.string().max(MAX_STR).nullable().optional(),
    // Descriptive quality (src/lib/rehab/quality.ts). Optional so older phones still sync.
    // Ranges are sanity bounds only: SPARC is <= 0, CV >= 0, trend in degrees.
    quality: z
      .strictObject({
        sparc: z.number().finite().min(-100).max(0).nullable(),
        cv: z.number().finite().min(0).max(100).nullable(),
        trendDeg: z.number().finite().min(-360).max(360).nullable(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((item, ctx) => {
    if (Date.parse(item.startedAt) > MAX_TIME_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "overflow",
      });
      return;
    }
    item.breaches.forEach((b, i) => {
      if (occurredAtIso(item.startedAt, b.atMs) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["breaches", i, "atMs"],
          message: "overflow",
        });
      }
    });
  });

/**
 * The envelope only checks the shape of the batch. Each session is validated on its own inside
 * ingestBatch, so one malformed item is rejected alone instead of failing the whole POST (K4).
 * `patientId` is allowed here for CAREGIVER logins; resolvePatient refuses it for a patient.
 */
export const syncBatchSchema = z.strictObject({
  patientId: z.uuid().optional(),
  sessions: z.array(z.unknown()).min(1).max(MAX_BATCH),
});

export type SessionItem = z.infer<typeof sessionItemSchema>;

/** The real Prisma client. Tests pass an in-memory fake cast through `unknown`, as invites.ts does. */
export type SyncDb = typeof prisma;
type Tx = Parameters<Parameters<SyncDb["$transaction"]>[0]>[0];

export type RejectReason =
  | "invalid_payload"
  | "unknown_exercise"
  | "no_envelope"
  | "envelope_version_unknown"
  | "client_id_conflict";

export type SyncItemResult = {
  /** Position of the session in the request, so a rejected item without a usable clientId is findable. */
  index: number;
  clientId: string | null;
  result: "stored" | "duplicate" | "rejected";
  /** Present only when `result` is "rejected". */
  reason?: RejectReason;
  /** True when the phone's claimed envelopeVersion differs from the version in force (S6e). */
  envelopeMismatch: boolean;
};

/** Reporter derived from the login role, never the body (S6c). Caregiver reports on the patient. */
function reporterOf(role: Profile["role"]): Reporter {
  return role === Role.CAREGIVER ? Reporter.CAREGIVER : Reporter.PATIENT;
}

/**
 * Whose data this batch belongs to (R1-K7). A patient reports for themselves and may not send a
 * patientId. A caregiver must name the patient, and the name is checked against the caregiver's own
 * ACTIVE CareLink to a patient who is not soft-deleted; anything else is 403 (BOLA).
 */
export async function resolvePatient(
  db: Pick<SyncDb, "careLink">,
  reporter: Profile,
  bodyPatientId: string | undefined,
): Promise<string> {
  if (reporter.role === Role.PATIENT) {
    if (bodyPatientId !== undefined) {
      throw new HttpError(400, "patientId tidak boleh dikirim oleh pasien.");
    }
    return reporter.id;
  }

  if (bodyPatientId === undefined) {
    throw new HttpError(400, "patientId wajib diisi oleh caregiver.");
  }
  const link = await db.careLink.findFirst({
    where: {
      caregiverId: reporter.id,
      patientId: bodyPatientId,
      status: CareLinkStatus.ACTIVE,
      deletedAt: null,
      patient: { deletedAt: null },
    },
    select: { patientId: true },
  });
  if (!link) throw new HttpError(403, "Akses ditolak.");
  return link.patientId;
}

/**
 * Stores a batch for one authenticated reporter. `patientId` is the already-authorized patient
 * (see resolvePatient). Items are raw JSON: each is validated alone. Order of results matches the
 * request. A database failure (not a bad item) still throws; the items before it are committed and
 * the retry reports them as duplicates, which is safe because a session is all-or-nothing.
 */
export async function ingestBatch(
  db: SyncDb,
  reporter: Profile,
  patientId: string,
  rawItems: unknown[],
  now = new Date(),
): Promise<SyncItemResult[]> {
  const results: SyncItemResult[] = [];
  for (const [index, raw] of rawItems.entries()) {
    const parsed = sessionItemSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({
        index,
        clientId: rawClientId(raw),
        result: "rejected",
        reason: "invalid_payload",
        envelopeMismatch: false,
      });
      continue;
    }
    results.push({
      index,
      ...(await ingestItem(db, reporter, patientId, parsed.data, now)),
    });
  }
  return results;
}

function rawClientId(raw: unknown): string | null {
  const id = (raw as { clientId?: unknown } | null)?.clientId;
  return z.uuid().safeParse(id).success ? (id as string) : null;
}

type ItemOutcome = Omit<SyncItemResult, "index">;

async function ingestItem(
  db: SyncDb,
  reporter: Profile,
  patientId: string,
  item: SessionItem,
  now: Date,
): Promise<ItemOutcome> {
  const { clientId } = item;
  const reject = (
    reason: RejectReason,
    envelopeMismatch = false,
  ): ItemOutcome => ({
    clientId,
    result: "rejected",
    reason,
    envelopeMismatch,
  });

  // Same nested filters as the F2 pattern (programs.ts): a deleted or inactive program serves no
  // exercise and takes no sessions (R1-M2).
  const plan = await db.planExercise.findFirst({
    where: {
      deletedAt: null,
      exercise: { slug: item.exercise },
      program: { patientId, deletedAt: null, active: true },
    },
    select: { id: true },
  });
  if (!plan) return reject("unknown_exercise");

  const current = await db.safetyEnvelope.findFirst({
    where: { planExerciseId: plan.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  if (!current) return reject("no_envelope");

  const envelopeMismatch = current.version !== item.envelopeVersion;
  // The session FK points at [planExerciseId, version]: a version that never existed cannot be
  // stored. This row also tells us which breach behavior the phone ran under (F4).
  const used = await db.safetyEnvelope.findFirst({
    where: { planExerciseId: plan.id, version: item.envelopeVersion },
    select: { onBreach: true, notifyCaregiver: true },
  });
  if (!used) return reject("envelope_version_unknown", true);

  const result = await db.$transaction(async (tx) => {
    // Single conditional INSERT: a retry or a concurrent POST of the same clientId is a no-op, and
    // a concurrent one waits on the primary key until this transaction ends.
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "RehabSession"
        ("id", "status", "reportedBy", "startedAt", "endedAt", "envelopeVersion",
         "patientId", "reporterId", "planExerciseId")
      VALUES
        (${clientId}::uuid, ${item.status}::"LogStatus",
         ${reporterOf(reporter.role)}::"Reporter",
         ${item.startedAt}::timestamptz, ${item.endedAt ?? null}::timestamptz,
         ${item.envelopeVersion}, ${patientId}::uuid, ${reporter.id}::uuid, ${plan.id}::uuid)
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"`;

    if (inserted.length === 0) {
      // Only the same patient and reporter may see their own retry as a duplicate (R1-S4).
      // Raw read on purpose: the soft-delete extension would hide a deleted row that still owns the id.
      const [existing] = await tx.$queryRaw<
        { patientId: string; reporterId: string }[]
      >`SELECT "patientId", "reporterId" FROM "RehabSession" WHERE "id" = ${clientId}::uuid`;
      const mine =
        existing?.patientId === patientId &&
        existing.reporterId === reporter.id;
      return mine ? "duplicate" : "client_id_conflict";
    }

    const firstBreachId = await writeChildren(tx, item);
    await writeAlert(tx, item, patientId, used, firstBreachId);
    await tx.auditLog.create({
      data: {
        actorId: reporter.id,
        patientId,
        action: "sync.session",
        entityType: "RehabSession",
        entityId: clientId,
        metadata: {
          envelopeVersionClaimed: item.envelopeVersion,
          envelopeVersionCurrent: current.version,
          envelopeMismatch,
          serverReceivedAt: now.toISOString(),
        },
      },
    });
    return "stored";
  });

  if (result === "client_id_conflict") return reject(result, envelopeMismatch);
  return { clientId, result, envelopeMismatch };
}

/** Attempt summary (every status), breach events and feedback for a session inserted in this transaction. */
async function writeChildren(
  tx: Tx,
  item: SessionItem,
): Promise<string | null> {
  const sessionId = item.clientId;
  await tx.attemptSummary.create({
    data: {
      sessionId,
      reps: item.reps,
      activeMs: item.activeMs,
      maxAngleDeg: item.maxAngleDeg,
      maxVelDegPerS: item.maxVelDegS,
      pauses: item.pauses,
      sparcMedian: item.quality?.sparc ?? null,
      peakCv: item.quality?.cv ?? null,
      peakTrendDeg: item.quality?.trendDeg ?? null,
    },
  });

  let firstBreachId: string | null = null;
  if (item.breaches.length > 0) {
    const data = item.breaches.map((b) => ({
      // Known id so the Alert can point at the breach that triggered it.
      id: randomUUID(),
      sessionId,
      kind: b.kind === "angle" ? BreachKind.ANGLE : BreachKind.VELOCITY,
      value: b.value,
      limit: b.limit,
      heldMs: b.heldMs,
      // Validated by sessionItemSchema, so never null here.
      occurredAt: new Date(occurredAtIso(item.startedAt, b.atMs) as string),
    }));
    await tx.breachEvent.createMany({ data });
    firstBreachId = data[0].id;
  }

  const note = item.note?.trim() || null;
  if (item.difficulty != null || note) {
    await tx.feedback.create({
      data: { sessionId, difficulty: item.difficulty ?? null, note },
    });
  }
  return firstBreachId;
}

/**
 * At most one Alert per session (false-alarm cap). Created only when the therapist's envelope
 * asked for a pause or a caregiver notification. L2 means the therapist chose pause; L1 is a
 * cue-only envelope that still asks for a caregiver notification. Push (FCM) is not wired yet,
 * so status stays PENDING and the caregiver may be null when no active link exists.
 */
async function writeAlert(
  tx: Tx,
  item: SessionItem,
  patientId: string,
  used: { onBreach: BreachAction; notifyCaregiver: boolean },
  breachEventId: string | null,
): Promise<void> {
  if (
    !breachEventId ||
    (used.onBreach !== BreachAction.CUE_AND_PAUSE && !used.notifyCaregiver)
  )
    return;
  const link = await tx.careLink.findFirst({
    where: {
      patientId,
      status: CareLinkStatus.ACTIVE,
      consentAt: { not: null },
      deletedAt: null,
      caregiver: { deletedAt: null },
    },
    orderBy: { createdAt: "asc" },
    select: { caregiverId: true },
  });
  await tx.alert.create({
    data: {
      level:
        used.onBreach === BreachAction.CUE_AND_PAUSE
          ? AlertLevel.L2
          : AlertLevel.L1,
      status: AlertStatus.PENDING,
      patientId,
      caregiverId: link?.caregiverId ?? null,
      sessionId: item.clientId,
      breachEventId,
    },
  });
}
