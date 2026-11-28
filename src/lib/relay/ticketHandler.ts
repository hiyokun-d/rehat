// Logic of POST /api/ws-ticket, kept out of the route file (Next only allows HTTP method exports
// there) so it can be tested with injected dependencies and no live database.
import { type GuardDeps, requireUser } from "@/lib/auth/guard";
import { HttpError, json, jsonError } from "@/lib/auth/http";
import { allowAttempt } from "@/lib/auth/rateLimit";
import {
  issueTicket,
  TICKET_TTL_MS,
  type TicketClaims,
} from "@/lib/relay/tickets";

/**
 * Per user and hour. A phone that keeps reconnecting asks for a ticket each time (backoff caps
 * at 5 s, so a healthy session needs a handful), 300 leaves room for a flaky network and stops
 * an account from minting tickets in bulk (R1-S5). The window is fixed at one hour by
 * rateLimit.ts.
 */
export const WS_TICKETS_PER_HOUR = 300;

export interface LinkedPatient {
  id: string;
  therapistId: string | null;
}

export interface TicketDeps {
  /** Overrides for the session and Profile lookup; omit in production. */
  guard?: GuardDeps;
  /** The patient a caregiver may follow: an ACTIVE, consented, non-deleted CareLink. */
  linkedPatient: (caregiverId: string) => Promise<LinkedPatient | null>;
}

export const defaultDeps: TicketDeps = {
  async linkedPatient(caregiverId) {
    const { prisma } = await import("@/lib/prisma");
    const link = await prisma.careLink.findFirst({
      where: {
        caregiverId,
        status: "ACTIVE",
        consentAt: { not: null },
        deletedAt: null,
        patient: { deletedAt: null },
      },
      orderBy: { createdAt: "asc" },
      select: { patient: { select: { id: true, therapistId: true } } },
    });
    return link?.patient ?? null;
  },
};

/**
 * The relay role comes from the Profile role, never from the request: a therapist's laptop is a
 * `screen`; a patient or caregiver phone is a `phone` bound to its patient and that patient's
 * therapist. The ticket carries that identity, and the relay enforces it (rooms.ts).
 */
export async function handleWsTicket(deps: TicketDeps): Promise<Response> {
  try {
    const profile = await requireUser(deps.guard);
    if (!allowAttempt(`ws-ticket:${profile.id}`, WS_TICKETS_PER_HOUR)) {
      throw new HttpError(429, "Terlalu banyak permintaan. Coba lagi nanti.");
    }

    let claims: TicketClaims;
    if (profile.role === "THERAPIST") {
      claims = {
        userId: profile.id,
        role: "screen",
        therapistId: profile.id,
        patientId: null,
      };
    } else {
      const patient =
        profile.role === "PATIENT"
          ? { id: profile.id, therapistId: profile.therapistId }
          : await deps.linkedPatient(profile.id);
      if (!patient?.therapistId) {
        throw new HttpError(403, "Akun ini belum terhubung ke terapis.");
      }
      claims = {
        userId: profile.id,
        role: "phone",
        therapistId: patient.therapistId,
        patientId: patient.id,
      };
    }

    const ticket = issueTicket(claims);
    return json({ ticket, role: claims.role, expiresInMs: TICKET_TTL_MS }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
