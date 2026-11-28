import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { putEnvelope, putEnvelopeSchema } from "../_domain/programs";

/**
 * Sets the safety envelope for a PlanExercise. Append-only: each call inserts a new version and
 * leaves earlier versions untouched, so sessions keep pointing at the limits in force when they
 * ran. The therapist's numbers are stored as given.
 */
export async function PUT(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const input = await parseBody(request, putEnvelopeSchema);
    return json(await putEnvelope(prisma, therapist, input), 201);
  } catch (err) {
    return jsonError(err);
  }
}
