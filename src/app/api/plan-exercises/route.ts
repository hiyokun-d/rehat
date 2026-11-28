import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import {
  createPlanExercise,
  createPlanExerciseSchema,
} from "../_domain/programs";

/** Adds a catalog exercise to one of the therapist's programs. */
export async function POST(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const input = await parseBody(request, createPlanExerciseSchema);
    return json(await createPlanExercise(prisma, therapist, input), 201);
  } catch (err) {
    return jsonError(err);
  }
}
