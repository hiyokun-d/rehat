import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { consentSchema, consentToLink } from "@/lib/auth/invites";
import { prisma } from "@/lib/prisma";

/** The patient, or their therapist when the patient cannot, activates a PENDING caregiver link. */
export async function POST(request: Request) {
  try {
    const actor = await requireRole(Role.PATIENT, Role.THERAPIST);
    const { careLinkId } = await parseBody(request, consentSchema);
    return json(await consentToLink(prisma, actor, careLinkId));
  } catch (err) {
    return jsonError(err);
  }
}
