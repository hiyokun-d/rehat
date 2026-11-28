// /phone <-> backend: outbox retry is idempotent, the versioned bundle reaches the session, and
// the relay ticket flow. fetch is mocked; no network, no database.
import { describe, expect, test } from "bun:test";
import {
  applyBundle,
  type BundleCache,
  claimedVersion,
  mergeBundle,
} from "../src/lib/api/bundleCache";
import {
  ApiError,
  type Bundle,
  type BundleExercise,
  createApiClient,
} from "../src/lib/api/client";
import {
  backoffMs,
  enqueue,
  flushOutbox,
  type OutboxRow,
  type OutboxStore,
  toSyncItem,
} from "../src/lib/api/outbox";
import { makeTicketProvider, relayUrl } from "../src/lib/api/wsTicket";
import { DEFAULT_CONFIG } from "../src/lib/rehab/session";
import type { SessionSummary } from "../src/lib/rehab/summary";
import { sessionItemSchema } from "../src/lib/relay/sync";

const UID = "user-1";
const SID = "11111111-1111-4111-8111-111111111111";

function summary(id = SID): SessionSummary {
  return {
    version: 1,
    id,
    deviceId: "dev",
    deviceLabel: "Android",
    exercise: "shoulder-flexion",
    source: "phone",
    startedAt: "2026-11-28T03:00:00.000Z",
    endedAt: "2026-11-28T03:05:00.000Z",
    activeMs: 240_000.4,
    reps: 2,
    maxAngleDeg: 88.5,
    maxVelDegS: 100,
    repList: [
      { atMs: 1000.6, peakDeg: 80, durMs: 900.2 },
      { atMs: 3000, peakDeg: 88.5, durMs: 1000 },
    ],
    breaches: [
      {
        kind: "angle",
        value: 95,
        limit: 90,
        heldMs: 310.7,
        t: 5000,
        atMs: 2000.4,
      },
    ],
    pauses: 0,
    config: DEFAULT_CONFIG,
    trace: [[0, 1]],
    battery: null,
    reportedBy: "patient",
    difficulty: "sedang",
  };
}

/** In-memory OutboxStore with the same contract as the Dexie one. */
function memStore(): OutboxStore & { rows: Map<string, OutboxRow> } {
  const rows = new Map<string, OutboxRow>();
  return {
    rows,
    async add(row) {
      if (rows.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
    async due(userId, now) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.userId === userId && r.state === "pending" && r.nextAt <= now,
        )
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, ...patch });
    },
  };
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A fake /api/sync: stores one row per clientId, like the server's ON CONFLICT DO NOTHING. */
function fakeServer() {
  const db = new Map<string, unknown>();
  const calls: {
    body: { sessions: { clientId: string }[] };
  }[] = [];
  let script: ("drop" | "500" | "401" | "422" | "ok")[] = [];
  let mismatch = false;
  let reject: { reason: string; envelopeMismatch?: boolean } | null = null;
  const fetchFn = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ body });
    const step = script.shift() ?? "ok";
    if (step === "401") return jsonRes({ error: "Silakan masuk." }, 401);
    if (step === "422") return jsonRes({ error: "Latihan tidak dikenal" }, 422);
    if (step === "500") return jsonRes({ error: "x" }, 500);
    const results = body.sessions.map(
      (s: { clientId: string }, index: number) => {
        if (reject)
          return {
            index,
            clientId: s.clientId,
            result: "rejected",
            reason: reject.reason,
            envelopeMismatch: reject.envelopeMismatch ?? false,
          };
        const dup = db.has(s.clientId);
        if (!dup) db.set(s.clientId, s);
        return {
          index,
          clientId: s.clientId,
          result: dup ? "duplicate" : "stored",
          envelopeMismatch: mismatch,
        };
      },
    );
    // "drop": the server stored it but the response never reached the phone.
    if (step === "drop") throw new TypeError("network");
    const count = (r: string) =>
      results.filter((x: { result: string }) => x.result === r).length;
    return jsonRes({
      stored: count("stored"),
      duplicate: count("duplicate"),
      rejected: count("rejected"),
      results,
    });
  };
  return {
    db,
    calls,
    fetchFn,
    script: (s: typeof script) => {
      script = s;
    },
    setMismatch: (m: boolean) => {
      mismatch = m;
    },
    setReject: (r: typeof reject) => {
      reject = r;
    },
  };
}

