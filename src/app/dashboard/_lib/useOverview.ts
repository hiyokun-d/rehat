"use client";
// The dashboard's one data source for the patient list. Built to feel instant on a cheap phone
// on a weak connection:
// 1. Show the last overview from this browser at once (stale-while-revalidate), marked with
//    its age, so the nurse reads something before the network answers.
// 2. One request (/api/overview) computes everything server-side for all patients.
// 3. Refresh every 30 s while the tab is visible, on focus, and immediately when the staff
//    channel pushes a help request.
// The cache holds names + counts for this nurse's own patients only, in this browser. It is
// cleared on sign-out (clearOverviewCache). Not used for anything safety-critical.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveChannel } from "@/hooks/useLiveChannel";
import type { LiveMsg, LivePeer } from "@/lib/live/protocol";
import { api, type DashError, type OverviewRow } from "./api";

const KEY = "rehat.overview.v1";
const POLL_MS = 30_000;

interface Cached {
  owner: string;
  at: number;
  rows: OverviewRow[];
}

function readCache(owner: string): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Cached | null;
    return c && c.owner === owner && Array.isArray(c.rows) ? c : null;
  } catch {
    return null;
  }
}

export function clearOverviewCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export interface HelpPing {
  requestId: string;
  patientId: string;
  displayName: string;
  at: string;
}

export function useOverview(owner: string | null, me: LivePeer | null) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState<HelpPing | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!owner || busy.current) return;
    busy.current = true;
    try {
      const r = await api.overview();
      setRows(r);
      setFetchedAt(Date.now());
      setFromCache(false);
      setError(null);
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ owner, at: Date.now(), rows: r } satisfies Cached),
        );
      } catch {}
    } catch (x) {
      setError((x as DashError).message);
    } finally {
      busy.current = false;
    }
  }, [owner]);

  useEffect(() => {
    if (!owner) {
      setRows(null);
      return;
    }
    const c = readCache(owner);
    if (c) {
      setRows(c.rows);
      setFetchedAt(c.at);
      setFromCache(true);
    }
    refresh();
    const tick = () => document.visibilityState === "visible" && refresh();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
    };
  }, [owner, refresh]);

  // staff:<me> carries help requests for ALL of this nurse's patients (server-sent only).
  const onMessage = useCallback(
    (m: LiveMsg) => {
      if (m.type !== "help" || m.from !== "server") return;
      setPing(m.payload as HelpPing);
      navigator.vibrate?.([200, 100, 200, 100, 200]);
      refresh();
    },
    [refresh],
  );
  const live = useLiveChannel({
    patientId: null,
    topic: owner ? `staff:${owner}` : undefined,
    enabled: !!owner && !!me,
    me,
    onMessage,
  });

  return {
    rows,
    fetchedAt,
    fromCache,
    error,
    refresh,
    ping,
    clearPing: useCallback(() => setPing(null), []),
    liveState: live.state,
  };
}
