import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { revokeLink, revokeSchema } from "@/lib/auth/invites";
import { prisma } from "@/lib/prisma";

/** The patient, or the caregiver of the link, ends a CareLink immediately. */
export async function POST(request: Request) {
  try {
    const actor = await requireRole(Role.PATIENT, Role.CAREGIVER);
    const { careLinkId } = await parseBody(request, revokeSchema);
    return json(await revokeLink(prisma, actor, careLinkId));
  } catch (err) {
    return jsonError(err);
  }
}
