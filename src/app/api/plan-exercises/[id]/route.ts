import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import {
  deletePlanExercise,
  updatePlanExercise,
  updatePlanExerciseSchema,
} from "../../_domain/programs";

type Ctx = { params: Promise<{ id: string }> };

/** Reorders a plan exercise inside the therapist's own program. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const { id } = await ctx.params;
    const input = await parseBody(request, updatePlanExerciseSchema);
    return json(await updatePlanExercise(prisma, therapist, id, input));
  } catch (err) {
    return jsonError(err);
  }
}

/** Soft-deletes a plan exercise in the therapist's own program. */
export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const { id } = await ctx.params;
    await deletePlanExercise(prisma, therapist, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return jsonError(err);
  }
}
