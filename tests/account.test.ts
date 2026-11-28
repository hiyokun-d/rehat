import { describe, expect, test } from "bun:test";
import {
  registerPatient,
  registerPatientSchema,
} from "../src/app/api/patients/register";
import type { Profile } from "../src/generated/prisma/client";
import {
  ensurePatientProfile,
  type GuardDeps,
  requireRoleWith,
  requireUser,
} from "../src/lib/auth/guard";
import type { HttpError } from "../src/lib/auth/http";
import {
  acceptInvite,
  consentToLink,
  hashToken,
  revokeLink,
  revokeSchema,
} from "../src/lib/auth/invites";

type Row = Record<string, unknown>;

const T = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const P = "00000000-0000-4000-8000-000000000011";
const C = "00000000-0000-4000-8000-000000000021";
const X = "00000000-0000-4000-8000-000000000099";
const LINK = "00000000-0000-4000-8000-0000000000a1";

// In-memory Profile / CareLink / AuditLog with the few where-shapes these flows use.
function fakeDb() {
  const profiles: Row[] = [];
  const links: Row[] = [];
  const audit: Row[] = [];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in v
        ? (v as { in: unknown[] }).in.includes(row[k])
        : (row[k] ?? null) === v,
    );
  const db = {
    profiles,
    links,
    audit,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    profile: {
      findFirst: async ({ where }: { where: Row }) =>
        profiles.find((p) => matches(p, where)) ?? null,
      createMany: async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const d of data) {
          if (profiles.some((p) => p.id === d.id)) continue;
          profiles.push({ therapistId: null, ...d });
          count++;
        }
        return { count };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = profiles.filter((p) => matches(p, where));
        for (const p of hit) Object.assign(p, data);
        return { count: hit.length };
      },
    },
    careLink: {
      findFirst: async ({ where }: { where: Row }) =>
        links.find((l) => matches(l, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = links.filter((l) => matches(l, where));
        for (const l of hit) Object.assign(l, data);
        return { count: hit.length };
      },
      findUnique: async ({ where }: { where: Row }) =>
        links.find((l) => matches(l, where)) ?? null,
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        audit.push(data);
        return data;
      },
    },
    // acceptInvite's single conditional UPDATE
    $queryRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const l = links.find((x) => x.tokenHash === values[2]);
      if (!l || l.caregiverId) return [];
      l.caregiverId = values[0];
      l.tokenHash = null;
      return [{ id: l.id, patientId: l.patientId }];
    },
  };
  return db;
}
type FakeDb = ReturnType<typeof fakeDb>;
const asDb = (db: FakeDb) => db as unknown as Parameters<typeof revokeLink>[0];
const profile = (id: string, role: Profile["role"], therapistId = null) =>
  ({ id, role, therapistId, displayName: "x" }) as unknown as Profile;
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as HttpError,
  );

describe("first-touch Profile (R1-K8)", () => {
  test("creates a PATIENT once and audits once, even when called twice", async () => {
    const db = fakeDb();
    const a = await ensurePatientProfile(asDb(db), X);
    const b = await ensurePatientProfile(asDb(db), X);
    expect(a?.role).toBe("PATIENT");
    expect(b?.id).toBe(X);
    expect(db.profiles).toHaveLength(1);
    expect(db.audit).toEqual([
      expect.objectContaining({ action: "profile.autocreate", actorId: X }),
    ]);
  });

  test("never creates anything but PATIENT, whatever the session claims", async () => {
    const db = fakeDb();
    const deps: GuardDeps = {
      getUser: async () => ({ id: X, role: "THERAPIST" }) as { id: string },
      findProfile: async (id) =>
        (db.profiles.find((p) => p.id === id) as unknown as Profile) ?? null,
      ensureProfile: (id) => ensurePatientProfile(asDb(db), id),
    };
    const me = await requireUser(deps);
    expect(me.role).toBe("PATIENT");
    const err = await failure(requireRoleWith(deps, ["THERAPIST"]));
    expect(err?.status).toBe(403);
  });

  test("a soft-deleted Profile is not recreated and stays denied", async () => {
    const db = fakeDb();
    db.profiles.push({ id: X, role: "PATIENT", deletedAt: new Date() });
    expect(await ensurePatientProfile(asDb(db), X)).toBeNull();
    expect(db.audit).toHaveLength(0);
  });

  test("the register body cannot carry a role or therapistId", () => {
    for (const extra of [{ role: "THERAPIST" }, { therapistId: T }]) {
      expect(
        registerPatientSchema.safeParse({ authUserId: X, ...extra }).success,
      ).toBe(false);
    }
  });
});

