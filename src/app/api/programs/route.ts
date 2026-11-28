import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import {
  createProgram,
  createProgramSchema,
  listPrograms,
} from "../_domain/programs";

/** Lists the therapist's own programs (scoped to their patients). */
export async function GET() {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    return json(await listPrograms(prisma, therapist));
  } catch (err) {
    return jsonError(err);
  }
}

/** Creates a program for one of the therapist's patients. */
export async function POST(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const input = await parseBody(request, createProgramSchema);
    return json(await createProgram(prisma, therapist, input), 201);
  } catch (err) {
    return jsonError(err);
  }
}
