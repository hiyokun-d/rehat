// One-time tickets that gate the relay WebSocket upgrade (S1). A browser WebSocket cannot send
// an Authorization header, so an authenticated HTTP route (POST /api/ws-ticket) mints a random
// ticket and the phone/screen passes it as ?ticket= on the ws URL. The raw ticket is never
// stored or logged: only its SHA-256 is kept, with a short TTL, and it is consumed on first use.
//
// A ticket carries who may use it (userId, relay role, owning therapist, patient), so the relay
// takes identity from the ticket and never from the client's join message.
//
// Kept free of `ws`, `next` and Supabase so server.mts (Node type-stripping, erasable syntax
// only) and the unit tests can both use it.
//
// Store location (R1-K2): the route handler is bundled by Next while server.mts loads this file
// straight through Node, so a module-level Map could be two separate Maps. The store lives on
// globalThis under a Symbol.for key instead. That is safe here because `node server.mts` runs
// Next in the same process (next({ dev }) in-process; route handlers run in the Node runtime, not
// a sandbox), so every copy of this module sees the same globalThis.
//
// shortcut: in-memory single-process store; resets on restart and is not shared across instances.
// Move to a shared store (Redis/Postgres) before running more than one relay instance or on
// serverless (Vercel), where server.mts does not run at all.
import { createHash, randomBytes } from "node:crypto";

/** 60 s is enough for the page to open the socket right after minting; short limits replay. */
export const TICKET_TTL_MS = 60_000;
const TICKET_BYTES = 32;

export type TicketRole = "phone" | "screen";

/**
 * `therapistId` owns the room: the therapist's own id for a screen, the patient's therapist for
 * a phone. `patientId` is set on phones only (a patient, or the patient a caregiver is linked to).
 */
export interface TicketClaims {
  userId: string;
  role: TicketRole;
  therapistId: string;
  patientId: string | null;
}

type Entry = { expiresAt: number; claims: TicketClaims };

const STORE_KEY = Symbol.for("rehat.relay.tickets");
const g = globalThis as unknown as { [STORE_KEY]?: Map<string, Entry> };

function ticketStore(): Map<string, Entry> {
  const existing = g[STORE_KEY];
  if (existing) return existing;
  const created = new Map<string, Entry>();
  g[STORE_KEY] = created;
  return created;
}

const tickets = ticketStore();

export function generateTicket(): string {
  return randomBytes(TICKET_BYTES).toString("base64url");
}

export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/** Mints a ticket and stores only its hash. Returns the raw ticket (shown once to the caller). */
export function issueTicket(claims: TicketClaims, now = Date.now()): string {
  sweepTickets(now);
  const ticket = generateTicket();
  tickets.set(hashTicket(ticket), {
    expiresAt: now + TICKET_TTL_MS,
    claims: { ...claims },
  });
  return ticket;
}

/**
 * Validates and consumes a ticket in one step: a second call with the same ticket fails, and an
 * expired ticket fails. Returns the claims it was minted with, or null. Takes the raw ticket; it
 * is hashed here so the caller never compares plaintext.
 */
export function consumeTicket(
  ticket: string,
  now = Date.now(),
): TicketClaims | null {
  const hash = hashTicket(ticket);
  const entry = tickets.get(hash);
  if (!entry) return null;
  tickets.delete(hash); // single-use: gone whether or not it had expired
  if (entry.expiresAt <= now) return null;
  return entry.claims;
}

/** Drops expired entries and returns how many went. Also run on a timer by server.mts (R1-S5). */
export function sweepTickets(now = Date.now()): number {
  let removed = 0;
  for (const [hash, entry] of tickets) {
    if (entry.expiresAt <= now) {
      tickets.delete(hash);
      removed += 1;
    }
  }
  return removed;
}

/** Periodic sweep so tickets that are minted but never used do not pile up between mints. */
export function startTicketSweeper(everyMs = TICKET_TTL_MS): () => void {
  const timer = setInterval(() => sweepTickets(), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function ticketCount(): number {
  return tickets.size;
}

/** Test helper: empties the store. */
export function resetTickets(): void {
  tickets.clear();
}
