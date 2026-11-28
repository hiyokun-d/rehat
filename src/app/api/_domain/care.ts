// Nurse / therapist dashboard domain: patient list, patient detail, notes, alerts, and putting a
// patient's phone online by QR. Every function takes the caller's Profile and checks ownership
// itself (OWASP A01 Broken Access Control / BOLA): a patient is "mine" only when
// Profile.therapistId = caller. Ids from the URL are never trusted on their own.
//
// The role in the database is THERAPIST for anyone who may set limits. A nurse or trained
// volunteer gets that role only from the owner (scripts/make-staff.ts), never by sign-up, and
// only if they work under a clinician's direction: limits are clinical decisions (AGENTS.md).
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Profile } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/auth/http";
import {
  DAY_MS,
  overview,
  sortForTriage,
  WINDOW_DAYS,
} from "@/lib/care/triage";
import type { prisma } from "@/lib/prisma";
import { registerPatient } from "../patients/register";

type Db = typeof prisma;

const NOT_FOUND = "Pasien tidak ditemukan.";

export const ownedPatient = (therapist: Profile) => ({
  role: Role.PATIENT,
  therapistId: therapist.id,
  deletedAt: null,
});

async function requireOwned(db: Db, therapist: Profile, patientId: string) {
  const p = await db.profile.findFirst({
    where: { id: patientId, ...ownedPatient(therapist) },
    select: { id: true, displayName: true, createdAt: true },
  });
  if (!p) throw new HttpError(404, NOT_FOUND);
  return p;
}

// --- patient list -----------------------------------------------------------

export async function listMyPatients(db: Db, therapist: Profile) {
  const patients = await db.profile.findMany({
    where: ownedPatient(therapist),
    orderBy: { createdAt: "desc" },
    select: { id: true, displayName: true, createdAt: true },
  });
  const ids = patients.map((p) => p.id);
  if (!ids.length) return [];
  const [last, pending, weekCounts] = await Promise.all([
    db.rehabSession.groupBy({
      by: ["patientId"],
      where: { patientId: { in: ids }, deletedAt: null },
      _max: { startedAt: true },
    }),
    db.alert.groupBy({
      by: ["patientId"],
      where: { patientId: { in: ids }, status: "PENDING", deletedAt: null },
      _count: { _all: true },
    }),
    db.rehabSession.groupBy({
      by: ["patientId"],
      where: {
        patientId: { in: ids },
        deletedAt: null,
        startedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      _count: { _all: true },
    }),
  ]);
  const lastBy = new Map(last.map((r) => [r.patientId, r._max.startedAt]));
  const pendBy = new Map(pending.map((r) => [r.patientId, r._count._all]));
  const weekBy = new Map(weekCounts.map((r) => [r.patientId, r._count._all]));
  return patients.map((p) => ({
    ...p,
    lastSessionAt: lastBy.get(p.id) ?? null,
    pendingAlerts: pendBy.get(p.id) ?? 0,
    sessionsThisWeek: weekBy.get(p.id) ?? 0,
  }));
}

// --- patient detail ---------------------------------------------------------

export async function patientDetail(db: Db, therapist: Profile, id: string) {
  const patient = await requireOwned(db, therapist, id);
  const [program, catalog] = await Promise.all([
    db.program.findFirst({
      where: {
        patientId: id,
        therapistId: therapist.id,
        active: true,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        planExercises: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            exercise: { select: { id: true, slug: true, name: true } },
            envelopes: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                version: true,
                maxAngleDeg: true,
                maxVelDegPerS: true,
                debounceMs: true,
                onBreach: true,
                notifyCaregiver: true,
                createdAt: true,
              },
            },
          },
        },
      },
    }),
    db.exercise.findMany({
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true, description: true },
    }),
  ]);
  return {
    patient,
    program: program && {
      id: program.id,
      title: program.title,
      exercises: program.planExercises.map((pe) => ({
        id: pe.id,
        position: pe.position,
        exercise: pe.exercise,
        envelope: pe.envelopes[0] ?? null,
      })),
    },
    catalog,
  };
}

// --- notes (TherapistReview) ------------------------------------------------

export const reviewSchema = z.strictObject({
  note: z.string().trim().min(1).max(2000),
});

export async function listReviews(
  db: Db,
  therapist: Profile,
  patientId: string,
) {
  await requireOwned(db, therapist, patientId);
  return db.therapistReview.findMany({
    where: { patientId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, note: true, createdAt: true, therapistId: true },
  });
}

