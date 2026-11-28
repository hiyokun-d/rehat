// Authorization entry point for route handlers and the data layer. The role always comes from
// the Profile table, never from Supabase user_metadata (users can write that themselves).
// proxy.ts only refreshes the session; every route must call one of these itself.
import type { Profile, Role } from "@/generated/prisma/client";
import { Role as RoleEnum } from "@/generated/prisma/enums";
import type { prisma } from "@/lib/prisma";
import { HttpError } from "./http";

export type ProfileRole = Role;

export type SessionUser = { id: string };

export type GuardDeps = {
  getUser: () => Promise<SessionUser | null>;
  findProfile: (id: string) => Promise<Profile | null>;
  /** First touch: creates the Profile when none exists. Absent means unknown users get 403. */
  ensureProfile?: (id: string) => Promise<Profile | null>;
};

type Db = typeof prisma;

export const DEFAULT_DISPLAY_NAME = "Pasien";

/**
 * Creates the Profile for a valid Supabase user who has none, always as PATIENT. The role is
 * fixed here and never read from the request or user_metadata; THERAPIST is set only by the
 * owner in SQL (docs/ACCOUNT-SETUP.md). Idempotent: concurrent first calls insert one row
 * (ON CONFLICT DO NOTHING) and only the winner writes the audit entry. A soft-deleted Profile
 * keeps its id, so it is not recreated and stays denied.
 */
export async function ensurePatientProfile(
  db: Db,
  id: string,
): Promise<Profile | null> {
  await db.$transaction(async (tx) => {
    const { count } = await tx.profile.createMany({
      data: [{ id, role: RoleEnum.PATIENT, displayName: DEFAULT_DISPLAY_NAME }],
      skipDuplicates: true,
    });
    if (count === 0) return;
    await tx.auditLog.create({
      data: {
        actorId: id,
        patientId: id,
        action: "profile.autocreate",
        entityType: "Profile",
        entityId: id,
      },
    });
  });
  return db.profile.findFirst({ where: { id, deletedAt: null } });
}

const defaultDeps: GuardDeps = {
  async getUser() {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    // getUser() validates the token with Supabase; getSession() would trust the cookie.
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id } : null;
  },
  async findProfile(id) {
    const { prisma } = await import("@/lib/prisma");
    return prisma.profile.findFirst({ where: { id, deletedAt: null } });
  },
  async ensureProfile(id) {
    const { prisma } = await import("@/lib/prisma");
    return ensurePatientProfile(prisma, id);
  },
};

/** The authenticated Supabase user, or null. Does not check that a Profile exists. */
export function getSessionUser(deps: GuardDeps = defaultDeps) {
  return deps.getUser();
}

/** Any signed-in user. A first-time user gets a PATIENT Profile. Throws 401 (no session). */
export async function requireUser(
  deps: GuardDeps = defaultDeps,
): Promise<Profile> {
  const user = await deps.getUser();
  if (!user) throw new HttpError(401, "Silakan masuk terlebih dahulu.");
  const profile =
    (await deps.findProfile(user.id)) ??
    (await deps.ensureProfile?.(user.id)) ??
    null;
  if (!profile) throw new HttpError(403, "Akses ditolak.");
  return profile;
}

/** Signed-in user whose Profile.role is one of `roles`. Fails closed when `roles` is empty. */
export async function requireRole(...roles: ProfileRole[]): Promise<Profile> {
  return requireRoleWith(defaultDeps, roles);
}

export async function requireRoleWith(
  deps: GuardDeps,
  roles: ProfileRole[],
): Promise<Profile> {
  const profile = await requireUser(deps);
  if (!roles.includes(profile.role)) {
    throw new HttpError(403, "Akses ditolak.");
  }
  return profile;
}
