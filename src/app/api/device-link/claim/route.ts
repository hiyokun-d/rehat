import { json, jsonError, parseBody } from "@/lib/auth/http";
import { allowAttempt, clientIp } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AuthAdmin,
  claimDeviceLink,
  claimSchema,
} from "../../_domain/care";

/**
 * A patient's phone exchanges a QR token or the 8-symbol code shown under it (10 min, max 4 phones) for a one-time sign-in hash.
 * No login needed: the token IS the proof. Rate limited per IP against guessing.
 */
export async function POST(request: Request) {
  try {
    if (!allowAttempt(`devlink-claim:${clientIp(request)}`, 20))
      return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
    const input = await parseBody(request, claimSchema);
    const admin = createAdminClient().auth.admin as unknown as AuthAdmin;
    return json(await claimDeviceLink(prisma, admin, input));
  } catch (err) {
    return jsonError(err);
  }
}
