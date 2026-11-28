import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { createInvite, createInviteSchema } from "@/lib/auth/invites";
import { prisma } from "@/lib/prisma";

/** Therapist creates a single-use caregiver invite for one of their own patients. */
export async function POST(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const { patientId } = await parseBody(request, createInviteSchema);
    const invite = await createInvite(prisma, therapist, patientId);
    return json(invite, 201);
  } catch (err) {
    return jsonError(err);
  }
}
