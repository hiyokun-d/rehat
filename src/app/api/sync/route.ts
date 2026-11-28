import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { HttpError, json, jsonError, parseBody } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";
import { ingestBatch, resolvePatient, syncBatchSchema } from "@/lib/relay/sync";

/** Sessions the phone minted per sync POST, per login. Generous: a batch is up to 100 sessions. */
const SYNC_POSTS_PER_HOUR = 120;

/**
 * POST /api/sync: the phone (PATIENT or CAREGIVER) uploads a batch of session summaries.
 * Idempotent on each item's clientId alone; no Idempotency-Key header. The reporter identity comes
 * from the login. `patientId` in the body is for caregivers only and is checked against their
 * ACTIVE CareLink. Each item gets its own result, so one bad item never fails the batch.
 * Contract: docs/SYNC-CONTRACT.md.
 */
export async function POST(request: Request) {
  try {
    const reporter = await requireRole(Role.PATIENT, Role.CAREGIVER);

    if (!allowAttempt(`sync:${reporter.id}`, SYNC_POSTS_PER_HOUR)) {
      throw new HttpError(429, "Terlalu banyak permintaan. Coba lagi nanti.");
    }

    const body = await parseBody(request, syncBatchSchema);
    const patientId = await resolvePatient(prisma, reporter, body.patientId);
    const results = await ingestBatch(
      prisma,
      reporter,
      patientId,
      body.sessions,
    );

    const count = (r: string) => results.filter((x) => x.result === r).length;
    return json(
      {
        stored: count("stored"),
        duplicate: count("duplicate"),
        rejected: count("rejected"),
        results,
      },
      200,
    );
  } catch (err) {
    return jsonError(err);
  }
}