describe("toSyncItem", () => {
  test("matches the server's strict schema and drops trace/device/reporter/repList", () => {
    const item = toSyncItem(summary(), 3);
    expect(sessionItemSchema.safeParse(item).success).toBe(true);
    expect(item).not.toHaveProperty("trace");
    expect(item).not.toHaveProperty("repList");
    expect(item).not.toHaveProperty("deviceId");
    expect(item).not.toHaveProperty("reportedBy");
    expect(item.activeMs).toBe(240_000);
    expect(item.breaches).toEqual([
      { kind: "angle", value: 95, limit: 90, heldMs: 311, atMs: 2000 },
    ]);
    expect(item.difficulty).toBe(3);
  });
});

describe("outbox", () => {
  test("enqueueing the same session twice keeps one row", async () => {
    const store = memStore();
    expect(await enqueue(store, UID, summary(), 1)).toBe(true);
    expect(await enqueue(store, UID, summary(), 1)).toBe(false);
    expect(store.rows.size).toBe(1);
  });

  test("retry after a dropped response sends the same key and creates no duplicate", async () => {
    const store = memStore();
    const srv = fakeServer();
    const api = createApiClient(srv.fetchFn);
    await enqueue(store, UID, summary(), 1, 0);

    srv.script(["drop", "ok"]);
    const first = await flushOutbox(store, api, UID, 0);
    expect(first.stopped).toBe("retry");
    expect(store.rows.get(SID)?.state).toBe("pending");
    expect(store.rows.get(SID)?.attempts).toBe(1);
    expect(srv.db.size).toBe(1); // server already has it

    // Too early: backoff holds the row back.
    expect((await flushOutbox(store, api, UID, 1)).sent).toBe(0);
    expect(srv.calls.length).toBe(1);

    const second = await flushOutbox(store, api, UID, backoffMs(1));
    expect(second.sent).toBe(1);
    expect(store.rows.get(SID)?.state).toBe("sent");
    expect(srv.db.size).toBe(1);
    expect(srv.calls[1].body.sessions[0].clientId).toBe(
      srv.calls[0].body.sessions[0].clientId,
    );

    // Already sent: a later flush sends nothing.
    await flushOutbox(store, api, UID, 10 ** 9);
    expect(srv.calls.length).toBe(2);
  });

  test("a 5xx keeps the row pending with backoff; sent only after 2xx", async () => {
    const store = memStore();
    const srv = fakeServer();
    await enqueue(store, UID, summary(), 1, 0);
    srv.script(["500"]);
    await flushOutbox(store, createApiClient(srv.fetchFn), UID, 0);
    expect(store.rows.get(SID)?.state).toBe("pending");
    expect(store.rows.get(SID)?.nextAt).toBe(backoffMs(1));
    expect(backoffMs(30)).toBe(5 * 60_000);
  });

  test("401 stops the flush without counting an attempt", async () => {
    const store = memStore();
    const srv = fakeServer();
    await enqueue(store, UID, summary(), 1, 0);
    srv.script(["401"]);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 0);
    expect(r.stopped).toBe("auth");
    expect(store.rows.get(SID)?.attempts).toBe(0);
    expect(store.rows.get(SID)?.state).toBe("pending");
  });

  test("a 422 rejects that item and the next one still goes out", async () => {
    const store = memStore();
    const srv = fakeServer();
    const other = "22222222-2222-4222-8222-222222222222";
    await enqueue(store, UID, summary(), 1, 0);
    await enqueue(store, UID, summary(other), 1, 1);
    srv.script(["422", "ok"]);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 5);
    expect(r).toMatchObject({ sent: 1, rejected: 1, stopped: null });
    expect(store.rows.get(SID)?.state).toBe("rejected");
    expect(store.rows.get(other)?.state).toBe("sent");
  });

  test("only the signed-in user's rows are sent", async () => {
    const store = memStore();
    const srv = fakeServer();
    await enqueue(store, "someone-else", summary(), 1, 0);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 5);
    expect(r.sent).toBe(0);
    expect(srv.calls.length).toBe(0);
  });

  test("an envelopeVersion mismatch in the response is reported", async () => {
    const store = memStore();
    const srv = fakeServer();
    srv.setMismatch(true);
    await enqueue(store, UID, summary(), 1, 0);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 0);
    expect(r.bundleStale).toBe(true);
    expect(store.rows.get(SID)?.state).toBe("sent");
  });

  test("an item rejected by the server is not sent and is never retried as-is", async () => {
    const store = memStore();
    const srv = fakeServer();
    srv.setReject({ reason: "client_id_conflict" });
    await enqueue(store, UID, summary(), 1, 0);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 0);
    expect(r).toMatchObject({ sent: 0, rejected: 1, bundleStale: false });
    expect(store.rows.get(SID)?.state).toBe("rejected");
    expect(store.rows.get(SID)?.lastError).toBe("client_id_conflict");
    await flushOutbox(store, createApiClient(srv.fetchFn), UID, 10 ** 9);
    expect(srv.calls.length).toBe(1);
  });

  test("a stale bundle on a rejected item asks for a refetch", async () => {
    const store = memStore();
    const srv = fakeServer();
    srv.setReject({
      reason: "envelope_version_unknown",
      envelopeMismatch: true,
    });
    await enqueue(store, UID, summary(), 1, 0);
    const r = await flushOutbox(store, createApiClient(srv.fetchFn), UID, 0);
    expect(r).toMatchObject({ rejected: 1, bundleStale: true });
    expect(store.rows.get(SID)?.state).toBe("rejected");
  });
});

