// Local fetch helper for the /screen "Riwayat server" panel. Talks only to the therapist routes
// GET /api/sessions and GET /api/breaches. Dates arrive as ISO strings (JSON).

export type ServerSession = {
  id: string;
  patientId: string;
  planExerciseId: string;
  status: "COMPLETED" | "CANNOT_DO" | "POSTPONED";
  reportedBy: "PATIENT" | "CAREGIVER";
  startedAt: string;
  endedAt: string | null;
  envelopeVersion: number;
  attempt: {
    reps: number;
    activeMs: number;
    maxAngleDeg: number;
    maxVelDegPerS: number;
    pauses: number;
  } | null;
};

export type ServerBreach = {
  id: string;
  sessionId: string;
  kind: "ANGLE" | "VELOCITY";
  value: number;
  limit: number;
  heldMs: number;
  occurredAt: string;
};

type Paged<T> = { items: T[]; page: number; limit: number; hasMore: boolean };

/** Why a fetch did not give data. "login" = no session (401); "forbidden" = signed in, not a therapist (403). */
export type HistoryError = "login" | "forbidden" | "notfound" | "error";

export type Loaded<T> =
  | { ok: true; data: T }
  | { ok: false; error: HistoryError };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PAGE_SIZE = 20;

async function get<T>(url: string, fetchImpl: FetchLike): Promise<Loaded<T>> {
  try {
    const res = await fetchImpl(url, { credentials: "same-origin" });
    if (res.status === 401) return { ok: false, error: "login" };
    if (res.status === 403) return { ok: false, error: "forbidden" };
    if (res.status === 404) return { ok: false, error: "notfound" };
    if (!res.ok) return { ok: false, error: "error" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "error" };
  }
}

export function fetchSessions(
  page = 1,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
) {
  const q = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  return get<Paged<ServerSession>>(`/api/sessions?${q}`, fetchImpl);
}

export function fetchBreaches(
  sessionId: string,
  page = 1,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
) {
  const q = new URLSearchParams({
    sessionId,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  return get<Paged<ServerBreach> & { sessionId: string }>(
    `/api/breaches?${q}`,
    fetchImpl,
  );
}
