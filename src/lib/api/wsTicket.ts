// One-time ticket for the relay WebSocket. A browser WebSocket cannot send an Authorization
// header, so server.mts accepts a `?ticket=` minted by POST /api/ws-ticket. A ticket works once
// and lives 60 s, so every (re)connect asks for a fresh one.
import { type ApiClient, ApiError } from "./client";

/**
 * Returns a function for useRelay's `getTicket`:
 *   string  -> connect with this ticket
 *   null    -> not allowed (signed out, or the server said 401/403): do not retry, stay phone-only
 *   throws  -> temporary failure (offline, 5xx, 429): the caller retries with backoff
 */
export function makeTicketProvider(
  api: Pick<ApiClient, "requestWsTicket">,
  isSignedIn: () => boolean,
): () => Promise<string | null> {
  return async () => {
    if (!isSignedIn()) return null;
    try {
      return (await api.requestWsTicket()).ticket;
    } catch (e) {
      if (e instanceof ApiError && !e.isTransient) return null;
      throw e;
    }
  };
}

/** Relay URL. The ticket is URL-encoded and never logged by this code. */
export function relayUrl(
  protocol: string,
  host: string,
  ticket?: string,
): string {
  const scheme = protocol === "https:" ? "wss" : "ws";
  const q = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
  return `${scheme}://${host}/ws${q}`;
}
