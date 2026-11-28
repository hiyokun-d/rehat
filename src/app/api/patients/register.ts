import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { DEFAULT_DISPLAY_NAME } from "@/lib/auth/guard";
import { HttpError } from "@/lib/auth/http";
import type { prisma } from "@/lib/prisma";

type Db = typeof prisma;

/** `authUserId` is an existing Supabase user. The role and therapist are never in the body. */
export const registerPatientSchema = z.strictObject({
  authUserId: z.uuid(),
  displayName: z.string().trim().min(1).max(80).optional(),
});

const CANNOT_REGISTER = "Pengguna tidak dapat didaftarkan.";
// Prisma FK violation: no auth.users row for this id (once the first migration adds the FK).
const FK_VIOLATION = "P2003";

/**
 * Makes an existing Supabase user a patient of `therapist`: creates the PATIENT Profile or
 * completes the one first-touch made. Refuses users who are another role or already belong
 * to another therapist (one generic 409). Repeating the call for the therapist's own
 * patient changes nothing.
 * shortcut: no patient consent is recorded at registration (only the invite flow has
 * consent); add a patient confirmation step before use beyond a clinic pilot.
 */
export async function registerPatient(
  db: Db,
  therapist: Profile,
  input: z.infer<typeof registerPatientSchema>,
): Promise<{ patient: Pick<Profile, "id" | "displayName">; changed: boolean }> {
  const { authUserId, displayName } = input;
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.profile.findFirst({
        where: { id: authUserId },
        select: { id: true, role: true, therapistId: true, displayName: true },
      });

      if (existing) {
        if (existing.role !== Role.PATIENT) {
          throw new HttpError(409, CANNOT_REGISTER);
        }
        if (existing.therapistId === therapist.id) {
          return { patient: existing, changed: false };
        }
        const { count } = await tx.profile.updateMany({
          where: { id: authUserId, role: Role.PATIENT, therapistId: null },
          data: {
            therapistId: therapist.id,
            ...(displayName && { displayName }),
          },
        });
        if (count === 0) throw new HttpError(409, CANNOT_REGISTER);
      } else {
        const { count } = await tx.profile.createMany({
          data: [
            {
              id: authUserId,
              role: Role.PATIENT,
              displayName: displayName ?? DEFAULT_DISPLAY_NAME,
              therapistId: therapist.id,
            },
          ],
          skipDuplicates: true,
        });
        // 0 rows: a concurrent first touch or a soft-deleted Profile holds the id.
        if (count === 0) throw new HttpError(409, CANNOT_REGISTER);
      }

      await tx.auditLog.create({
        data: {
          actorId: therapist.id,
          patientId: authUserId,
          action: "patient.register",
          entityType: "Profile",
          entityId: authUserId,
          metadata: { created: !existing },
        },
      });
      return {
        patient: {
          id: authUserId,
          displayName:
            displayName ?? existing?.displayName ?? DEFAULT_DISPLAY_NAME,
        },
        changed: true,
      };
    });
  } catch (err) {
    if ((err as { code?: string }).code === FK_VIOLATION) {
      throw new HttpError(404, "Pengguna tidak ditemukan.");
    }
    throw err;
  }
}
