import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { addReview, listReviews, reviewSchema } from "../../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** Therapist / nurse notes on one patient (TherapistReview). */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const id = z.uuid().parse((await ctx.params).id);
    return json(await listReviews(prisma, therapist, id));
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const id = z.uuid().parse((await ctx.params).id);
    const input = await parseBody(request, reviewSchema);
    return json(await addReview(prisma, therapist, id, input), 201);
  } catch (err) {
    return jsonError(err);
  }
}
