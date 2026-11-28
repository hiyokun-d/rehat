// Shared fetch client for the backend routes (/api/bundle, /api/sync, /api/ws-ticket).
// Screens use this instead of calling fetch directly, so error handling and the contract live in
// one place. The login session is the Supabase cookie, sent automatically on same-origin requests.
//
// Types come from the server modules with `import type` only: they are erased at build time, so
// no server code (zod, Prisma) ships to the browser, and a contract change breaks tsc here.
import type { Bundle } from "@/lib/relay/bundle";
import type { SessionItem, SyncItemResult } from "@/lib/relay/sync";

export type {
  Bundle,
  BundleEnvelope,
  BundleExercise,
} from "@/lib/relay/bundle";
export type { SessionItem, SyncItemResult } from "@/lib/relay/sync";

/** status 0 = no response (offline, DNS, timeout). Anything else is the HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** Not signed in, or signed in with a role this route does not accept. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Worth retrying later: no response, rate limit, or a server fault. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface SyncResponse {
  stored: number;
  duplicate: number;
  rejected: number;
  results: SyncItemResult[];
}

export interface WsTicket {
  ticket: string;
  role: "phone" | "screen";
  expiresInMs: number;
}

export interface ApiClient {
  /** `since` = cursor from the last response; 0 returns everything. */
  fetchBundle(since: number): Promise<Bundle>;
  /** Idempotent on each item's clientId; there is no Idempotency-Key header. */
  postSync(items: SessionItem[]): Promise<SyncResponse>;
  requestWsTicket(): Promise<WsTicket>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;

export function createApiClient(
  // Resolved per call so tests (and Next) can replace globalThis.fetch after import.
  fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init),
): ApiClient {
  async function call(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(path, {
        ...init,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, "Tidak ada koneksi ke server.");
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      throw new ApiError(
        res.status,
        typeof msg === "string" ? msg : `Permintaan gagal (${res.status}).`,
      );
    }
    return body;
  }

  return {
    async fetchBundle(since) {
      const body = await call(`/api/bundle?since=${Math.max(0, since | 0)}`, {
        method: "GET",
      });
      const b = body as Partial<Bundle> | null;
      if (
        typeof b?.version !== "number" ||
        !Array.isArray(b.exercises) ||
        !Array.isArray(b.removed)
      )
        throw new ApiError(502, "Respons bundle tidak dikenali.");
      return b as Bundle;
    },

    async postSync(items) {
      const body = await call("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: items }),
      });
      const r = body as Partial<SyncResponse> | null;
      if (!Array.isArray(r?.results))
        throw new ApiError(502, "Respons sync tidak dikenali.");
      return r as SyncResponse;
    },

    async requestWsTicket() {
      const body = await call("/api/ws-ticket", { method: "POST" });
      const t = body as Partial<WsTicket> | null;
      if (typeof t?.ticket !== "string" || !t.ticket)
        throw new ApiError(502, "Respons tiket tidak dikenali.");
      return t as WsTicket;
    },
  };
}
