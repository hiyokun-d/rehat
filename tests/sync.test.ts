import { describe, expect, test } from "bun:test";
import type { Profile } from "../src/generated/prisma/client";
import type { HttpError } from "../src/lib/auth/http";
import {
  ingestBatch,
  resolvePatient,
  type SessionItem,
  type SyncDb,
  sessionItemSchema,
  syncBatchSchema,
} from "../src/lib/relay/sync";

const patient = { id: "p1", role: "PATIENT" } as Profile;
const caregiver = { id: "c1", role: "CAREGIVER" } as Profile;
const otherPatient = { id: "p2", role: "PATIENT" } as Profile;
const now = new Date("2026-11-28T00:00:00Z");
const CID = "11111111-1111-4111-8111-111111111111";
const CID2 = "22222222-2222-4222-8222-222222222222";

function item(over: Partial<SessionItem> = {}): SessionItem {
  return {
    clientId: CID,
    exercise: "shoulder-flexion",
    status: "COMPLETED",
    startedAt: "2026-11-28T00:00:00.000Z",
    endedAt: "2026-11-28T00:05:00.000Z",
    envelopeVersion: 3,
    reps: 10,
    activeMs: 300000,
    maxAngleDeg: 85.5,
    maxVelDegS: 110,
    pauses: 1,
    breaches: [
      { kind: "angle", value: 95, limit: 90, heldMs: 400, atMs: 2000 },
    ],
    ...over,
  };
}

type Row = Record<string, unknown>;
type State = {
  sessions: Map<string, { patientId: string; reporterId: string }>;
  attempts: Row[];
  breaches: Row[];
  feedbacks: Row[];
  audit: Row[];
  alerts: Row[];
};

// In-memory stand-in for the Prisma calls ingestBatch makes. The raw INSERT models
// ON CONFLICT DO NOTHING on the RehabSession id, and $transaction rolls back on a throw.
function fakeDb(
  opts: {
    versions?: number[];
    hasPlan?: boolean;
    failBreachWrites?: { times: number };
    envelopeBehavior?: {
      onBreach: "CUE_ONLY" | "CUE_AND_PAUSE";
      notifyCaregiver: boolean;
    };
    caregiverId?: string | null;
  } = {},
) {
  const { versions = [3], hasPlan = true, failBreachWrites } = opts;
  const behavior = opts.envelopeBehavior ?? {
    onBreach: "CUE_ONLY",
    notifyCaregiver: false,
  };
  const state: State = {
    sessions: new Map(),
    attempts: [],
    breaches: [],
    feedbacks: [],
    audit: [],
    alerts: [],
  };
  const planWhere: unknown[] = [];

  const db = {
    ...state,
    planWhere,
    planExercise: {
      findFirst: async ({ where }: { where: unknown }) => {
        planWhere.push(where);
        return hasPlan ? { id: "pe1" } : null;
      },
    },
    safetyEnvelope: {
      findFirst: async ({ where }: { where: { version?: number } }) => {
        if (where.version !== undefined) {
          return versions.includes(where.version)
            ? { version: where.version, ...behavior }
            : null;
        }
        return versions.length
          ? { version: Math.max(...versions), ...behavior }
          : null;
      },
    },
    careLink: {
      findFirst: async () =>
        opts.caregiverId ? { caregiverId: opts.caregiverId } : null,
    },
    attemptSummary: {
      create: async ({ data }: { data: Row }) => void state.attempts.push(data),
    },
    breachEvent: {
      createMany: async ({ data }: { data: Row[] }) => {
        if (failBreachWrites && failBreachWrites.times > 0) {
          failBreachWrites.times--;
          throw new Error("boom: int out of range");
        }
        state.breaches.push(...data);
      },
    },
    feedback: {
      create: async ({ data }: { data: Row }) =>
        void state.feedbacks.push(data),
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => void state.audit.push(data),
    },
    alert: {
      create: async ({ data }: { data: Row }) => {
        state.alerts.push(data);
        return { id: `alert${state.alerts.length}`, ...data };
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('INSERT INTO "RehabSession"')) {
        const id = values[0] as string;
        if (state.sessions.has(id)) return []; // ON CONFLICT DO NOTHING
        state.sessions.set(id, {
          patientId: values[values.length - 3] as string,
          reporterId: values[values.length - 2] as string,
        });
        return [{ id }];
      }
      if (sql.includes('SELECT "patientId", "reporterId"')) {
        const row = state.sessions.get(values[0] as string);
        return row ? [row] : [];
      }
      return [];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        sessions: new Map(state.sessions),
        attempts: [...state.attempts],
        breaches: [...state.breaches],
        feedbacks: [...state.feedbacks],
        audit: [...state.audit],
        alerts: [...state.alerts],
      };
      try {
        return await fn(db);
      } catch (err) {
        state.sessions = snapshot.sessions;
        state.attempts = snapshot.attempts;
        state.breaches = snapshot.breaches;
        state.feedbacks = snapshot.feedbacks;
        state.audit = snapshot.audit;
        state.alerts = snapshot.alerts;
        syncView();
        throw err;
      }
    },
  };
  // `...state` copied the references; keep the exposed fields pointing at the live state after a rollback.
  function syncView() {
    db.sessions = state.sessions;
    db.attempts = state.attempts;
    db.breaches = state.breaches;
    db.feedbacks = state.feedbacks;
    db.audit = state.audit;
    db.alerts = state.alerts;
  }
  return db;
}

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as SyncDb;
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as HttpError,
  );

