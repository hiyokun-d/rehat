"use client";
// Saved session summaries on this device, newest first, kept live with Dexie's liveQuery
// (any write from anywhere on this page updates every list).
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/db";
import type { SessionSummary } from "@/lib/rehab/summary";

export function useSessions(): SessionSummary[] {
  const [rows, setRows] = useState<SessionSummary[]>([]);
  useEffect(() => {
    const sub = liveQuery(() =>
      getDb().sessions.orderBy("startedAt").reverse().toArray(),
    ).subscribe({ next: setRows, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return rows;
}
