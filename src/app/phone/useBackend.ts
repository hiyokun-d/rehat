"use client";
// /phone <-> backend: login, the program bundle, and the outbox. Everything here is optional:
// signed out (or Supabase not configured) the phone works exactly as before, on its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BundleCache,
  claimedVersion,
  mergeBundle,
} from "@/lib/api/bundleCache";
import { createApiClient } from "@/lib/api/client";
import { enqueue, flushOutbox } from "@/lib/api/outbox";
import {
  dexieOutbox,
  loadBundleCache,
  pendingCount,
  saveBundleCache,
} from "@/lib/api/outboxStore";
import { makeTicketProvider } from "@/lib/api/wsTicket";
import type { SessionSummary } from "@/lib/rehab/summary";
import { createClient } from "@/lib/supabase/client";

export type AuthState =
  | { status: "loading" }
  | { status: "unavailable" } // Supabase env not set: local mode only
  | { status: "out" }
  | { status: "in"; userId: string; email: string };

const FLUSH_EVERY_MS = 30_000;

export function useBackend() {
  const api = useMemo(() => createApiClient(), []);
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [cache, setCache] = useState<BundleCache | null>(null);
  const [pending, setPending] = useState(0);
  const supabase = useRef<SupabaseClient | null>(null);
  const userRef = useRef<string | null>(null);
  const cacheRef = useRef<BundleCache | null>(null);
  const flushing = useRef<Promise<void> | null>(null);

  const putCache = useCallback((c: BundleCache | null) => {
    cacheRef.current = c;
    setCache(c);
    saveBundleCache(c).catch(() => {});
  }, []);

  /** since=0 (full) replaces the cache; otherwise only the delta since the held version. */
  const refreshBundle = useCallback(
    async (full = false) => {
      const uid = userRef.current;
      if (!uid) return;
      const prev = cacheRef.current?.userId === uid ? cacheRef.current : null;
      const since = full || !prev ? 0 : prev.version;
      try {
        const b = await api.fetchBundle(since);
        if (userRef.current !== uid) return; // signed out or switched while waiting
        putCache(mergeBundle(prev, uid, b, since === 0));
      } catch {
        // Offline or not a patient: keep whatever is cached, the phone still works.
      }
    },
    [api, putCache],
  );

  const flush = useCallback((): Promise<void> => {
    const uid = userRef.current;
    if (!uid) return Promise.resolve();
    if (flushing.current) return flushing.current;
    flushing.current = (async () => {
      try {
        const r = await flushOutbox(dexieOutbox, api, uid);
        // The phone holds a stale bundle (envelope mismatch or an exercise it does not know).
        if (r.bundleStale) await refreshBundle(true);
      } catch {
        // Storage error: rows stay queued and the next flush tries again.
      } finally {
        flushing.current = null;
        setPending(await pendingCount(uid).catch(() => 0));
      }
    })();
    return flushing.current;
  }, [api, refreshBundle]);

  const setUser = useCallback((u: { id: string; email?: string } | null) => {
    userRef.current = u?.id ?? null;
    setAuth(
      u
        ? { status: "in", userId: u.id, email: u.email ?? "" }
        : { status: "out" },
    );
  }, []);

  useEffect(() => {
    let client: SupabaseClient;
    try {
      client = createClient();
    } catch {
      setAuth({ status: "unavailable" });
      return;
    }
    supabase.current = client;
    client.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user ?? null))
      .catch(() => setUser(null));
    const { data } = client.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, [setUser]);

  // On login: show the cached bundle at once (works offline), then pull a full fresh one and send
  // whatever the outbox still holds for this login.
  const userId = auth.status === "in" ? auth.userId : null;
  const signedOut = auth.status === "out";
  useEffect(() => {
    if (!userId) {
      // Clear only once we know there is no login (not while still loading at startup).
      if (signedOut) {
        putCache(null);
        setPending(0);
      }
      return;
    }
    let stale = false;
    loadBundleCache()
      .then((c) => {
        if (!stale && c?.userId === userId && !cacheRef.current) {
          cacheRef.current = c;
          setCache(c);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) refreshBundle(true).then(flush);
      });
    return () => {
      stale = true;
    };
  }, [userId, signedOut, putCache, refreshBundle, flush]);

  useEffect(() => {
    if (!userId) return;
    const id = setInterval(flush, FLUSH_EVERY_MS);
    window.addEventListener("online", flush);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", flush);
    };
  }, [userId, flush]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase.current) return "Login belum tersedia.";
    try {
      const { error } = await supabase.current.auth.signInWithPassword({
        email,
        password,
      });
      return error ? "Email atau kata sandi salah." : null;
    } catch {
      return "Tidak ada koneksi ke server.";
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.current?.auth.signOut().catch(() => {});
    setUser(null);
  }, [setUser]);

  /**
   * Queue a finished session. Only when signed in AND the limits it ran with are the therapist's
   * envelope (claimedVersion); otherwise it stays local, as before.
   */
  const enqueueSession = useCallback(
    async (s: SessionSummary) => {
      const uid = userRef.current;
      const version = claimedVersion(s.config, cacheRef.current);
      if (!uid || version === null) return;
      await enqueue(dexieOutbox, uid, s, version).catch(() => {});
      await flush();
    },
    [flush],
  );

  const getTicket = useMemo(
    () => makeTicketProvider(api, () => userRef.current !== null),
    [api],
  );

  return {
    auth,
    cache,
    pending,
    signIn,
    signOut,
    refreshBundle,
    enqueueSession,
    getTicket,
  };
}