describe("payload validation", () => {
  test("rejects a `trace` field (M9 minimization)", () => {
    expect(() =>
      sessionItemSchema.parse({ ...item(), trace: [[0, 10]] }),
    ).toThrow();
  });

  test("rejects `repList`: it is not stored, so it is not in the contract (R1-K5)", () => {
    expect(() =>
      sessionItemSchema.parse({
        ...item(),
        repList: [{ atMs: 1, peakDeg: 1, durMs: 1 }],
      }),
    ).toThrow();
  });

  test("rejects a `reportedBy` field in the body (S6c)", () => {
    expect(() =>
      sessionItemSchema.parse({ ...item(), reportedBy: "patient" }),
    ).toThrow();
  });

  test("rejects deviceId / deviceLabel (minimization)", () => {
    expect(() =>
      sessionItemSchema.parse({ ...item(), deviceId: "x" }),
    ).toThrow();
    expect(() =>
      sessionItemSchema.parse({ ...item(), deviceLabel: "Pixel" }),
    ).toThrow();
  });

  test("accepts a clean item", () => {
    expect(() => sessionItemSchema.parse(item())).not.toThrow();
  });

  test("caps the batch at 100 and requires at least one", () => {
    const sessions = Array.from({ length: 101 }, () => item());
    expect(() => syncBatchSchema.parse({ sessions })).toThrow();
    expect(() => syncBatchSchema.parse({ sessions: [] })).toThrow();
  });

  test("rejects an over-long note", () => {
    expect(() =>
      sessionItemSchema.parse({ ...item(), note: "x".repeat(501) }),
    ).toThrow();
  });

  test.each([
    ["activeMs", { activeMs: 2 ** 31 }],
    ["pauses", { pauses: 2 ** 31 }],
    ["reps", { reps: 10_001 }],
    ["envelopeVersion", { envelopeVersion: 2 ** 31 }],
    [
      "heldMs",
      {
        breaches: [
          { kind: "angle", value: 1, limit: 1, heldMs: 2 ** 31, atMs: 1 },
        ],
      },
    ],
    [
      "atMs",
      {
        breaches: [
          { kind: "angle", value: 1, limit: 1, heldMs: 1, atMs: 2 ** 31 },
        ],
      },
    ],
    [
      "value",
      {
        breaches: [
          { kind: "angle", value: 1e12, limit: 1, heldMs: 1, atMs: 1 },
        ],
      },
    ],
  ])("rejects an out-of-range %s (R1-K3)", (_name, over) => {
    expect(sessionItemSchema.safeParse({ ...item(), ...over }).success).toBe(
      false,
    );
  });

  test("rejects a breach time that overflows the date range (atMs)", () => {
    const bad = {
      ...item({ startedAt: "9999-12-31T23:59:59.000Z" }),
      breaches: [
        { kind: "angle", value: 1, limit: 1, heldMs: 1, atMs: 86_400_000 },
      ],
    };
    expect(sessionItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe("idempotency on clientId only (K5, R1-K11)", () => {
  test("two POSTs of the same clientId produce one stored row", async () => {
    const db = fakeDb();
    const first = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(first[0]).toMatchObject({ result: "stored", clientId: CID });
    expect(db.sessions.size).toBe(1);

    const second = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(second[0]).toMatchObject({ result: "duplicate" });
    expect(db.sessions.size).toBe(1);
    expect(db.audit).toHaveLength(1); // only the first write audits
    expect(db.attempts).toHaveLength(1);
  });

  test("a retry with an edited note is a duplicate and the first write wins", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item({ note: "first" })], now);
    const res = await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [item({ note: "edited" })],
      now,
    );
    expect(res[0]?.result).toBe("duplicate");
    expect(db.feedbacks).toHaveLength(1);
    expect(db.feedbacks[0]).toMatchObject({ note: "first" });
  });
});

describe("clientId cannot be grabbed (R1-S4)", () => {
  test("another patient's POST of an existing clientId is rejected, not a duplicate", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);

    const res = await ingestBatch(asDb(db), otherPatient, "p2", [item()], now);
    expect(res[0]).toMatchObject({
      result: "rejected",
      reason: "client_id_conflict",
    });
    expect(db.sessions.get(CID)).toEqual({ patientId: "p1", reporterId: "p1" });
    expect(db.audit).toHaveLength(1);
  });

  test("a squatter who syncs first does not make the real phone's session a duplicate", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), otherPatient, "p2", [item()], now); // squats the id
    const real = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(real[0]?.result).toBe("rejected"); // phone keeps the outbox row and sees a real error
  });

  test("a different reporter for the same patient is also a conflict", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    const res = await ingestBatch(asDb(db), caregiver, "p1", [item()], now);
    expect(res[0]).toMatchObject({
      result: "rejected",
      reason: "client_id_conflict",
    });
  });
});

