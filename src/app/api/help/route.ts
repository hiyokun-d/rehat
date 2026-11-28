import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import { serverBroadcast, staffTopic } from "@/lib/live/serverBroadcast";
import { prisma } from "@/lib/prisma";
import { requestHelp } from "../_domain/care";

/** Patient taps "Saya butuh bantuan": audited, then pushed to their nurse's dashboard. */
export async function POST() {
  try {
    const patient = await requireRole(Role.PATIENT);
    if (!allowAttempt(`help:${patient.id}`, 20))
      return json({ error: "Permintaan sudah terkirim. Tunggu perawat." }, 429);
    return json(
      await requestHelp(prisma, patient, (staffId, payload) =>
        serverBroadcast(staffTopic(staffId), { type: "help", payload }),
      ),
      201,
    );
  } catch (err) {
    return jsonError(err);
  }
}
