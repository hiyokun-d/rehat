import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import {
  acceptInvite,
  acceptInviteSchema,
  INVALID_INVITE,
} from "@/lib/auth/invites";
import { allowAttempt, clientIp } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";

/**
 * Caregiver redeems an invite token. Creates no access: the link stays PENDING until consent.
 * A new user is a PATIENT until this succeeds; acceptInvite then makes them a CAREGIVER.
 */
export async function POST(request: Request) {
  try {
    const caregiver = await requireRole(Role.PATIENT, Role.CAREGIVER);
    if (!allowAttempt(`invite:${clientIp(request)}`)) {
      return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
    }
    const parsed = acceptInviteSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return json({ error: INVALID_INVITE }, 400);
    const link = await acceptInvite(prisma, caregiver, parsed.data.token);
    return json(link);
  } catch (err) {
    return jsonError(err);
  }
}