describe("one session, one transaction (R1-K3)", () => {
  test("a failure writing breaches leaves no orphan and the retry stores everything", async () => {
    const db = fakeDb({ failBreachWrites: { times: 1 } });

    const err = await failure(
      ingestBatch(asDb(db), patient, "p1", [item()], now),
    );
    expect(err).toBeInstanceOf(Error);
    expect(db.sessions.size).toBe(0);
    expect(db.attempts).toHaveLength(0);
    expect(db.audit).toHaveLength(0);

    const retry = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(retry[0]?.result).toBe("stored"); // not "duplicate": nothing was left behind
    expect(db.sessions.size).toBe(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.breaches).toHaveLength(1);
  });

  test("an extreme item is rejected alone and the rest of the batch is stored", async () => {
    const db = fakeDb();
    const extreme = {
      ...item({ clientId: CID2 }),
      breaches: [{ kind: "angle", value: 1, limit: 1, heldMs: 1, atMs: 1e18 }],
    };
    const res = await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [item(), extreme],
      now,
    );
    expect(res.map((r) => r.result)).toEqual(["stored", "rejected"]);
    expect(res[1]).toMatchObject({
      index: 1,
      clientId: CID2,
      reason: "invalid_payload",
    });
    expect([...db.sessions.keys()]).toEqual([CID]);
  });
});

