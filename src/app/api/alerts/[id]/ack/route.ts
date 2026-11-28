import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { ackAlert, ackSchema } from "../../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** Acknowledge an alert, or mark it "this alert was wrong" (false alarm). */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const id = z.uuid().parse((await ctx.params).id);
    const input = await parseBody(request, ackSchema);
    return json(await ackAlert(prisma, therapist, id, input));
  } catch (err) {
    return jsonError(err);
  }
}
