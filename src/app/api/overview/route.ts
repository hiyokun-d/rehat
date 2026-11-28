import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { patientsOverview } from "../_domain/care";

/** Work list for the dashboard: every own patient with computed 7/28-day numbers and flags. */
export async function GET() {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    return json(await patientsOverview(prisma, therapist));
  } catch (err) {
    return jsonError(err);
  }
}
