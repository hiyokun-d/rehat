import { describe, expect, test } from "bun:test";
import type { Profile } from "../src/generated/prisma/client";
import {
  type BundleDb,
  buildBundle,
  sinceSchema,
} from "../src/lib/relay/bundle";

const patient = { id: "p1", role: "PATIENT" } as Profile;

const T0 = Date.parse("2026-11-28T00:00:00.000Z");
const at = (offset: number) => new Date(T0 + offset);

function envelope(version: number) {
  return {
    version,
    maxAngleDeg: 90,
    maxVelDegPerS: 120,
    debounceMs: 300,
    onBreach: "CUE_ONLY",
    notifyCaregiver: false,
  };
}

type Row = {
  id: string;
  position: number;
  updatedAt: Date;
  deletedAt: Date | null;
  exercise: { slug: string; name: string };
  program: { active: boolean; deletedAt: Date | null; updatedAt: Date };
  envelopes: ReturnType<typeof envelope>[];
};

const liveProgram = (updatedAt = at(0)) => ({
  active: true,
  deletedAt: null,
  updatedAt,
});

const rows: Row[] = [
  {
    id: "pe1",
    position: 0,
    updatedAt: at(4_000),
    deletedAt: null,
    exercise: { slug: "shoulder-flexion", name: "Fleksi bahu" },
    program: liveProgram(at(4_000)),
    envelopes: [envelope(4)],
  },
  {
    id: "pe2",
    position: 1,
    updatedAt: at(2_000),
    deletedAt: null,
    exercise: { slug: "elbow-flexion", name: "Fleksi siku" },
    program: liveProgram(at(2_000)),
    envelopes: [envelope(2)],
  },
];

function fakeDb(live: Row[], removed: Row[] = []): BundleDb {
  return {
    planExercise: {
      findMany: async () => live,
    },
    // Models the raw tombstone query: ids and timestamps of rows no longer live.
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const since = values.find((v): v is Date => v instanceof Date);
      return removed
        .filter(
          (r) => !since || r.updatedAt >= since || r.program.updatedAt >= since,
        )
        .map((r) => ({
          id: r.id,
          rowAt: r.updatedAt,
          programAt: r.program.updatedAt,
        }));
    },
  } as unknown as BundleDb;
}

describe("since parsing", () => {
  test("missing or invalid since means a full bundle (0)", () => {
    expect(sinceSchema.parse(null)).toBe(0);
    expect(sinceSchema.parse("abc")).toBe(0);
    expect(sinceSchema.parse("-5")).toBe(0);
    expect(sinceSchema.parse("99999999999999999999")).toBe(0); // past year 9999
  });

  test("a numeric cursor is kept", () => {
    expect(sinceSchema.parse("3")).toBe(3);
    expect(sinceSchema.parse(String(T0))).toBe(T0);
  });
});

describe("buildBundle", () => {
  test("full pull returns every live exercise and the newest change marker", async () => {
    const b = await buildBundle(fakeDb(rows), patient, 0);
    expect(b.version).toBe(at(4_000).getTime());
    expect(b.removed).toEqual([]);
    expect(b.exercises).toHaveLength(2);
    expect(b.exercises[0]).toMatchObject({
      planExerciseId: "pe1",
      exerciseSlug: "shoulder-flexion",
      envelope: { version: 4 },
    });
  });

  test("delta returns only rows changed at or after since", async () => {
    const b = await buildBundle(fakeDb(rows), patient, at(2_000).getTime());
    // pe2 sits exactly on the cursor and is re-sent; pe1 is newer. Re-sending one unchanged row
    // is harmless and prevents a same-millisecond write from being missed.
    expect(b.exercises.map((e) => e.planExerciseId)).toEqual(["pe1", "pe2"]);
    const c = await buildBundle(fakeDb(rows), patient, at(3_000).getTime());
    expect(c.exercises.map((e) => e.planExerciseId)).toEqual(["pe1"]);
    expect(c.version).toBe(at(4_000).getTime());
  });

  test("an exercise with no envelope is returned without limits on a full pull", async () => {
    const noEnv: Row[] = [
      {
        id: "pe3",
        position: 0,
        updatedAt: at(1_000),
        deletedAt: null,
        exercise: { slug: "shoulder-flexion", name: "Fleksi bahu" },
        program: liveProgram(at(1_000)),
        envelopes: [],
      },
    ];
    const b = await buildBundle(fakeDb(noEnv), patient, 0);
    expect(b.exercises[0]?.envelope).toBeNull();
    expect(b.version).toBe(at(1_000).getTime());
  });

  test("a newly added exercise without an envelope reaches a delta pull", async () => {
    const noEnv: Row[] = [
      {
        id: "pe3",
        position: 0,
        updatedAt: at(9_000),
        deletedAt: null,
        exercise: { slug: "shoulder-flexion", name: "Fleksi bahu" },
        program: liveProgram(at(9_000)),
        envelopes: [],
      },
    ];
    const b = await buildBundle(fakeDb(noEnv), patient, at(5_000).getTime());
    expect(b.exercises.map((e) => e.planExerciseId)).toEqual(["pe3"]);
    expect(b.exercises[0]?.envelope).toBeNull();
  });

  test("a soft-deleted exercise becomes a tombstone on a delta and disappears on a full pull", async () => {
    const deleted: Row[] = [
      {
        ...rows[0],
        deletedAt: at(5_000),
        updatedAt: at(5_000),
      },
    ];
    const delta = await buildBundle(
      fakeDb([], deleted),
      patient,
      at(4_500).getTime(),
    );
    expect(delta.exercises).toEqual([]);
    expect(delta.removed).toEqual(["pe1"]);

    const full = await buildBundle(fakeDb([], deleted), patient, 0);
    expect(full.exercises).toEqual([]);
    expect(full.removed).toEqual([]);
  });

  test("an old tombstone is not re-sent forever", async () => {
    const deleted: Row[] = [
      { ...rows[0], deletedAt: at(5_000), updatedAt: at(5_000) },
    ];
    const b = await buildBundle(
      fakeDb([], deleted),
      patient,
      at(6_000).getTime(),
    );
    expect(b.removed).toEqual([]);
    expect(b.version).toBe(at(6_000).getTime()); // the cursor never goes backwards
  });

  test("a deactivated or deleted program turns its exercises into tombstones", async () => {
    for (const program of [
      { ...liveProgram(at(7_000)), active: false },
      { ...liveProgram(at(7_000)), deletedAt: at(7_000) },
    ]) {
      const list: Row[] = [{ ...rows[0], program }];
      const b = await buildBundle(fakeDb(list), patient, at(6_000).getTime());
      expect(b.exercises).toEqual([]);
      expect(b.removed).toEqual(["pe1"]);
    }
  });

  test("a program-only change re-sends its live exercises", async () => {
    const list: Row[] = [{ ...rows[0], program: liveProgram(at(8_000)) }];
    const b = await buildBundle(fakeDb(list), patient, at(7_000).getTime());
    expect(b.exercises.map((e) => e.planExerciseId)).toEqual(["pe1"]);
    expect(b.version).toBe(at(8_000).getTime());
  });

  test("a stale cursor cannot pull the version backwards", async () => {
    const b = await buildBundle(fakeDb(rows), patient, at(99_000).getTime());
    expect(b.version).toBe(at(99_000).getTime());
    expect(b.exercises).toEqual([]);
  });
});
