import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { buildBundle, sinceSchema } from "@/lib/relay/bundle";

/**
 * GET /api/bundle?since=<version> — the signed-in patient pulls their plan exercises and the
 * current safety envelope for each, as a delta since the version they already hold (K4). The
 * phone uses the returned limits as the source of truth for a session.
 */
export async function GET(request: Request) {
  try {
    const patient = await requireRole(Role.PATIENT);
    const since = sinceSchema.parse(
      new URL(request.url).searchParams.get("since"),
    );
    const bundle = await buildBundle(prisma, patient, since);
    return json(bundle, 200);
  } catch (err) {
    return jsonError(err);
  }
}
