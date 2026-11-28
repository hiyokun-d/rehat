// shortcut: MVP limiter. Counts live in this process's memory, so they reset on restart and are
// not shared between instances, and the IP comes from x-forwarded-for, which only a trusted
// proxy may set. Replace with a shared store (Redis/Postgres) before running more than one
// instance or exposing the app without a proxy that overwrites that header.
export const INVITE_ATTEMPTS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const hits = new Map<string, Entry>();

/** Counts one attempt for `key`. Returns false once the limit for the window is exceeded. */
export function allowAttempt(
  key: string,
  limit = INVITE_ATTEMPTS_PER_HOUR,
  now = Date.now(),
): boolean {
  for (const [k, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(k);
  }
  const entry = hits.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  hits.set(key, entry);
  return entry.count <= limit;
}

export function resetAttempts() {
  hits.clear();
}

export function clientIp(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
