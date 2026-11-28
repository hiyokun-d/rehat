import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import { patientTopic } from "@/lib/live/protocol";
import { serverBroadcast } from "@/lib/live/serverBroadcast";
import { prisma } from "@/lib/prisma";
import { messageSchema, sendMessage } from "../../../_domain/care";

type Ctx = { params: Promise<{ id: string }> };

/** Nurse sends a short text to all of a patient's phones (shown + read aloud). Audited. */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    if (!allowAttempt(`msg:${therapist.id}`, 120))
      return json({ error: "Terlalu banyak pesan. Coba lagi nanti." }, 429);
    const id = z.uuid().parse((await ctx.params).id);
    const input = await parseBody(request, messageSchema);
    return json(
      await sendMessage(prisma, therapist, id, input, (pid, payload) =>
        serverBroadcast(patientTopic(pid), { type: "nurse-msg", payload }),
      ),
      201,
    );
  } catch (err) {
    return jsonError(err);
  }
}
