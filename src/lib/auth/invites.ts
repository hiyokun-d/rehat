// Caregiver invite flow on CareLink (schema has no separate invite table):
//   create  -> CareLink PENDING, tokenHash set, no caregiver yet (therapist)
//   accept  -> tokenHash cleared + caregiver bound in ONE conditional UPDATE (caregiver)
//   consent -> PENDING becomes ACTIVE with consentAt + consentedById (patient or their therapist)
//   revoke  -> PENDING or ACTIVE becomes REVOKED with revokedAt (the patient, or the link's caregiver)
// A PENDING link grants no data access. Only the SHA-256 of the token is stored; the raw token
// exists only in the creation response.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import { CareLinkStatus, Role } from "@/generated/prisma/enums";
import type { prisma } from "@/lib/prisma";
import { HttpError } from "./http";

type Db = typeof prisma;

export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

/** One message for unknown, expired, used and malformed tokens, so status is not leaked. */
export const INVALID_INVITE = "Undangan tidak valid atau sudah tidak berlaku.";

export const createInviteSchema = z.strictObject({ patientId: z.uuid() });
export const acceptInviteSchema = z.strictObject({
  token: z.string().min(1).max(256),
});
export const consentSchema = z.strictObject({ careLinkId: z.uuid() });
export const revokeSchema = z.strictObject({ careLinkId: z.uuid() });

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvite(
  db: Db,
  therapist: Profile,
  patientId: string,
  now = new Date(),
) {
  const patient = await db.profile.findFirst({
    where: {
      id: patientId,
      role: Role.PATIENT,
      therapistId: therapist.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!patient) throw new HttpError(404, "Pasien tidak ditemukan.");

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  const link = await db.$transaction(async (tx) => {
    const created = await tx.careLink.create({
      data: {
        status: CareLinkStatus.PENDING,
        tokenHash: hashToken(token),
        expiresAt,
        patientId: patient.id,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: patient.id,
        action: "invite.create",
        entityType: "CareLink",
        entityId: created.id,
      },
    });
    return created;
  });

  return { careLinkId: link.id, token, expiresAt };
}

export async function acceptInvite(
  db: Db,
  caregiver: Profile,
  token: string,
  now = new Date(),
) {
  const tokenHash = hashToken(token);

  return db.$transaction(async (tx) => {
    // Profiles are first created as PATIENT. Holding a valid token is what makes a user with no
    // therapist a caregiver; any other role is refused before the token is touched. The flip is
    // rolled back with the transaction when the token turns out to be invalid.
    const promoted = caregiver.role !== Role.CAREGIVER;
    if (promoted) {
      const { count } = await tx.profile.updateMany({
        where: { id: caregiver.id, role: Role.PATIENT, therapistId: null },
        data: { role: Role.CAREGIVER },
      });
      if (count === 0) throw new HttpError(403, "Akses ditolak.");
    }

    // Single statement: two concurrent requests cannot both match the same row.
    const rows = await tx.$queryRaw<{ id: string; patientId: string }[]>`
      UPDATE "CareLink"
      SET "tokenHash" = NULL, "caregiverId" = ${caregiver.id}::uuid, "acceptedAt" = ${now}
      WHERE "tokenHash" = ${tokenHash}
        AND "status" = 'PENDING'::"CareLinkStatus"
        AND "caregiverId" IS NULL
        AND "deletedAt" IS NULL
        AND "expiresAt" > ${now}
      RETURNING "id", "patientId"`;
    const link = rows[0];
    if (!link) throw new HttpError(400, INVALID_INVITE);

    if (promoted) {
      await tx.auditLog.create({
        data: {
          actorId: caregiver.id,
          patientId: caregiver.id,
          action: "profile.role_caregiver",
          entityType: "Profile",
          entityId: caregiver.id,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: caregiver.id,
        patientId: link.patientId,
        action: "invite.accept",
        entityType: "CareLink",
        entityId: link.id,
      },
    });
    return { careLinkId: link.id, status: CareLinkStatus.PENDING };
  });
}

/** Only the patient, or the patient's therapist, may consent. Anything else looks like 404. */
export async function consentToLink(
  db: Db,
  actor: Profile,
  careLinkId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.careLink.updateMany({
      where: {
        id: careLinkId,
        status: CareLinkStatus.PENDING,
        caregiverId: { not: null },
        deletedAt: null,
        OR: [{ patientId: actor.id }, { patient: { therapistId: actor.id } }],
      },
      data: {
        status: CareLinkStatus.ACTIVE,
        consentAt: now,
        consentedById: actor.id,
      },
    });
    if (count === 0) throw new HttpError(404, "Tautan tidak ditemukan.");

    const link = await tx.careLink.findUnique({
      where: { id: careLinkId },
      select: { patientId: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        patientId: link?.patientId ?? null,
        action: "invite.consent",
        entityType: "CareLink",
        entityId: careLinkId,
      },
    });
    return { careLinkId, status: CareLinkStatus.ACTIVE };
  });
}

/**
 * Ends a link at once: only the patient who owns it or the caregiver bound to it may revoke
 * (the therapist cannot). Anyone else, and an unknown id, get the same 403 so ids are not
 * probed. A link that is already REVOKED gives 409. Readers must filter status ACTIVE; a REVOKED
 * link is never reactivated because consent only accepts PENDING.
 */
export async function revokeLink(
  db: Db,
  actor: Profile,
  careLinkId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const link = await tx.careLink.findFirst({
      where: { id: careLinkId },
      select: { patientId: true, caregiverId: true },
    });
    if (
      !link ||
      (link.patientId !== actor.id && link.caregiverId !== actor.id)
    ) {
      throw new HttpError(403, "Akses ditolak.");
    }

    const { count } = await tx.careLink.updateMany({
      where: {
        id: careLinkId,
        status: { in: [CareLinkStatus.PENDING, CareLinkStatus.ACTIVE] },
      },
      data: { status: CareLinkStatus.REVOKED, revokedAt: now, tokenHash: null },
    });
    if (count === 0) throw new HttpError(409, "Tautan sudah dicabut.");

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        patientId: link.patientId,
        action: "invite.revoke",
        entityType: "CareLink",
        entityId: careLinkId,
      },
    });
    return { careLinkId, status: CareLinkStatus.REVOKED };
  });
}