describe("per-item results (R1-K4)", () => {
  test("an unknown exercise is rejected per item and does not stop the batch", async () => {
    const db = fakeDb();
    const orig = db.planExercise.findFirst;
    db.planExercise.findFirst = async (args) =>
      (args.where as { exercise: { slug: string } }).exercise.slug === "nope"
        ? null
        : orig(args);

    const res = await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [item({ exercise: "nope" }), item({ clientId: CID2 })],
      now,
    );
    expect(res[0]).toMatchObject({
      result: "rejected",
      reason: "unknown_exercise",
    });
    expect(res[1]?.result).toBe("stored");
  });

  test("no envelope yet is rejected per item", async () => {
    const res = await ingestBatch(
      asDb(fakeDb({ versions: [] })),
      patient,
      "p1",
      [item()],
      now,
    );
    expect(res[0]).toMatchObject({ result: "rejected", reason: "no_envelope" });
  });

  test("an envelope version that never existed is rejected with envelopeMismatch", async () => {
    const db = fakeDb({ versions: [1, 2] }); // phone claims 3
    const res = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(res[0]).toMatchObject({
      result: "rejected",
      reason: "envelope_version_unknown",
      envelopeMismatch: true,
    });
    expect(db.sessions.size).toBe(0);
  });

  test("a malformed item is rejected per item with its index", async () => {
    const db = fakeDb();
    const res = await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [{ clientId: CID2, trace: [] }, "garbage", item()],
      now,
    );
    expect(res.map((r) => r.result)).toEqual([
      "rejected",
      "rejected",
      "stored",
    ]);
    expect(res[0]).toMatchObject({ index: 0, clientId: CID2 });
    expect(res[1]).toMatchObject({ index: 1, clientId: null });
  });
});

describe("reporter identity (S6c)", () => {
  test("a caregiver login audits as actor and stores the resolved patient", async () => {
    const db = fakeDb();
    const res = await ingestBatch(asDb(db), caregiver, "p1", [item()], now);
    expect(db.audit[0]).toMatchObject({ actorId: "c1", patientId: "p1" });
    expect(db.sessions.get(CID)).toEqual({ patientId: "p1", reporterId: "c1" });
    expect(res[0]?.result).toBe("stored");
  });
});

describe("server time + envelope version (S6b, S6e)", () => {
  test("records server receive time separate from the phone clock", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.audit[0]?.metadata).toMatchObject({
      serverReceivedAt: now.toISOString(),
    });
  });

  test("flags an envelope version mismatch when the claimed version exists", async () => {
    const db = fakeDb({ versions: [3, 5] }); // phone claims 3, 5 is in force
    const res = await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(res[0]).toMatchObject({ result: "stored", envelopeMismatch: true });
    expect(db.audit[0]?.metadata).toMatchObject({
      envelopeVersionClaimed: 3,
      envelopeVersionCurrent: 5,
      envelopeMismatch: true,
    });
  });

  test("no mismatch when versions agree", async () => {
    const res = await ingestBatch(
      asDb(fakeDb({ versions: [3] })),
      patient,
      "p1",
      [item()],
      now,
    );
    expect(res[0]?.envelopeMismatch).toBe(false);
  });
});

describe("deleted programs take no sessions (R1-M2)", () => {
  test("the plan lookup filters program.deletedAt and program.active", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.planWhere[0]).toMatchObject({
      deletedAt: null,
      program: { patientId: "p1", deletedAt: null, active: true },
    });
  });
});

describe("children (R1-K5)", () => {
  test("writes attempt, breach and feedback for a completed session", async () => {
    const db = fakeDb();
    await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [item({ difficulty: 4, note: "  bahu pegal  " })],
      now,
    );
    expect(db.attempts[0]).toMatchObject({
      sessionId: CID,
      reps: 10,
      maxVelDegPerS: 110,
      pauses: 1,
    });
    expect(db.breaches).toHaveLength(1);
    expect(db.breaches[0]).toMatchObject({
      kind: "ANGLE",
      occurredAt: new Date("2026-11-28T00:00:02.000Z"),
    });
    expect(db.feedbacks[0]).toMatchObject({
      sessionId: CID,
      difficulty: 4,
      note: "bahu pegal",
    });
  });

  test("writes an AttemptSummary for CANNOT_DO and POSTPONED too", async () => {
    const db = fakeDb();
    await ingestBatch(
      asDb(db),
      patient,
      "p1",
      [
        item({ status: "CANNOT_DO", breaches: [], reps: 3 }),
        item({ clientId: CID2, status: "POSTPONED", breaches: [], reps: 0 }),
      ],
      now,
    );
    expect(db.attempts).toHaveLength(2);
    expect(db.attempts[0]).toMatchObject({ reps: 3 });
  });

  test("no Feedback row when there is neither difficulty nor note", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.feedbacks).toHaveLength(0);
  });
});