describe("POST /api/patients logic", () => {
  const therapist = profile(T, "THERAPIST");

  test("creates a patient owned by the logged-in therapist and audits", async () => {
    const db = fakeDb();
    const out = await registerPatient(asDb(db), therapist, { authUserId: X });
    expect(out.changed).toBe(true);
    expect(db.profiles[0]).toMatchObject({
      id: X,
      role: "PATIENT",
      therapistId: T,
    });
    expect(db.audit[0]).toMatchObject({
      action: "patient.register",
      actorId: T,
    });
  });

  test("completes a first-touch Profile and is idempotent for the same therapist", async () => {
    const db = fakeDb();
    await ensurePatientProfile(asDb(db), X);
    expect(
      (await registerPatient(asDb(db), therapist, { authUserId: X })).changed,
    ).toBe(true);
    expect(db.profiles[0]?.therapistId).toBe(T);
    expect(
      (await registerPatient(asDb(db), therapist, { authUserId: X })).changed,
    ).toBe(false);
  });

  test("409 for a patient of another therapist and for a non-patient", async () => {
    const db = fakeDb();
    db.profiles.push({ id: X, role: "PATIENT", therapistId: T2 });
    db.profiles.push({ id: C, role: "CAREGIVER", therapistId: null });
    for (const id of [X, C]) {
      const err = await failure(
        registerPatient(asDb(db), therapist, { authUserId: id }),
      );
      expect(err?.status).toBe(409);
    }
    expect(db.profiles[0]?.therapistId).toBe(T2);
  });

  test("non-therapists are 403 at the guard", async () => {
    for (const role of ["PATIENT", "CAREGIVER"] as const) {
      const deps: GuardDeps = {
        getUser: async () => ({ id: P }),
        findProfile: async () => profile(P, role),
      };
      expect(
        (await failure(requireRoleWith(deps, ["THERAPIST"])))?.status,
      ).toBe(403);
    }
  });
});

describe("accept makes a first-touch user a caregiver, only with a valid token", () => {
  const seed = (db: FakeDb) => {
    db.profiles.push({ id: C, role: "PATIENT", therapistId: null });
    db.links.push({
      id: LINK,
      status: "PENDING",
      patientId: P,
      caregiverId: null,
      tokenHash: hashToken("tok"),
    });
  };

  test("valid token: role flips to CAREGIVER and both steps are audited", async () => {
    const db = fakeDb();
    seed(db);
    await acceptInvite(asDb(db), profile(C, "PATIENT"), "tok");
    expect(db.profiles[0]?.role).toBe("CAREGIVER");
    expect(db.audit.map((a) => a.action)).toEqual([
      "profile.role_caregiver",
      "invite.accept",
    ]);
  });

  test("a patient who has a therapist is refused and the token stays unused", async () => {
    const db = fakeDb();
    seed(db);
    db.profiles[0] = { id: C, role: "PATIENT", therapistId: T };
    const err = await failure(
      acceptInvite(asDb(db), profile(C, "PATIENT"), "tok"),
    );
    expect(err?.status).toBe(403);
    expect(db.links[0]?.caregiverId).toBeNull();
  });
});

describe("revokeLink (R1-M3)", () => {
  const link = (status: string) => ({
    id: LINK,
    status,
    patientId: P,
    caregiverId: C,
    tokenHash: null,
    revokedAt: null,
  });
  const now = new Date("2026-11-28T00:00:00Z");

  test("the patient revokes: status, revokedAt and audit are written", async () => {
    const db = fakeDb();
    db.links.push(link("ACTIVE"));
    const out = await revokeLink(asDb(db), profile(P, "PATIENT"), LINK, now);
    expect(out.status).toBe("REVOKED");
    expect(db.links[0]).toMatchObject({ status: "REVOKED", revokedAt: now });
    expect(db.audit[0]).toMatchObject({
      action: "invite.revoke",
      actorId: P,
      patientId: P,
    });
  });

  test("the link's caregiver can revoke too", async () => {
    const db = fakeDb();
    db.links.push(link("ACTIVE"));
    await revokeLink(asDb(db), profile(C, "CAREGIVER"), LINK, now);
    expect(db.links[0]?.status).toBe("REVOKED");
  });

  test("anyone else, the therapist included, and unknown ids get 403 with no change", async () => {
    const db = fakeDb();
    db.links.push(link("ACTIVE"));
    for (const actor of [profile(X, "PATIENT"), profile(T, "THERAPIST")]) {
      expect((await failure(revokeLink(asDb(db), actor, LINK)))?.status).toBe(
        403,
      );
    }
    expect(
      (await failure(revokeLink(asDb(db), profile(P, "PATIENT"), X)))?.status,
    ).toBe(403);
    expect(db.links[0]?.status).toBe("ACTIVE");
    expect(db.audit).toHaveLength(0);
  });

  test("after revoke the link is filtered out of ACTIVE reads and cannot be re-consented", async () => {
    const db = fakeDb();
    db.links.push(link("ACTIVE"));
    await revokeLink(asDb(db), profile(P, "PATIENT"), LINK, now);

    expect(
      await db.careLink.findFirst({
        where: { caregiverId: C, status: "ACTIVE" },
      }),
    ).toBeNull();
    expect(
      (await failure(revokeLink(asDb(db), profile(P, "PATIENT"), LINK)))
        ?.status,
    ).toBe(409);
    const consent = await failure(
      consentToLink(asDb(db), profile(P, "PATIENT"), LINK, now),
    );
    expect(consent?.status).toBe(404);
    expect(db.links[0]?.status).toBe("REVOKED");
  });

  test("the body takes only careLinkId", () => {
    expect(
      revokeSchema.safeParse({ careLinkId: LINK, status: "ACTIVE" }).success,
    ).toBe(false);
  });
});