const ex = (
  slug: string,
  version: number | null,
  maxAngleDeg = 70,
): BundleExercise => ({
  planExerciseId: `p-${slug}`,
  exerciseSlug: slug,
  exerciseName: slug,
  position: 0,
  envelope:
    version === null
      ? null
      : {
          version,
          maxAngleDeg,
          maxVelDegPerS: 50,
          debounceMs: 200,
          onBreach: "CUE_ONLY",
          notifyCaregiver: false,
        },
});

describe("versioned bundle", () => {
  test("fetchBundle sends since and validates the response", async () => {
    const urls: string[] = [];
    const api = createApiClient(async (url) => {
      urls.push(url);
      return jsonRes({ version: 2, exercises: [], removed: [] });
    });
    expect((await api.fetchBundle(2)).version).toBe(2);
    expect(urls[0]).toBe("/api/bundle?since=2");
    const bad = createApiClient(async () => jsonRes({ nope: 1 }));
    await expect(bad.fetchBundle(0)).rejects.toBeInstanceOf(ApiError);
  });

  test("a delta merges, a full pull replaces", () => {
    const full: Bundle = {
      version: 1,
      exercises: [ex("shoulder-flexion", 1), ex("elbow-flexion", 1)],
      removed: [],
    };
    const a = mergeBundle(null, UID, full, true, 1);
    const delta: Bundle = {
      version: 2,
      exercises: [ex("shoulder-flexion", 2, 60)],
      removed: [],
    };
    const b = mergeBundle(a, UID, delta, false, 2);
    expect(b.version).toBe(2);
    expect(b.exercises["shoulder-flexion"].envelope?.version).toBe(2);
    expect(b.exercises["elbow-flexion"].envelope?.version).toBe(1);
    const c = mergeBundle(
      b,
      UID,
      { version: 2, exercises: [ex("shoulder-flexion", 2, 60)], removed: [] },
      true,
      3,
    );
    expect(Object.keys(c.exercises)).toEqual(["shoulder-flexion"]);
    // Another account never inherits the previous cache.
    expect(
      mergeBundle(b, "other", { version: 0, exercises: [], removed: [] }, false)
        .exercises,
    ).toEqual({});
  });

  test("a delta drops the exercises listed as removed", () => {
    const full: Bundle = {
      version: 1,
      exercises: [ex("shoulder-flexion", 1), ex("elbow-flexion", 1)],
      removed: [],
    };
    const a = mergeBundle(null, UID, full, true, 1);
    const b = mergeBundle(
      a,
      UID,
      { version: 2, exercises: [], removed: ["p-elbow-flexion"] },
      false,
      2,
    );
    expect(Object.keys(b.exercises)).toEqual(["shoulder-flexion"]);
  });

  test("an exercise deleted and re-added between pulls keeps its new row", () => {
    const full: Bundle = {
      version: 1,
      exercises: [ex("shoulder-flexion", 1)],
      removed: [],
    };
    const a = mergeBundle(null, UID, full, true, 1);
    const readded = { ...ex("shoulder-flexion", 2), planExerciseId: "p-new" };
    const b = mergeBundle(
      a,
      UID,
      { version: 2, exercises: [readded], removed: ["p-shoulder-flexion"] },
      false,
      2,
    );
    expect(b.exercises["shoulder-flexion"].planExerciseId).toBe("p-new");
  });

  test("the latest envelope is applied to the exercise in use, and only that one", () => {
    const cache: BundleCache = mergeBundle(
      null,
      UID,
      {
        version: 4,
        exercises: [ex("shoulder-flexion", 4, 60), ex("elbow-flexion", 3, 40)],
        removed: [],
      },
      true,
    );
    const applied = applyBundle(DEFAULT_CONFIG, cache);
    expect(applied.envelope).toEqual({
      maxAngleDeg: 60,
      maxVelDegPerS: 50,
      debounceMs: 200,
    });
    expect(applied.reps).toEqual(DEFAULT_CONFIG.reps); // rep thresholds stay local
    expect(applyBundle(applied, cache)).toBe(applied); // no change, same object (no effect loop)
    expect(claimedVersion(applied, cache)).toBe(4);
    expect(
      claimedVersion({ ...applied, exercise: "elbow-flexion" }, cache),
    ).toBeNull(); // limits are shoulder's
  });

  test("no envelope: local limits stay and nothing is claimed", () => {
    const cache = mergeBundle(
      null,
      UID,
      { version: 0, exercises: [ex("shoulder-flexion", null)], removed: [] },
      true,
    );
    expect(applyBundle(DEFAULT_CONFIG, cache)).toBe(DEFAULT_CONFIG);
    expect(claimedVersion(DEFAULT_CONFIG, cache)).toBeNull();
    expect(claimedVersion(DEFAULT_CONFIG, null)).toBeNull();
  });

  test("breach behavior comes from the therapist and is part of the claim", () => {
    const base = ex("shoulder-flexion", 5);
    const cache = mergeBundle(
      null,
      UID,
      {
        version: 5,
        exercises: [
          {
            ...base,
            envelope: {
              version: 5,
              maxAngleDeg: 70,
              maxVelDegPerS: 50,
              debounceMs: 200,
              onBreach: "CUE_AND_PAUSE",
              notifyCaregiver: true,
            },
          },
        ],
        removed: [],
      },
      true,
    );
    const applied = applyBundle(DEFAULT_CONFIG, cache);
    expect(applied.onBreach).toBe("CUE_AND_PAUSE");
    expect(applied.notifyCaregiver).toBe(true);
    expect(claimedVersion(applied, cache)).toBe(5);
    // Same numbers, different behavior: the phone is not running the therapist's envelope.
    expect(
      claimedVersion({ ...applied, onBreach: "CUE_ONLY" }, cache),
    ).toBeNull();
    expect(applyBundle({ ...applied, onBreach: "CUE_ONLY" }, cache)).toEqual(
      applied,
    );
  });
});

