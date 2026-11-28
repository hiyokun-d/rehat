import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { patientDetail } from "../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** One of the caller's patients: active program, latest envelope per exercise, catalog. */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const id = z.uuid().parse((await ctx.params).id);
    return json(await patientDetail(prisma, therapist, id));
  } catch (err) {
    return jsonError(err);
  }
}
