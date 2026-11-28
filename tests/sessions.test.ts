import { describe, expect, test } from "bun:test";
import {
  listBreaches,
  listBreachesQuerySchema,
  listSessions,
  listSessionsQuerySchema,
  queryObject,
} from "../src/app/api/sessions/history";
import type { Profile } from "../src/generated/prisma/client";
import type { HttpError } from "../src/lib/auth/http";

type Db = Parameters<typeof listSessions>[0];

const P1 = "00000000-0000-4000-8000-000000000001"; // patient of t1
const P2 = "00000000-0000-4000-8000-000000000002"; // patient of t2
const S1 = "00000000-0000-4000-8000-0000000000a1"; // session of P1
const S2 = "00000000-0000-4000-8000-0000000000a2"; // session of P2

const t1 = { id: "t1", role: "THERAPIST" } as Profile;
const t2 = { id: "t2", role: "THERAPIST" } as Profile;

type PatientWhere = { therapistId?: string; role?: string; deletedAt?: null };
type Where = {
  id?: string;
  patientId?: string;
  sessionId?: string;
  patient?: PatientWhere;
};
type Args = { where: Where; skip?: number; take?: number };

const owner: Record<string, string> = { [P1]: "t1", [P2]: "t2" };

// 25 sessions for P1 (startedAt descending by index) and one for P2.
const sessions = [
  ...Array.from({ length: 25 }, (_, i) => ({
    id: i === 0 ? S1 : `s1-${i}`,
    patientId: P1,
  })),
  { id: S2, patientId: P2 },
];
const breaches = [
  { id: "b1", sessionId: S1 },
  { id: "b2", sessionId: S1 },
  { id: "b3", sessionId: S1 },
  { id: "b4", sessionId: S2 },
];

function fakeDb() {
  const calls: Args[] = [];
  const ownedBy = (patientId: string, w?: PatientWhere) =>
    w?.therapistId === undefined || owner[patientId] === w.therapistId;
  const db = {
    calls,
    profile: {
      findFirst: async ({ where }: { where: Where & PatientWhere }) =>
        where.id && owner[where.id] === where.therapistId
          ? { id: where.id }
          : null,
    },
    rehabSession: {
      findMany: async (args: Args) => {
        calls.push(args);
        const { where, skip = 0, take = 1000 } = args;
        return sessions
          .filter(
            (s) =>
              (!where.patientId || s.patientId === where.patientId) &&
              ownedBy(s.patientId, where.patient),
          )
          .slice(skip, skip + take);
      },
      findFirst: async ({ where }: { where: Where }) => {
        const s = sessions.find((x) => x.id === where.id);
        return s && ownedBy(s.patientId, where.patient)
          ? { id: s.id, patientId: s.patientId }
          : null;
      },
    },
    breachEvent: {
      findMany: async (args: Args) => {
        calls.push(args);
        const { where, skip = 0, take = 1000 } = args;
        return breaches
          .filter((b) => b.sessionId === where.sessionId)
          .slice(skip, skip + take);
      },
    },
  };
  return db;
}

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const parse = (q: string) =>
  listSessionsQuerySchema.parse(queryObject(new Request(`http://x/api?${q}`)));

async function status(p: Promise<unknown>) {
  return p.then(
    () => 0,
    (e: HttpError) => e.status,
  );
}

describe("GET /api/sessions domain", () => {
  test("only the therapist's own patients' sessions", async () => {
    const out = await listSessions(asDb(fakeDb()), t1, parse(""));
    expect(
      out.items.every((s) => (s as { patientId: string }).patientId === P1),
    ).toBe(true);
    expect(out.items.some((s) => s.id === S2)).toBe(false);
  });

  test("another therapist sees only their own, never t1's", async () => {
    const out = await listSessions(asDb(fakeDb()), t2, parse(""));
    expect(out.items.map((s) => s.id)).toEqual([S2]);
  });

  test("ownership is pinned in the query (therapistId, role, not deleted)", async () => {
    const db = fakeDb();
    await listSessions(asDb(db), t1, parse(""));
    expect(db.calls[0].where.patient).toEqual({
      therapistId: "t1",
      role: "PATIENT",
      deletedAt: null,
    });
  });

  test("patientId of another therapist's patient -> 404", async () => {
    expect(
      await status(listSessions(asDb(fakeDb()), t1, parse(`patientId=${P2}`))),
    ).toBe(404);
  });

  test("patientId of own patient narrows the list", async () => {
    const out = await listSessions(
      asDb(fakeDb()),
      t1,
      parse(`patientId=${P1}`),
    );
    expect(out.items).toHaveLength(20);
  });

  test("paginates with hasMore and does not leak the lookahead row", async () => {
    const db = fakeDb();
    const p1 = await listSessions(asDb(db), t1, parse("limit=20"));
    expect(p1.items).toHaveLength(20);
    expect(p1.hasMore).toBe(true);
    const p2 = await listSessions(asDb(db), t1, parse("limit=20&page=2"));
    expect(p2.items).toHaveLength(5);
    expect(p2.hasMore).toBe(false);
    expect(db.calls[1].skip).toBe(20);
  });
});

describe("GET /api/sessions query validation", () => {
  test("defaults", () => {
    expect(parse("")).toEqual({ page: 1, limit: 20 });
  });

  test.each([
    "limit=0",
    "limit=51",
    "limit=abc",
    "limit=",
    "page=0",
    "page=1.5",
    "patientId=not-a-uuid",
    "extra=1",
  ])("rejects %s", (q) => {
    expect(() => parse(q)).toThrow();
  });
});

describe("GET /api/breaches domain", () => {
  const q = (s: string) =>
    listBreachesQuerySchema.parse(
      queryObject(new Request(`http://x/api?${s}`)),
    );

  test("owner reads one session's breaches", async () => {
    const out = await listBreaches(asDb(fakeDb()), t1, q(`sessionId=${S1}`));
    expect(out.sessionId).toBe(S1);
    expect(out.items.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(out.hasMore).toBe(false);
  });

  test("another therapist's session -> 404 and no breach query issued", async () => {
    const db = fakeDb();
    expect(await status(listBreaches(asDb(db), t1, q(`sessionId=${S2}`)))).toBe(
      404,
    );
    expect(await status(listBreaches(asDb(db), t2, q(`sessionId=${S1}`)))).toBe(
      404,
    );
    expect(db.calls).toHaveLength(0);
  });

  test("unknown session -> 404", async () => {
    const unknown = "00000000-0000-4000-8000-0000000000ff";
    expect(
      await status(listBreaches(asDb(fakeDb()), t1, q(`sessionId=${unknown}`))),
    ).toBe(404);
  });

  test("paginates", async () => {
    const out = await listBreaches(
      asDb(fakeDb()),
      t1,
      q(`sessionId=${S1}&limit=2`),
    );
    expect(out.items).toHaveLength(2);
    expect(out.hasMore).toBe(true);
  });

  test.each([
    "",
    "sessionId=nope",
    `sessionId=${S1}&limit=51`,
    `sessionId=${S1}&patientId=${P1}`,
  ])("rejects query %p", (s) => {
    expect(() => q(s)).toThrow();
  });
});
