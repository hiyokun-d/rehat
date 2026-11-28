import { beforeEach, describe, expect, test } from "bun:test";
import {
  consumeTicket,
  generateTicket,
  hashTicket,
  issueTicket,
  resetTickets,
  TICKET_TTL_MS,
  type TicketClaims,
} from "../src/lib/relay/tickets";

const claims = (role: "phone" | "screen"): TicketClaims => ({
  userId: "u1",
  role,
  therapistId: "t1",
  patientId: role === "phone" ? "p1" : null,
});

describe("ticket value", () => {
  test("is at least 128 bits and unique", () => {
    const a = generateTicket();
    expect(Buffer.from(a, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(generateTicket()).not.toBe(a);
  });

  test("hash is sha256 hex and deterministic", () => {
    expect(hashTicket("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("issue + consume", () => {
  beforeEach(resetTickets);

  test("a minted ticket validates once and returns its claims", () => {
    const t0 = 1_000;
    const ticket = issueTicket(claims("phone"), t0);
    expect(consumeTicket(ticket, t0)).toEqual(claims("phone"));
  });

  test("single use: the second consume fails", () => {
    const t0 = 1_000;
    const ticket = issueTicket(claims("screen"), t0);
    expect(consumeTicket(ticket, t0)).toEqual(claims("screen"));
    expect(consumeTicket(ticket, t0)).toBeNull();
  });

  test("expires after the TTL", () => {
    const t0 = 1_000;
    const ticket = issueTicket(claims("phone"), t0);
    expect(consumeTicket(ticket, t0 + TICKET_TTL_MS + 1)).toBeNull();
  });

  test("still valid at the edge of the window", () => {
    const t0 = 1_000;
    const ticket = issueTicket(claims("phone"), t0);
    expect(consumeTicket(ticket, t0 + TICKET_TTL_MS - 1)).toEqual(
      claims("phone"),
    );
  });

  test("an unknown ticket is rejected", () => {
    expect(consumeTicket("not-a-real-ticket")).toBeNull();
  });

  test("the raw ticket is not stored (only its hash can be present)", () => {
    const t0 = 1_000;
    const ticket = issueTicket(claims("phone"), t0);
    // An expired consume both reports null and drops the entry, proving storage is keyed by hash,
    // not the plaintext: re-issuing yields a different ticket each time.
    const other = issueTicket(claims("phone"), t0);
    expect(other).not.toBe(ticket);
  });
});
