// The gate for a /ws upgrade request, shared by server.mts and the tests: Origin first, then the
// one-time ticket from ?ticket= (validated and consumed). The ticket value is never logged.
import type { makeOriginCheck } from "./origin.ts";
import { consumeTicket, type TicketClaims } from "./tickets.ts";

export interface UpgradeRequest {
  url?: string;
  headers: { origin?: string; host?: string };
}

export type UpgradeResult =
  | { ok: true; claims: TicketClaims }
  | { ok: false; status: 401 | 403; reason: string };

export function authorizeUpgrade(
  req: UpgradeRequest,
  originAllowed: ReturnType<typeof makeOriginCheck>,
): UpgradeResult {
  if (!originAllowed(req.headers.origin, req.headers.host))
    return { ok: false, status: 403, reason: "Forbidden" };
  const q = req.url?.indexOf("?");
  const ticket =
    q === undefined || q < 0
      ? null
      : new URLSearchParams(req.url?.slice(q + 1)).get("ticket");
  const claims = ticket ? consumeTicket(ticket) : null;
  if (!claims) return { ok: false, status: 401, reason: "Unauthorized" };
  return { ok: true, claims };
}
