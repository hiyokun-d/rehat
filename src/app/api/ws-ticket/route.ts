import { defaultDeps, handleWsTicket } from "@/lib/relay/ticketHandler";

/**
 * POST /api/ws-ticket: a signed-in user mints a one-time ticket to open the relay WebSocket
 * (S1). A browser WebSocket cannot send an Authorization header, so server.mts gates the upgrade
 * on a ?ticket= that this route issued. The ticket binds the user, relay role, therapist and
 * patient; the raw value is returned once and never logged. See src/lib/relay/ticketHandler.ts.
 */
export function POST() {
  return handleWsTicket(defaultDeps);
}
