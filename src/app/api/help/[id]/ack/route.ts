import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { ackHelp } from "../../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** Nurse closes a help request of one of their own patients. */
export async function POST(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const id = z.uuid().parse((await ctx.params).id);
    return json(await ackHelp(prisma, therapist, id));
  } catch (err) {
    return jsonError(err);
  }
}
