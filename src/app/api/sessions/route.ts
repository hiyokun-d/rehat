import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { listSessions, listSessionsQuerySchema, queryObject } from "./history";

/**
 * GET /api/sessions?patientId=<uuid>&page=1&limit=20
 * Sessions of the therapist's own patients, newest first. `patientId` narrows to one patient;
 * a patient who is not the therapist's gives 404.
 */
export async function GET(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const query = listSessionsQuerySchema.parse(queryObject(request));
    return json(await listSessions(prisma, therapist, query));
  } catch (err) {
    return jsonError(err);
  }
}
