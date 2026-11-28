// Outbox: a finished session is written here first, then sent by POST /api/sync. Losing Wi-Fi,
// closing the tab or a server error never loses a session; it stays queued until the server gives
// a per-item result that says it was stored.
//
// Idempotency (K5, R1-K11): each row's `id` is the session's clientId, generated once on the phone
// and stored. Every retry of that row sends the same clientId, which is the server's primary key;
// the server answers `duplicate` when it already has it, so a retry after a dropped response never
// makes a second row. There is no Idempotency-Key header.
//
// Pure logic over an OutboxStore (Dexie in the app, a Map in tests). One item per POST: a bad item
// cannot hold back the others, and each item gets its own result.
//
// Breach events travel inside the session they belong to (the server has no separate breach
// route), so a breach is queued when its session ends, not the moment it happens.
import type { SessionSummary } from "@/lib/rehab/summary";
import { type ApiClient, ApiError, type SessionItem } from "./client";

export type OutboxState = "pending" | "sent" | "rejected";

export interface OutboxRow {
  /** The session id (clientId). One row per session, so enqueuing twice is a no-op. */
  id: string;
  /** Only this login's rows are sent: a different account on the same phone never uploads them. */
  userId: string;
  payload: SessionItem;
  state: OutboxState;
  createdAt: number;
  attempts: number;
  /** Do not retry before this time (ms epoch). */
  nextAt: number;
  lastError?: string;
  sentAt?: number;
}

export interface OutboxStore {
  /** Adds the row unless one with the same id exists. Returns whether it was added. */
  add(row: OutboxRow): Promise<boolean>;
  /** Pending rows of this user with nextAt <= now, oldest first. */
  due(userId: string, now: number): Promise<OutboxRow[]>;
  update(id: string, patch: Partial<OutboxRow>): Promise<void>;
}

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
// shortcut: no jitter. Fine for one phone per login; add jitter if many phones share a deploy.
export const backoffMs = (attempts: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

const MAX_REPS = 10_000;
const MAX_BREACHES = 1_000;
const MAX_NOTE = 500;
const DIFFICULTY = { mudah: 1, sedang: 3, sulit: 5 } as const;

const int = (n: number) => Math.max(0, Math.round(n));

/**
 * The summary reduced to what POST /api/sync accepts. The server rejects unknown keys, so this
 * lists fields explicitly: no `trace`, no `repList`, no device ids, no `reportedBy`. Raw samples
 * and the per-rep curve never leave the phone.
 */
export function toSyncItem(
  s: SessionSummary,
  envelopeVersion: number,
): SessionItem {
  return {
    clientId: s.id,
    exercise: s.exercise,
    status: "COMPLETED",
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    envelopeVersion,
    reps: Math.min(MAX_REPS, int(s.reps)),
    activeMs: int(s.activeMs),
    maxAngleDeg: s.maxAngleDeg,
    maxVelDegS: s.maxVelDegS,
    pauses: int(s.pauses),
    breaches: s.breaches.slice(0, MAX_BREACHES).map((b) => ({
      kind: b.kind,
      value: b.value,
      limit: b.limit,
      heldMs: int(b.heldMs),
      atMs: int(b.atMs),
    })),
    difficulty: s.difficulty ? DIFFICULTY[s.difficulty] : null,
    note: s.note ? s.note.slice(0, MAX_NOTE) : null,
  };
}

export async function enqueue(
  store: OutboxStore,
  userId: string,
  summary: SessionSummary,
  envelopeVersion: number,
  now = Date.now(),
): Promise<boolean> {
  return store.add({
    id: summary.id,
    userId,
    payload: toSyncItem(summary, envelopeVersion),
    state: "pending",
    createdAt: now,
    attempts: 0,
    nextAt: now,
  });
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** The cached bundle is stale: refetch it before the next session. */
  bundleStale: boolean;
  /** Stopped early: "auth" (401/403, not signed in or wrong role) or "retry" (no response, 429, 5xx). */
  stopped: "auth" | "retry" | null;
}

/**
 * Sends every due row of `userId`, oldest first. A row is marked sent only after the server says
 * `stored` or `duplicate` for it.
 * - 401/403: stop, change nothing (the row is fine, the login is not).
 * - no response / 429 / 5xx: attempts+1, back off, stop (the rest would fail the same way).
 * - other 4xx (a malformed request): the server will never accept this payload: mark rejected.
 * - item result `rejected`: mark rejected and never resend it as-is. A stale bundle is reported so
 *   the caller can refetch; the session itself is not retried.
 */
export async function flushOutbox(
  store: OutboxStore,
  api: Pick<ApiClient, "postSync">,
  userId: string,
  now = Date.now(),
): Promise<FlushResult> {
  const out: FlushResult = {
    sent: 0,
    rejected: 0,
    bundleStale: false,
    stopped: null,
  };
  for (const row of await store.due(userId, now)) {
    try {
      const res = await api.postSync([row.payload]);
      const item = res.results[0];
      if (!item) throw new ApiError(502, "Respons sync tidak berisi hasil.");
      if (item.result === "rejected") {
        await store.update(row.id, {
          state: "rejected",
          lastError: item.reason ?? "rejected",
        });
        out.rejected++;
        if (
          item.envelopeMismatch ||
          item.reason === "unknown_exercise" ||
          item.reason === "envelope_version_unknown"
        )
          out.bundleStale = true;
        continue;
      }
      await store.update(row.id, {
        state: "sent",
        sentAt: now,
        lastError: undefined,
      });
      out.sent++;
      if (item.envelopeMismatch) out.bundleStale = true;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.isAuth) return { ...out, stopped: "auth" };
      if (e.isTransient) {
        const attempts = row.attempts + 1;
        await store.update(row.id, {
          attempts,
          nextAt: now + backoffMs(attempts),
          lastError: e.message,
        });
        return { ...out, stopped: "retry" };
      }
      await store.update(row.id, { state: "rejected", lastError: e.message });
      out.rejected++;
    }
  }
  return out;
}
