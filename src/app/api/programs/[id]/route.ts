import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import {
  deleteProgram,
  updateProgram,
  updateProgramSchema,
} from "../../_domain/programs";

type Ctx = { params: Promise<{ id: string }> };

/** Updates title and/or active flag on the therapist's own program. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const { id } = await ctx.params;
    const input = await parseBody(request, updateProgramSchema);
    return json(await updateProgram(prisma, therapist, id, input));
  } catch (err) {
    return jsonError(err);
  }
}

/** Soft-deletes the therapist's own program (sets deletedAt). */
export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const { id } = await ctx.params;
    await deleteProgram(prisma, therapist, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return jsonError(err);
  }
}
