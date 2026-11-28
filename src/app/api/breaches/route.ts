import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import {
  listBreaches,
  listBreachesQuerySchema,
  queryObject,
} from "../sessions/history";

/**
 * GET /api/breaches?sessionId=<uuid>&page=1&limit=20
 * Breach events of ONE session (the per-session form; there is no per-patient form). A session
 * of a patient who is not the therapist's gives 404.
 */
export async function GET(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const query = listBreachesQuerySchema.parse(queryObject(request));
    return json(await listBreaches(prisma, therapist, query));
  } catch (err) {
    return jsonError(err);
  }
}
