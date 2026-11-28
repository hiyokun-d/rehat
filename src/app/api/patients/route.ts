import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/guard";
import { json, jsonError, parseBody } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { listMyPatients } from "../_domain/care";
import { registerPatient, registerPatientSchema } from "./register";

/** Therapist registers an existing Supabase user as their patient. */
export async function POST(request: Request) {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    const input = await parseBody(request, registerPatientSchema);
    const { patient, changed } = await registerPatient(
      prisma,
      therapist,
      input,
    );
    return json(patient, changed ? 201 : 200);
  } catch (err) {
    return jsonError(err);
  }
}

/** The therapist's / nurse's own patients, with last session and pending alerts. */
export async function GET() {
  try {
    const therapist = await requireRole(Role.THERAPIST);
    return json(await listMyPatients(prisma, therapist));
  } catch (err) {
    return jsonError(err);
  }
}