describe("alerts from breaches (F4)", () => {
  test("a cue-only envelope with no caregiver notification creates no Alert", async () => {
    const db = fakeDb();
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.alerts).toHaveLength(0);
  });

  test("a therapist-set pause creates one L2 Alert linked to the breach", async () => {
    const db = fakeDb({
      envelopeBehavior: { onBreach: "CUE_AND_PAUSE", notifyCaregiver: false },
    });
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.alerts).toHaveLength(1);
    expect(db.alerts[0]).toMatchObject({
      level: "L2",
      status: "PENDING",
      patientId: "p1",
      sessionId: CID,
      caregiverId: null,
    });
    expect(db.alerts[0].breachEventId).toBe(db.breaches[0].id);
  });

  test("notifyCaregiver creates an L1 Alert for the linked caregiver", async () => {
    const db = fakeDb({
      envelopeBehavior: { onBreach: "CUE_ONLY", notifyCaregiver: true },
      caregiverId: "c1",
    });
    await ingestBatch(asDb(db), patient, "p1", [item()], now);
    expect(db.alerts).toHaveLength(1);
    expect(db.alerts[0]).toMatchObject({
      level: "L1",
      status: "PENDING",
      caregiverId: "c1",
    });
  });

  test("at most one Alert per session even with many breaches", async () => {
    const db = fakeDb({
      envelopeBehavior: { onBreach: "CUE_AND_PAUSE", notifyCaregiver: true },
    });
    const breaches = Array.from({ length: 5 }, (_, i) => ({
      kind: "angle" as const,
      value: 95,
      limit: 90,
      heldMs: 400,
      atMs: i * 1000,
    }));
    await ingestBatch(asDb(db), patient, "p1", [item({ breaches })], now);
    expect(db.breaches).toHaveLength(5);
    expect(db.alerts).toHaveLength(1);
  });

  test("a failed breach write rolls the Alert back with the session", async () => {
    const db = fakeDb({
      envelopeBehavior: { onBreach: "CUE_AND_PAUSE", notifyCaregiver: false },
      failBreachWrites: { times: 1 },
    });
    const err = await failure(
      ingestBatch(asDb(db), patient, "p1", [item()], now),
    );
    expect(err).not.toBeNull();
    expect(db.alerts).toHaveLength(0);
    expect(db.sessions.size).toBe(0);
  });

  test("no breach means no Alert", async () => {
    const db = fakeDb({
      envelopeBehavior: { onBreach: "CUE_AND_PAUSE", notifyCaregiver: true },
    });
    await ingestBatch(asDb(db), patient, "p1", [item({ breaches: [] })], now);
    expect(db.alerts).toHaveLength(0);
  });
});

describe("resolvePatient (R1-K7)", () => {
  function linkDb(link: { patientId: string } | null) {
    const calls: unknown[] = [];
    return {
      calls,
      careLink: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          return link;
        },
      },
    } as unknown as Pick<SyncDb, "careLink"> & { calls: unknown[] };
  }
  const P1 = "33333333-3333-4333-8333-333333333333";

  test("a patient reports for themselves", async () => {
    const db = linkDb(null);
    expect(await resolvePatient(db, patient, undefined)).toBe("p1");
  });

  test("a patient who sends patientId is refused, even their own", async () => {
    const err = await failure(resolvePatient(linkDb(null), patient, "p1"));
    expect(err?.status).toBe(400);
  });

  test("a caregiver must name the patient", async () => {
    const err = await failure(
      resolvePatient(linkDb(null), caregiver, undefined),
    );
    expect(err?.status).toBe(400);
  });

  test("caregiver A asking for patient B (no ACTIVE link) is 403", async () => {
    const err = await failure(resolvePatient(linkDb(null), caregiver, P1));
    expect(err?.status).toBe(403);
  });

  test("a caregiver with an ACTIVE link gets that patient, checked against the link and live patient", async () => {
    const db = linkDb({ patientId: P1 });
    expect(await resolvePatient(db, caregiver, P1)).toBe(P1);
    expect((db as unknown as { calls: unknown[] }).calls[0]).toMatchObject({
      where: {
        caregiverId: "c1",
        patientId: P1,
        status: "ACTIVE",
        deletedAt: null,
        patient: { deletedAt: null },
      },
    });
  });
});
