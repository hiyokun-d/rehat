import { beforeEach, describe, expect, test } from "bun:test";
import type { Profile } from "../src/generated/prisma/client";
import type { HttpError } from "../src/lib/auth/http";
import {
  acceptInvite,
  consentToLink,
  createInvite,
  generateToken,
  hashToken,
  INVALID_INVITE,
  INVITE_TTL_MS,
} from "../src/lib/auth/invites";
import { allowAttempt, resetAttempts } from "../src/lib/auth/rateLimit";

type Db = Parameters<typeof createInvite>[0];

const therapist = { id: "t1", role: "THERAPIST" } as Profile;
const caregiver = { id: "c1", role: "CAREGIVER" } as Profile;
const now = new Date("2026-11-28T00:00:00Z");

// In-memory stand-in for the Prisma calls the invite flow makes.
function fakeDb() {
  const audit: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const raw: { sql: string; values: unknown[] }[] = [];
  const consumable = new Set<string>(); // tokenHashes that can still be consumed
  const state = { updateManyCount: 1 };
  const updateManyWhere: unknown[] = [];

  const db = {
    audit,
    created,
    raw,
    consumable,
    state,
    updateManyWhere,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    profile: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === "p1" ? { id: "p1" } : null,
    },
    careLink: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        if (typeof data.tokenHash === "string") consumable.add(data.tokenHash);
        return { id: "link1" };
      },
      updateMany: async ({ where }: { where: unknown }) => {
        updateManyWhere.push(where);
        return { count: state.updateManyCount };
      },
      findUnique: async () => ({ patientId: "p1" }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
    },
    // Mimics the single conditional UPDATE: only the first caller for a hash gets a row.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push({ sql: strings.join("?"), values });
      const hash = values.find((v) => typeof v === "string" && v.length === 64);
      if (typeof hash === "string" && consumable.delete(hash)) {
        return [{ id: "link1", patientId: "p1" }];
      }
      return [];
    },
  };
  return db;
}

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as HttpError,
  );

describe("token", () => {
  test("is at least 128 bits and unique", () => {
    const a = generateToken();
    expect(Buffer.from(a, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(generateToken()).not.toBe(a);
  });

  test("hash is sha256 hex and deterministic", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("createInvite", () => {
  test("stores only the hash, expires in 48h, writes audit", async () => {
    const db = fakeDb();
    const out = await createInvite(asDb(db), therapist, "p1", now);

    expect(out.expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(db.created[0]?.tokenHash).toBe(hashToken(out.token));
    expect(JSON.stringify(db.created)).not.toContain(out.token);
    expect(JSON.stringify(db.audit)).not.toContain(out.token);
    expect(db.audit[0]).toMatchObject({
      action: "invite.create",
      actorId: "t1",
      patientId: "p1",
    });
  });

  test("404 for a patient that is not the therapist's", async () => {
    const err = await failure(
      createInvite(asDb(fakeDb()), therapist, "p9", now),
    );
    expect(err?.status).toBe(404);
  });
});

describe("acceptInvite", () => {
  test("consumes once; a replay fails with the uniform message", async () => {
    const db = fakeDb();
    const { token } = await createInvite(asDb(db), therapist, "p1", now);

    const link = await acceptInvite(asDb(db), caregiver, token, now);
    expect(link).toEqual({ careLinkId: "link1", status: "PENDING" });
    expect(db.audit.at(-1)).toMatchObject({ action: "invite.accept" });

    const err = await failure(acceptInvite(asDb(db), caregiver, token, now));
    expect(err?.status).toBe(400);
    expect(err?.message).toBe(INVALID_INVITE);
  });

  test("unknown token gives the same error as a used one", async () => {
    const err = await failure(
      acceptInvite(asDb(fakeDb()), caregiver, "nope", now),
    );
    expect(err?.message).toBe(INVALID_INVITE);
  });

  test("one UPDATE carries every consume condition; raw token never reaches SQL", async () => {
    const db = fakeDb();
    const { token } = await createInvite(asDb(db), therapist, "p1", now);
    await acceptInvite(asDb(db), caregiver, token, now);

    const { sql, values } = db.raw[0] ?? { sql: "", values: [] };
    expect(sql).toContain("UPDATE");
    expect(sql).toContain(`"caregiverId" IS NULL`);
    expect(sql).toContain(`"expiresAt" >`);
    expect(sql).toContain("RETURNING");
    expect(values).toContain(hashToken(token));
    expect(values).not.toContain(token);
  });
});

describe("consentToLink", () => {
  test("restricts the update to the patient or their therapist and audits", async () => {
    const db = fakeDb();
    const out = await consentToLink(asDb(db), therapist, "link1", now);

    expect(out.status).toBe("ACTIVE");
    expect(JSON.stringify(db.updateManyWhere[0])).toContain(
      '"therapistId":"t1"',
    );
    expect(db.audit[0]).toMatchObject({
      action: "invite.consent",
      actorId: "t1",
      patientId: "p1",
    });
  });

  test("404 and no audit when nothing matched", async () => {
    const db = fakeDb();
    db.state.updateManyCount = 0;
    const err = await failure(consentToLink(asDb(db), caregiver, "link1", now));
    expect(err?.status).toBe(404);
    expect(db.audit).toHaveLength(0);
  });
});

describe("rate limit", () => {
  beforeEach(resetAttempts);

  test("allows 10 attempts per key per hour, then blocks", () => {
    for (let i = 0; i < 10; i++) expect(allowAttempt("ip", 10, 0)).toBe(true);
    expect(allowAttempt("ip", 10, 1000)).toBe(false);
    expect(allowAttempt("other", 10, 1000)).toBe(true);
    expect(allowAttempt("ip", 10, 60 * 60 * 1000 + 1)).toBe(true);
  });
});
