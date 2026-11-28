// Dexie-backed storage for the outbox and the bundle cache. Thin on purpose: the logic that
// matters (idempotent retry, versioned envelope) is in outbox.ts and bundleCache.ts, tested there.
import { getDb } from "@/lib/db";
import type { BundleCache } from "./bundleCache";
import type { OutboxStore } from "./outbox";

const BUNDLE_KEY = "bundle-cache";

export const dexieOutbox: OutboxStore = {
  async add(row) {
    // Dexie's add() rejects on a duplicate primary key: that is the "already queued" case.
    try {
      await getDb().outbox.add(row);
      return true;
    } catch (e) {
      if ((e as Error).name === "ConstraintError") return false;
      throw e;
    }
  },
  async due(userId, now) {
    const rows = await getDb().outbox.where("userId").equals(userId).toArray();
    return rows
      .filter((r) => r.state === "pending" && r.nextAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async update(id, patch) {
    await getDb().outbox.update(id, patch);
  },
};

/** Sessions of this login still waiting for the server. */
export async function pendingCount(userId: string): Promise<number> {
  const rows = await getDb().outbox.where("userId").equals(userId).toArray();
  return rows.filter((r) => r.state === "pending").length;
}

export async function loadBundleCache(): Promise<BundleCache | null> {
  const row = await getDb().settings.get(BUNDLE_KEY);
  return (row?.value as BundleCache | undefined) ?? null;
}

export async function saveBundleCache(c: BundleCache | null): Promise<void> {
  if (c) await getDb().settings.put({ key: BUNDLE_KEY, value: c });
  else await getDb().settings.delete(BUNDLE_KEY);
}
