import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AuthAdmin,
  createPatientAccount,
  newPatientSchema,
} from "../../_domain/care";

/** Nurse creates a patient account (no email needed); the phone signs in later by QR. */
export async function POST(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    if (!allowAttempt(`patient-new:${therapist.id}`, 30))
      return json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        429,
      );
    const input = await parseBody(request, newPatientSchema);
    const admin = createAdminClient().auth.admin as unknown as AuthAdmin;
    return json(
      await createPatientAccount(prisma, admin, therapist, input),
      201,
    );
  } catch (err) {
    return jsonError(err);
  }
}
