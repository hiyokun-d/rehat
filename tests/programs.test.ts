import { describe, expect, test } from "bun:test";
import {
  createPlanExercise,
  createProgram,
  deleteProgram,
  putEnvelope,
  putEnvelopeSchema,
  updateProgram,
} from "../src/app/api/_domain/programs";
import type { Profile } from "../src/generated/prisma/client";
import type { HttpError } from "../src/lib/auth/http";

type Db = Parameters<typeof createProgram>[0];

// Just enough of the `where` tree the domain builds for the fake db to match ownership on.
type Where = {
  id?: string | { not?: string; in?: string[] };
  role?: string;
  therapistId?: string;
  active?: boolean;
  programId?: string;
  exerciseId?: string;
  deletedAt?: null;
  patient?: { therapistId?: string };
  program?: { therapistId?: string; patient?: { therapistId?: string } };
};

const therapist = { id: "t1", role: "THERAPIST" } as Profile;
const other = { id: "t2", role: "THERAPIST" } as Profile;
const now = new Date("2026-11-28T00:00:00Z");

// In-memory stand-in for the Prisma calls the program domain makes. Rows are owned by therapist
// "t1": patient "p1", program "prog1", planExercise "pe1". Anything else is "not found", so a
// request from another therapist (t2) or for another therapist's patient resolves to 404.
function fakeDb(
  opts: {
    envelopeVersions?: number[];
    otherActivePrograms?: string[];
    duplicatePlanExercise?: boolean;
  } = {},
) {
  const audit: Record<string, unknown>[] = [];
  const created: Record<
    string,
    { model: string; data: Record<string, unknown> }
  > = {};
  const createdList: { model: string; data: Record<string, unknown> }[] = [];
  const updated: {
    model: string;
    where: unknown;
    data: Record<string, unknown>;
  }[] = [];
  const deactivated: { where: unknown; data: Record<string, unknown> }[] = [];
  let envelopeVersions = opts.envelopeVersions ?? [];

  // Ownership: a `where` tree that pins therapistId to t1 (directly or through program) matches
  // our single owned row; everything else returns null.
  const ownsProgram = (where: Where) =>
    where.id === "prog1" &&
    where.therapistId === "t1" &&
    where.patient?.therapistId === "t1";
  const ownsPlanExercise = (where: Where) =>
    where.id === "pe1" &&
    where.program?.therapistId === "t1" &&
    where.program?.patient?.therapistId === "t1";

  let seq = 0;
  const db = {
    audit,
    created,
    createdList,
    updated,
    deactivated,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    profile: {
      findFirst: async ({ where }: { where: Where }) =>
        where.id === "p1" &&
        where.role === "PATIENT" &&
        where.therapistId === "t1"
          ? { id: "p1" }
          : null,
    },
    program: {
      findFirst: async ({ where }: { where: Where }) =>
        ownsProgram(where) ? { id: "prog1", patientId: "p1" } : null,
      findMany: async ({ where }: { where: Where }) =>
        where.active === true
          ? (opts.otherActivePrograms ?? []).map((id) => ({ id }))
          : [{ id: "prog1", patientId: "p1" }],
      updateMany: async ({
        where,
        data,
      }: {
        where: unknown;
        data: Record<string, unknown>;
      }) => {
        deactivated.push({ where, data });
        return { count: opts.otherActivePrograms?.length ?? 0 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "prog1", ...data };
        created.program = { model: "program", data };
        createdList.push({ model: "program", data });
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: unknown;
        data: Record<string, unknown>;
      }) => {
        updated.push({ model: "program", where, data });
        return { id: "prog1", ...data };
      },
    },
    exercise: {
      findFirst: async ({ where }: { where: Where }) =>
        where.id === "ex1" ? { id: "ex1" } : null,
    },
    planExercise: {
      findFirst: async ({ where }: { where: Where }) =>
        where.programId === "prog1"
          ? opts.duplicatePlanExercise
            ? { id: "pe-dup" }
            : null
          : ownsPlanExercise(where)
            ? { id: "pe1", programId: "prog1", program: { patientId: "p1" } }
            : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "pe1", ...data };
        created.planExercise = { model: "planExercise", data };
        createdList.push({ model: "planExercise", data });
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: unknown;
        data: Record<string, unknown>;
      }) => {
        updated.push({ model: "planExercise", where, data });
        return { id: "pe1", ...data };
      },
    },
    safetyEnvelope: {
      findFirst: async () => {
        const v = envelopeVersions.at(-1);
        return v === undefined ? null : { version: v };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        envelopeVersions = [...envelopeVersions, data.version as number];
        seq += 1;
        const row = { id: `env${seq}`, ...data };
        created.safetyEnvelope = { model: "safetyEnvelope", data };
        createdList.push({ model: "safetyEnvelope", data });
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
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

describe("createProgram", () => {
  test("creates for the therapist's own patient and audits", async () => {
    const db = fakeDb();
    const program = await createProgram(asDb(db), therapist, {
      patientId: "p1",
      title: "Minggu 1",
      active: true,
    });
    expect(program.id).toBe("prog1");
    expect(db.created.program?.data).toMatchObject({
      patientId: "p1",
      therapistId: "t1",
      title: "Minggu 1",
      active: true,
    });
    expect(db.audit[0]).toMatchObject({
      action: "program.create",
      actorId: "t1",
      patientId: "p1",
      entityType: "Program",
    });
  });

  test("404 for a patient that is not the therapist's", async () => {
    const err = await failure(
      createProgram(asDb(fakeDb()), therapist, {
        patientId: "p9",
        title: "x",
        active: true,
      }),
    );
    expect(err?.status).toBe(404);
  });
});

describe("one active program per patient", () => {
  test("creating an active program deactivates the others in the same transaction", async () => {
    const db = fakeDb({ otherActivePrograms: ["prog9"] });
    await createProgram(asDb(db), therapist, {
      patientId: "p1",
      title: "Minggu 2",
      active: true,
    });
    expect(db.deactivated).toHaveLength(1);
    expect(db.deactivated[0]).toMatchObject({
      where: { id: { in: ["prog9"] } },
      data: { active: false },
    });
    expect(db.deactivated[0].data.updatedAt).toBeInstanceOf(Date);
    expect(db.audit[0]).toMatchObject({
      action: "program.create",
      metadata: { deactivated: ["prog9"] },
    });
  });

  test("creating an inactive program leaves the active one alone", async () => {
    const db = fakeDb({ otherActivePrograms: ["prog9"] });
    await createProgram(asDb(db), therapist, {
      patientId: "p1",
      title: "Draft",
      active: false,
    });
    expect(db.deactivated).toEqual([]);
  });

  test("activating a program deactivates the others", async () => {
    const db = fakeDb({ otherActivePrograms: ["prog9"] });
    await updateProgram(asDb(db), therapist, "prog1", { active: true });
    expect(db.deactivated).toHaveLength(1);
    expect(db.deactivated[0]).toMatchObject({
      where: { id: { in: ["prog9"] } },
      data: { active: false },
    });
    expect(db.deactivated[0].data.updatedAt).toBeInstanceOf(Date);
    expect(db.audit.at(-1)).toMatchObject({
      action: "program.update",
      metadata: { deactivated: ["prog9"] },
    });
  });
});

describe("program ownership (no BOLA)", () => {
  test("another therapist cannot update this program -> 404", async () => {
    const err = await failure(
      updateProgram(asDb(fakeDb()), other, "prog1", { active: false }),
    );
    expect(err?.status).toBe(404);
  });

  test("another therapist cannot delete this program -> 404", async () => {
    const err = await failure(
      deleteProgram(asDb(fakeDb()), other, "prog1", now),
    );
    expect(err?.status).toBe(404);
  });

  test("owner delete is a soft delete (sets deletedAt) and audits", async () => {
    const db = fakeDb();
    await deleteProgram(asDb(db), therapist, "prog1", now);
    expect(db.updated[0]).toMatchObject({
      model: "program",
      data: { deletedAt: now },
    });
    expect(db.audit.at(-1)).toMatchObject({ action: "program.delete" });
  });
});

describe("createPlanExercise", () => {
  test("adds to the owned program referencing the catalog and audits", async () => {
    const db = fakeDb();
    const pe = await createPlanExercise(asDb(db), therapist, {
      programId: "prog1",
      exerciseId: "ex1",
      position: 0,
    });
    expect(pe.id).toBe("pe1");
    expect(db.created.planExercise?.data).toMatchObject({
      programId: "prog1",
      exerciseId: "ex1",
      position: 0,
    });
    expect(db.audit.at(-1)).toMatchObject({ action: "planExercise.create" });
  });

  test("another therapist's program -> 404", async () => {
    const err = await failure(
      createPlanExercise(asDb(fakeDb()), other, {
        programId: "prog1",
        exerciseId: "ex1",
        position: 0,
      }),
    );
    expect(err?.status).toBe(404);
  });

  test("unknown catalog exercise -> 404", async () => {
    const err = await failure(
      createPlanExercise(asDb(fakeDb()), therapist, {
        programId: "prog1",
        exerciseId: "ex9",
        position: 0,
      }),
    );
    expect(err?.status).toBe(404);
  });

  test("the same exercise already in the program -> 422 and nothing is created", async () => {
    const db = fakeDb({ duplicatePlanExercise: true });
    const err = await failure(
      createPlanExercise(asDb(db), therapist, {
        programId: "prog1",
        exerciseId: "ex1",
        position: 1,
      }),
    );
    expect(err?.status).toBe(422);
    expect(db.created.planExercise).toBeUndefined();
  });
});

describe("putEnvelope (append-only, versioned)", () => {
  const limits = {
    planExerciseId: "pe1",
    maxAngleDeg: 90,
    maxVelDegPerS: 120,
    debounceMs: 300,
    onBreach: "CUE_AND_PAUSE" as const,
    notifyCaregiver: true,
  };

  test("first envelope is version 1, stores numbers verbatim, audits", async () => {
    const db = fakeDb();
    const env = await putEnvelope(asDb(db), therapist, limits);
    expect(db.created.safetyEnvelope?.data).toMatchObject({
      version: 1,
      maxAngleDeg: 90,
      maxVelDegPerS: 120,
      debounceMs: 300,
      planExerciseId: "pe1",
      createdById: "t1",
    });
    expect(env.version).toBe(1);
    expect(db.audit.at(-1)).toMatchObject({
      action: "envelope.put",
      entityType: "SafetyEnvelope",
    });
  });

  test("a change inserts version+1 and never updates an older row", async () => {
    const db = fakeDb({ envelopeVersions: [3] });
    const env = await putEnvelope(asDb(db), therapist, {
      ...limits,
      maxAngleDeg: 75,
    });
    expect(env.version).toBe(4);
    expect(db.created.safetyEnvelope?.data).toMatchObject({ version: 4 });
    // append-only: no update was issued against safetyEnvelope
    expect(db.updated.some((u) => u.model === "safetyEnvelope")).toBe(false);
  });

  test("another therapist's plan exercise -> 404", async () => {
    const err = await failure(putEnvelope(asDb(fakeDb()), other, limits));
    expect(err?.status).toBe(404);
  });
});

describe("envelope schema (M1: reject, never clamp)", () => {
  const base = {
    planExerciseId: "11111111-1111-4111-8111-111111111111",
    maxAngleDeg: 90,
    maxVelDegPerS: 120,
    debounceMs: 300,
    onBreach: "CUE_ONLY",
    notifyCaregiver: false,
  };

  test("accepts a valid therapist payload unchanged", () => {
    const out = putEnvelopeSchema.parse(base);
    expect(out.maxAngleDeg).toBe(90);
    expect(out.maxVelDegPerS).toBe(120);
  });

  test("rejects a negative angle instead of clamping it", () => {
    const r = putEnvelopeSchema.safeParse({ ...base, maxAngleDeg: -5 });
    expect(r.success).toBe(false);
  });

  test("rejects zero velocity (not positive)", () => {
    const r = putEnvelopeSchema.safeParse({ ...base, maxVelDegPerS: 0 });
    expect(r.success).toBe(false);
  });

  test("rejects unknown extra fields (strict)", () => {
    const r = putEnvelopeSchema.safeParse({ ...base, severity: "high" });
    expect(r.success).toBe(false);
  });
});
