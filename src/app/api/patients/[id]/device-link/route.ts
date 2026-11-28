import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";
import { mintDeviceLink } from "../../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** One-time QR token (10 min) that signs a phone in as this patient. One per phone. */
export async function POST(_request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    if (!allowAttempt(`devlink-mint:${therapist.id}`, 60))
      return json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        429,
      );
    const id = z.uuid().parse((await ctx.params).id);
    return json(await mintDeviceLink(prisma, therapist, id), 201);
  } catch (err) {
    return jsonError(err);
  }
}