export async function addReview(
  db: Db,
  therapist: Profile,
  patientId: string,
  input: z.infer<typeof reviewSchema>,
) {
  await requireOwned(db, therapist, patientId);
  return db.$transaction(async (tx) => {
    const review = await tx.therapistReview.create({
      data: { note: input.note, patientId, therapistId: therapist.id },
      select: { id: true, note: true, createdAt: true, therapistId: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId,
        action: "review.create",
        entityType: "TherapistReview",
        entityId: review.id,
      },
    });
    return review;
  });
}

// --- alerts -----------------------------------------------------------------

export async function listAlerts(
  db: Db,
  therapist: Profile,
  patientId: string,
) {
  await requireOwned(db, therapist, patientId);
  return db.alert.findMany({
    where: { patientId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      level: true,
      status: true,
      createdAt: true,
      acknowledgedAt: true,
      sessionId: true,
      breachEvent: {
        select: {
          kind: true,
          value: true,
          limit: true,
          heldMs: true,
          occurredAt: true,
        },
      },
    },
  });
}

export const ackSchema = z.strictObject({
  /** "false alarm" is the AGENTS.md "this alert was wrong" button. */
  falseAlarm: z.boolean().optional(),
});

export async function ackAlert(
  db: Db,
  therapist: Profile,
  alertId: string,
  input: z.infer<typeof ackSchema>,
) {
  const alert = await db.alert.findFirst({
    where: { id: alertId, deletedAt: null, patient: ownedPatient(therapist) },
    select: { id: true, patientId: true, status: true },
  });
  if (!alert) throw new HttpError(404, "Peringatan tidak ditemukan.");
  const status = input.falseAlarm ? "FALSE_ALARM" : "ACKNOWLEDGED";
  return db.$transaction(async (tx) => {
    const row = await tx.alert.update({
      where: { id: alert.id },
      data: { status, acknowledgedAt: new Date() },
      select: { id: true, status: true, acknowledgedAt: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: therapist.id,
        patientId: alert.patientId,
        action: input.falseAlarm ? "alert.false_alarm" : "alert.ack",
        entityType: "Alert",
        entityId: alert.id,
        metadata: { from: alert.status },
      },
    });
    return row;
  });
}

// --- new patient account ----------------------------------------------------

export const newPatientSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
});

/** Minimal surface of supabase-js admin we use, so tests can pass a fake. */
export interface AuthAdmin {
  createUser(a: {
    email: string;
    password: string;
    email_confirm: boolean;
    app_metadata?: Record<string, unknown>;
  }): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  getUserById(
    id: string,
  ): Promise<{ data: { user: { email?: string } | null }; error: unknown }>;
  generateLink(a: { type: "magiclink"; email: string }): Promise<{
    data: { properties: { hashed_token: string } | null } | null;
    error: unknown;
  }>;
}

/**
 * Many patients have no email (older people, family phone). The nurse creates the account; it gets
 * an internal address on the reserved ".invalid" domain (RFC 2606: can never receive mail) and a
 * random password nobody sees. The patient's phone signs in by scanning a QR (below), never with
 * a password.
 */
export async function createPatientAccount(
  db: Db,
  admin: AuthAdmin,
  therapist: Profile,
  input: z.infer<typeof newPatientSchema>,
) {
  const email = `p-${randomBytes(9).toString("hex")}@pasien.rehat.invalid`;
  const { data, error } = await admin.createUser({
    email,
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
    app_metadata: { created_by: "rehat-dashboard" },
  });
  if (error || !data.user)
    throw new HttpError(502, "Akun pasien gagal dibuat.");
  const { patient } = await registerPatient(db, therapist, {
    authUserId: data.user.id,
    displayName: input.displayName,
  });
  return patient;
}

// --- phone sign-in by QR ("device link") -------------------------------------
//
// Token = base64url(payload) "." base64url(HMAC-SHA256(key, payload)), payload = {p, n, e}:
// patient id, random nonce, expiry. Valid 10 minutes, single use. The key is derived from the
// service-role key (already a server-only secret) so deploys need no extra env var.
// Limited use without a new table: minting writes AuditLog "device.link.mint" (nonce), each claim
// writes "device.link.claim" under a per-nonce advisory lock and counts the earlier claims.
// One QR may sign in up to MAX_LINK_USES phones of the SAME patient (arm + forearm + leg ...), so
// the nurse shows one QR and every phone scans it. Trade-off: a leaked QR could add a phone within
// those 10 minutes; the cap and the short life bound that, and every claim is audited.

export const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
export const MAX_LINK_USES = 4;

function linkKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new HttpError(500, "Server belum dikonfigurasi.");
  return createHash("sha256").update(`rehat/device-link/v1|${secret}`).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signLink(
  payload: { p: string; n: string; e: number },
  key = linkKey(),
): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac("sha256", key).update(body).digest())}`;
}

// Short code for phones that cannot scan (no camera app, broken camera, low vision helper reads
// it out). 8 symbols from a 31-letter alphabet without 0/O/1/I/L = ~39.6 bits. Valid as long as
// the QR (10 min), same use cap, and the claim route is rate limited per IP, so guessing a live
// code is impractical. Only an HMAC of the code is stored (AuditLog metadata), never the code.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newLinkCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** Uppercase, drop spaces/dashes, map look-alikes (O->0 is not in the alphabet, so O->0 fails). */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== 8) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function codeHash(code: string, key = linkKey()): string {
  return createHmac("sha256", key).update(`code|${code}`).digest("hex");
}

export function verifyLink(
  token: string,
  now = Date.now(),
  key = linkKey(),
): { p: string; n: string; e: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || token.length > 512) return null;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof v.p !== "string" ||
      typeof v.n !== "string" ||
      typeof v.e !== "number" ||
      v.e < now
    )
      return null;
    return v;
  } catch {
    return null;
  }
}

export async function mintDeviceLink(
  db: Db,
  therapist: Profile,
  patientId: string,
  now = Date.now(),
) {
  await requireOwned(db, therapist, patientId);
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + DEVICE_LINK_TTL_MS;
  const code = newLinkCode();
  await db.auditLog.create({
    data: {
      actorId: therapist.id,
      patientId,
      action: "device.link.mint",
      entityType: "DeviceLink",
      entityId: nonce,
      metadata: { codeHash: codeHash(code), exp: expiresAt },
    },
  });
  return {
    token: signLink({ p: patientId, n: nonce, e: expiresAt }),
    code: `${code.slice(0, 4)}-${code.slice(4)}`,
    expiresAt,
  };
}

export const claimSchema = z
  .strictObject({
    token: z.string().min(10).max(512).optional(),
    code: z.string().min(8).max(16).optional(),
  })
  .refine((x) => !!x.token !== !!x.code, { message: "token atau code" });

const BAD_LINK = "Kode tidak berlaku. Minta kode baru ke perawat.";

/** Code -> the same claims a QR token carries, from the mint row. Null if unknown/expired. */
async function claimsFromCode(
  db: Db,
  raw: string,
  now: number,
): Promise<{ p: string; n: string; e: number } | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  const row = await db.auditLog.findFirst({
    where: {
      action: "device.link.mint",
      createdAt: { gte: new Date(now - DEVICE_LINK_TTL_MS) },
      metadata: { path: ["codeHash"], equals: codeHash(code) },
    },
    select: { entityId: true, patientId: true, createdAt: true },
  });
  if (!row?.entityId || !row.patientId) return null;
  const e = row.createdAt.getTime() + DEVICE_LINK_TTL_MS;
  return e < now ? null : { p: row.patientId, n: row.entityId, e };
}

export async function claimDeviceLink(
  db: Db,
  admin: AuthAdmin,
  input: string | { token?: string; code?: string },
  now = Date.now(),
) {
  const { token, code } = typeof input === "string" ? { token: input } : input;
  const claims = token
    ? verifyLink(token, now)
    : code
      ? await claimsFromCode(db, code, now)
      : null;
  if (!claims) throw new HttpError(400, BAD_LINK);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`devlink:${claims.n}`}))`;
    const [minted, used, patient] = await Promise.all([
      tx.auditLog.findFirst({
        where: {
          action: "device.link.mint",
          entityId: claims.n,
          patientId: claims.p,
        },
        select: { id: true },
      }),
      tx.auditLog.count({
        where: { action: "device.link.claim", entityId: claims.n },
      }),
      tx.profile.findFirst({
        where: { id: claims.p, role: Role.PATIENT, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!minted || used >= MAX_LINK_USES || !patient)
      throw new HttpError(400, BAD_LINK);
    await tx.auditLog.create({
      data: {
        actorId: claims.p,
        patientId: claims.p,
        action: "device.link.claim",
        entityType: "DeviceLink",
        entityId: claims.n,
      },
    });
  });
  const { data: u, error: ue } = await admin.getUserById(claims.p);
  if (ue || !u.user?.email) throw new HttpError(400, BAD_LINK);
  const { data, error } = await admin.generateLink({
    type: "magiclink",
    email: u.user.email,
  });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new HttpError(502, "Gagal masuk. Coba lagi.");
  // The browser exchanges this once with supabase.auth.verifyOtp; it is never logged.
  return { tokenHash: hash };
}

// --- overview (work list) ------------------------------------------------------

/**
 * Everything the dashboard list needs, for ALL of the caller's patients, in 4 queries.
 * Numbers are computed by src/lib/care/triage.ts (pure, tested).
 */
export async function patientsOverview(
  db: Db,
  therapist: Profile,
  now = Date.now(),
) {
  const patients = await db.profile.findMany({
    where: ownedPatient(therapist),
    select: { id: true, displayName: true },
  });
  const ids = patients.map((p) => p.id);
  if (!ids.length) return [];
  const since = new Date(now - WINDOW_DAYS * DAY_MS);
  const [sessions, pending, plan] = await Promise.all([
    db.rehabSession.findMany({
      where: {
        patientId: { in: ids },
        deletedAt: null,
        startedAt: { gte: since },
      },
      select: {
        patientId: true,
        startedAt: true,
        status: true,
        reportedBy: true,
        planExercise: { select: { exercise: { select: { name: true } } } },
        attempt: {
          select: {
            reps: true,
            activeMs: true,
            maxAngleDeg: true,
            maxVelDegPerS: true,
            pauses: true,
            sparcMedian: true,
          },
        },
        _count: { select: { breaches: true } },
      },
    }),
    db.alert.groupBy({
      by: ["patientId"],
      where: { patientId: { in: ids }, status: "PENDING", deletedAt: null },
      _count: { _all: true },
    }),
    db.planExercise.findMany({
      where: {
        deletedAt: null,
        program: { patientId: { in: ids }, active: true, deletedAt: null },
        envelopes: { none: {} },
      },
      select: {
        program: { select: { patientId: true } },
        exercise: { select: { name: true } },
      },
    }),
  ]);
  const pendBy = new Map(pending.map((r) => [r.patientId, r._count._all]));
  const help = await openHelp(db, ids, now);
  const list = patients.map((p) => ({
    ...overview(
      {
        id: p.id,
        displayName: p.displayName,
        pendingAlerts: pendBy.get(p.id) ?? 0,
        exercisesWithoutEnvelope: plan
          .filter((x) => x.program.patientId === p.id)
          .map((x) => x.exercise.name),
        sessions: sessions
          .filter((s) => s.patientId === p.id)
          .map((s) => ({
            startedAt: s.startedAt.toISOString(),
            status: s.status,
            exercise: s.planExercise.exercise.name,
            reportedBy: s.reportedBy,
            reps: s.attempt?.reps ?? null,
            activeMs: s.attempt?.activeMs ?? null,
            maxAngleDeg: s.attempt?.maxAngleDeg ?? null,
            maxVelDegPerS: s.attempt?.maxVelDegPerS ?? null,
            pauses: s.attempt?.pauses ?? null,
            sparc: s.attempt?.sparcMedian ?? null,
            breaches: s._count.breaches,
          })),
      },
      now,
    ),
    openHelp: help.get(p.id) ?? [],
  }));
  // An open help request goes above everything else.
  for (const o of list)
    if (o.openHelp.length) {
      o.priority += 1000;
      o.flags.unshift({
        code: "help",
        level: "high",
        text: `Pasien minta bantuan (${new Date(o.openHelp[0].at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB)`,
      });
    }
  return sortForTriage(list) as typeof list;
}

// --- help requests and nurse messages ------------------------------------------
//
// Stored as AuditLog rows (append-only, already exists) so nothing is lost if no dashboard is open:
// "help.request" (patient -> their nurse) and "help.ack" (nurse closes it), "message.send"
// (nurse -> patient phones). Delivery is a best-effort realtime push on top.

export const HELP_OPEN_MS = 24 * 60 * 60 * 1000;

export async function requestHelp(
  db: Db,
  patient: Profile,
  push: (staffId: string, payload: Record<string, unknown>) => Promise<unknown>,
) {
  if (patient.role !== Role.PATIENT || !patient.therapistId)
    throw new HttpError(409, "Akun ini belum terhubung ke perawat.");
  const row = await db.auditLog.create({
    data: {
      actorId: patient.id,
      patientId: patient.id,
      action: "help.request",
      entityType: "Profile",
      entityId: patient.id,
    },
    select: { id: true, createdAt: true },
  });
  await push(patient.therapistId, {
    requestId: row.id,
    patientId: patient.id,
    displayName: patient.displayName,
    at: row.createdAt.toISOString(),
  });
  return { requestId: row.id };
}

/** Open = requested in the last 24 h and not acknowledged. Per patient id. */
export async function openHelp(db: Db, patientIds: string[], now = Date.now()) {
  if (!patientIds.length)
    return new Map<string, { id: string; at: string }[]>();
  const since = new Date(now - HELP_OPEN_MS);
  const [reqs, acks] = await Promise.all([
    db.auditLog.findMany({
      where: {
        action: "help.request",
        patientId: { in: patientIds },
        createdAt: { gte: since },
      },
      select: { id: true, patientId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.findMany({
      where: {
        action: "help.ack",
        patientId: { in: patientIds },
        createdAt: { gte: since },
      },
      select: { entityId: true },
    }),
  ]);
  const acked = new Set(acks.map((a) => a.entityId));
  const out = new Map<string, { id: string; at: string }[]>();
  for (const r of reqs) {
    if (!r.patientId || acked.has(r.id)) continue;
    out.set(r.patientId, [
      ...(out.get(r.patientId) ?? []),
      { id: r.id, at: r.createdAt.toISOString() },
    ]);
  }
  return out;
}

export async function ackHelp(db: Db, therapist: Profile, requestId: string) {
  const req = await db.auditLog.findFirst({
    where: { id: requestId, action: "help.request" },
    select: { id: true, patientId: true },
  });
  if (!req?.patientId) throw new HttpError(404, "Permintaan tidak ditemukan.");
  await requireOwned(db, therapist, req.patientId);
  await db.auditLog.create({
    data: {
      actorId: therapist.id,
      patientId: req.patientId,
      action: "help.ack",
      entityType: "AuditLog",
      entityId: req.id,
    },
  });
  return { ok: true };
}

export const messageSchema = z.strictObject({
  text: z.string().trim().min(1).max(200),
});

export async function sendMessage(
  db: Db,
  therapist: Profile,
  patientId: string,
  input: z.infer<typeof messageSchema>,
  push: (
    patientId: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>,
) {
  await requireOwned(db, therapist, patientId);
  const row = await db.auditLog.create({
    data: {
      actorId: therapist.id,
      patientId,
      action: "message.send",
      entityType: "Profile",
      entityId: patientId,
      // AuditLog rule: no health content in metadata. Only the length is kept.
      metadata: { length: input.text.length },
    },
    select: { id: true, createdAt: true },
  });
  const delivered = await push(patientId, {
    text: input.text,
    from: therapist.displayName,
    at: row.createdAt.toISOString(),
  });
  return { id: row.id, delivered: delivered === true };
}

// --- open staff sign-up (team decision 28 Nov 2026: fully open) --------------------
//
// Anyone can register as THERAPIST (nurse / therapist / trained volunteer). Why this is bounded:
// a new account sees ONLY patients it creates itself (ownedPatient), so signing up grants no
// access to anyone else's data. What it does NOT bound: an unqualified person entering limits
// for their own patients. Mitigations: the attestation below is required and audited, the
// program editor warns that limits must come from a therapist, and sign-ups are rate limited.
// No email verification (admin.createUser with email_confirm) so the demo works without SMTP;
// someone could register an address they do not own, but it grants nothing beyond a fresh
// empty account.

/** HACKATHON ONLY: open sign-up. Set STAFF_SIGNUP=closed to turn it off (no code change). */
export const signupOpen = () => process.env.STAFF_SIGNUP !== "closed";

export const signupSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(10).max(200),
  attest: z.literal(true),
});

export const SIGNUP_FAILED =
  "Pendaftaran gagal. Email mungkin sudah terdaftar; coba masuk atau pakai email lain.";

export async function signupStaff(
  db: Db,
  admin: AuthAdmin,
  input: z.infer<typeof signupSchema>,
) {
  const { data, error } = await admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true,
    app_metadata: { created_by: "signup" },
  });
  // Same message for "already registered" and other failures: no detail from the provider.
  if (error || !data.user) throw new HttpError(409, SIGNUP_FAILED);
  const id = data.user.id;
  await db.$transaction(async (tx) => {
    await tx.profile.create({
      data: { id, role: Role.THERAPIST, displayName: input.displayName },
    });
    await tx.auditLog.create({
      data: {
        actorId: id,
        patientId: null,
        action: "profile.signup_therapist",
        entityType: "Profile",
        entityId: id,
        metadata: { attest: "limits-from-therapist/v1" },
      },
    });
  });
  return { id };
}
