// Nurse dashboard domain: ownership (BOLA), device-link QR tokens, alerts and notes.
import { beforeAll, describe, expect, test } from "bun:test";
import {
  type AuthAdmin,
  ackAlert,
  addReview,
  claimDeviceLink,
  createPatientAccount,
  DEVICE_LINK_TTL_MS,
  listAlerts,
  MAX_LINK_USES,
  mintDeviceLink,
  normalizeCode,
  signLink,
  signupSchema,
  signupStaff,
  verifyLink,
} from "../src/app/api/_domain/care";
import type { Profile } from "../src/generated/prisma/client";
import type { HttpError } from "../src/lib/auth/http";

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

type Db = Parameters<typeof mintDeviceLink>[0];
type W = Record<string, unknown> & {
  id?: string;
  therapistId?: string;
  role?: string;
  action?: string;
  entityId?: string;
  patientId?: string;
  patient?: { therapistId?: string };
};

const nurseA = { id: "tA", role: "THERAPIST" } as Profile;
const nurseB = { id: "tB", role: "THERAPIST" } as Profile;

/** Patient "pA" belongs to nurse A. Nurse B owns nobody. */
function fakeDb() {
  const audit: {
    action: string;
    entityId: string;
    patientId: string;
    metadata?: { codeHash?: string };
    createdAt?: Date;
  }[] = [];
  const reviews: unknown[] = [];
  const made: { role: string; displayName: string }[] = [];
  const alerts = [{ id: "al1", patientId: "pA", status: "PENDING" }];
  const owns = (w: W) =>
    w.id === "pA" && w.therapistId === "tA" && w.role === "PATIENT";
  const db = {
    audit,
    reviews,
    made,
    alerts,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    $executeRaw: async () => 0,
    profile: {
      findFirst: async ({ where }: { where: W }) => {
        if (where.therapistId !== undefined)
          return owns(where) ? { id: "pA", displayName: "A" } : null;
        // claim path: patient lookup without therapist
        return where.id === "pA" && where.role === "PATIENT"
          ? { id: "pA" }
          : null;
      },
      createMany: async () => ({ count: 1 }),
      create: async ({
        data,
      }: {
        data: { role: string; displayName: string };
      }) => {
        made.push(data);
        return data;
      },
      updateMany: async () => ({ count: 1 }),
    },
    auditLog: {
      create: async ({ data }: { data: (typeof audit)[number] }) => {
        const row = { ...data, createdAt: new Date() };
        audit.push(row);
        return row;
      },
      count: async ({ where }: { where: W }) =>
        audit.filter(
          (a) => a.action === where.action && a.entityId === where.entityId,
        ).length,
      findFirst: async ({
        where,
      }: {
        where: W & { metadata?: { equals: string } };
      }) =>
        audit.find(
          (a) =>
            a.action === where.action &&
            (where.metadata === undefined ||
              a.metadata?.codeHash === where.metadata.equals) &&
            (where.entityId === undefined || a.entityId === where.entityId) &&
            (where.patientId === undefined || a.patientId === where.patientId),
        ) ?? null,
    },
    therapistReview: {
      create: async ({ data }: { data: { note: string } }) => {
        const r = {
          id: `r${reviews.length}`,
          note: data.note,
          createdAt: new Date(),
        };
        reviews.push(r);
        return r;
      },
      findMany: async () => reviews,
    },
    alert: {
      findFirst: async ({ where }: { where: W }) =>
        where.id === "al1" && where.patient?.therapistId === "tA"
          ? alerts[0]
          : null,
      findMany: async () => alerts,
      update: async ({ data }: { data: { status: string } }) => {
        alerts[0].status = data.status;
        return alerts[0];
      },
    },
  };
  return db as unknown as Db & typeof db;
}

function fakeAdmin(): AuthAdmin & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    createUser: async ({ email }) => {
      created.push(email);
      return { data: { user: { id: "new-user" } }, error: null };
    },
    getUserById: async (id) => ({
      data: {
        user: id === "pA" ? { email: "p-x@pasien.rehat.invalid" } : null,
      },
      error: null,
    }),
    generateLink: async () => ({
      data: { properties: { hashed_token: "hash123" } },
      error: null,
    }),
  };
}

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: HttpError) => e.status,
  );

describe("ownership (BOLA): a nurse only reaches their own patients", () => {
  test("nurse B cannot mint a phone QR for nurse A's patient", async () => {
    expect(await status(mintDeviceLink(fakeDb(), nurseB, "pA"))).toBe(404);
  });
  test("nurse B cannot read or add notes for nurse A's patient", async () => {
    const db = fakeDb();
    expect(await status(addReview(db, nurseB, "pA", { note: "x" }))).toBe(404);
    expect(db.reviews.length).toBe(0);
  });
  test("nurse B cannot read or acknowledge nurse A's alerts", async () => {
    const db = fakeDb();
    expect(await status(listAlerts(db, nurseB, "pA"))).toBe(404);
    expect(await status(ackAlert(db, nurseB, "al1", {}))).toBe(404);
    expect(db.alerts[0].status).toBe("PENDING");
  });
  test("nurse A can, and every write is audited", async () => {
    const db = fakeDb();
    await addReview(db, nurseA, "pA", { note: "Latihan lancar" });
    await ackAlert(db, nurseA, "al1", { falseAlarm: true });
    expect(db.alerts[0].status).toBe("FALSE_ALARM");
    expect(db.audit.map((a) => a.action)).toEqual([
      "review.create",
      "alert.false_alarm",
    ]);
  });
});