describe("relay ticket", () => {
  test("asks POST /api/ws-ticket for a fresh ticket on every connect", async () => {
    const seen: { url: string; method?: string }[] = [];
    let i = 0;
    const api = createApiClient(async (url, init) => {
      seen.push({ url, method: init?.method });
      return jsonRes(
        { ticket: `t${++i}`, role: "phone", expiresInMs: 60_000 },
        201,
      );
    });
    const get = makeTicketProvider(api, () => true);
    expect(await get()).toBe("t1");
    expect(await get()).toBe("t2");
    expect(seen[0]).toEqual({ url: "/api/ws-ticket", method: "POST" });
  });

  test("signed out: no request, null (phone-only fallback)", async () => {
    let called = 0;
    const api = createApiClient(async () => {
      called++;
      return jsonRes({});
    });
    expect(await makeTicketProvider(api, () => false)()).toBeNull();
    expect(called).toBe(0);
  });

  test("401/403 gives null; a network or 5xx failure throws so the relay retries", async () => {
    const mk = (res: () => Promise<Response>) =>
      makeTicketProvider(createApiClient(res), () => true);
    expect(await mk(async () => jsonRes({ error: "x" }, 401))()).toBeNull();
    expect(await mk(async () => jsonRes({ error: "x" }, 403))()).toBeNull();
    await expect(
      mk(async () => jsonRes({ error: "x" }, 500))(),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      mk(async () => {
        throw new TypeError("offline");
      })(),
    ).rejects.toMatchObject({ status: 0 });
  });

  test("the ticket goes in the ws query string, URL-encoded", () => {
    expect(relayUrl("https:", "h:3443", "a b/c")).toBe(
      "wss://h:3443/ws?ticket=a%20b%2Fc",
    );
    expect(relayUrl("http:", "h:3000")).toBe("ws://h:3000/ws");
  });
});