describe("device-link QR token", () => {
  test("round-trips and rejects tampering and expiry", () => {
    const now = 1_000_000;
    const t = signLink({ p: "pA", n: "n1", e: now + 1000 });
    expect(verifyLink(t, now)?.p).toBe("pA");
    expect(verifyLink(t, now + 2000)).toBeNull(); // expired
    const [body, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ p: "pB", n: "n1", e: now + 1000 }),
    ).toString("base64url");
    expect(verifyLink(`${forged}.${sig}`, now)).toBeNull(); // other patient, same signature
    expect(verifyLink(`${body}.AAAA`, now)).toBeNull();
    expect(verifyLink("garbage", now)).toBeNull();
  });

  test("valid 10 minutes, at most MAX_LINK_USES phones, only if minted", async () => {
    const db = fakeDb();
    const admin = fakeAdmin();
    const now = Date.now();
    const { token, expiresAt } = await mintDeviceLink(db, nurseA, "pA", now);
    expect(expiresAt - now).toBe(DEVICE_LINK_TTL_MS);

    const first = await claimDeviceLink(db, admin, token, now);
    expect(first.tokenHash).toBe("hash123");
    // Same QR on the patient's other phones (forearm, leg ...) up to the cap, then refused.
    for (let i = 1; i < MAX_LINK_USES; i++)
      expect(await status(claimDeviceLink(db, admin, token, now))).toBe(200);
    expect(await status(claimDeviceLink(db, admin, token, now))).toBe(400);
    // A correctly signed token that the server never minted: refused.
    const unminted = signLink({ p: "pA", n: "never", e: now + 60_000 });
    expect(await status(claimDeviceLink(db, admin, unminted, now))).toBe(400);
    // Expired.
    const { token: t2 } = await mintDeviceLink(db, nurseA, "pA", now);
    expect(
      await status(
        claimDeviceLink(db, admin, t2, now + DEVICE_LINK_TTL_MS + 1),
      ),
    ).toBe(400);
  });
});

describe("short sign-in code (for phones that cannot scan)", () => {
  test("works like the QR, tolerates case and dash, rejects junk", async () => {
    const db = fakeDb();
    const admin = fakeAdmin();
    const now = Date.now();
    const { code } = await mintDeviceLink(db, nurseA, "pA", now);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(db.audit[0].metadata?.codeHash).toBeDefined();
    expect(JSON.stringify(db.audit)).not.toContain(code.replace("-", ""));
    const r = await claimDeviceLink(
      db,
      admin,
      { code: code.toLowerCase() },
      now,
    );
    expect(r.tokenHash).toBe("hash123");
    expect(
      await status(claimDeviceLink(db, admin, { code: "AAAA-AAAA" }, now)),
    ).toBe(400);
    expect(await status(claimDeviceLink(db, admin, { code: "!!" }, now))).toBe(
      400,
    );
  });
  test("normalizeCode", () => {
    expect(normalizeCode(" k7qm-3xra ")).toBe("K7QM3XRA");
    expect(normalizeCode("O0O0-1111")).toBeNull();
  });
});

describe("new patient account", () => {
  test("gets an undeliverable internal email and a profile owned by the nurse", async () => {
    const admin = fakeAdmin();
    const p = await createPatientAccount(fakeDb(), admin, nurseA, {
      displayName: "Bu Sri",
    });
    expect(p.displayName).toBe("Bu Sri");
    expect(admin.created[0]).toMatch(/^p-[0-9a-f]{18}@pasien\.rehat\.invalid$/);
  });
});

describe("open staff sign-up (hackathon)", () => {
  const input = {
    displayName: "Ners Baru",
    email: "Baru@Contoh.ORG",
    password: "rahasia-panjang",
    attest: true as const,
  };
  test("creates a THERAPIST that owns nobody, audited with the attestation", async () => {
    const db = fakeDb();
    const admin = fakeAdmin();
    const r = await signupStaff(db, admin, input);
    expect(r.id).toBe("new-user");
    expect(admin.created[0]).toBe("baru@contoh.org");
    expect(db.made[0]).toMatchObject({
      role: "THERAPIST",
      displayName: "Ners Baru",
    });
    expect(db.audit.at(-1)?.action).toBe("profile.signup_therapist");
    // New nurse cannot see an existing nurse's patient.
    const fresh = { id: "new-user", role: "THERAPIST" } as Profile;
    expect(await status(mintDeviceLink(db, fresh, "pA"))).toBe(404);
  });
  test("requires the attestation and a 10+ char password", () => {
    expect(signupSchema.safeParse({ ...input, attest: false }).success).toBe(
      false,
    );
    expect(
      signupSchema.safeParse({ ...input, password: "pendek" }).success,
    ).toBe(false);
    expect(signupSchema.safeParse({ ...input, role: "PATIENT" }).success).toBe(
      false,
    );
  });
  test("an email already registered gives one generic message", async () => {
    const admin = fakeAdmin();
    admin.createUser = async () => ({
      data: { user: null },
      error: new Error("exists"),
    });
    expect(await status(signupStaff(fakeDb(), admin, input))).toBe(409);
  });
});
