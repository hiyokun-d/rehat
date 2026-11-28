import { beforeEach, describe, expect, test } from "bun:test";
import type { Profile } from "../src/generated/prisma/client";
import type { GuardDeps } from "../src/lib/auth/guard";
import { resetAttempts } from "../src/lib/auth/rateLimit";
import {
  CLOSE_TOO_MANY_ATTEMPTS,
  createMessageHandler,
  MAX_JOIN_FAILURES,
} from "../src/lib/relay/connection";
import { makeOriginCheck, parseAllowedOrigins } from "../src/lib/relay/origin";
import { parseClientMessage } from "../src/lib/relay/protocol";
import { type Peer, Rooms } from "../src/lib/relay/rooms";
import {
  handleWsTicket,
  type LinkedPatient,
  WS_TICKETS_PER_HOUR,
} from "../src/lib/relay/ticketHandler";
import {
  consumeTicket,
  issueTicket,
  resetTickets,
  startTicketSweeper,
  sweepTickets,
  TICKET_TTL_MS,
  type TicketClaims,
  ticketCount,
} from "../src/lib/relay/tickets";
import { authorizeUpgrade } from "../src/lib/relay/upgrade";

type TestPeer = Peer & { inbox: string[]; kicked: string };
function peer(): TestPeer {
  const p = { inbox: [] as string[], kicked: "" } as TestPeer;
  p.send = (t) => p.inbox.push(t);
  p.kick = (r) => {
    p.kicked = r;
  };
  return p;
}
const last = (p: TestPeer) => JSON.parse(p.inbox[p.inbox.length - 1] ?? "null");
const codes = (p: TestPeer) =>
  p.inbox.map((t) => JSON.parse(t)).filter((m) => m.type === "error");

const screenOf = (therapistId: string): TicketClaims => ({
  userId: therapistId,
  role: "screen",
  therapistId,
  patientId: null,
});
const phoneOf = (therapistId: string, patientId: string): TicketClaims => ({
  userId: patientId,
  role: "phone",
  therapistId,
  patientId,
});

function connect(rooms: Rooms, claims: TicketClaims) {
  const p = peer();
  const closed: Array<[number, string]> = [];
  const onText = createMessageHandler(rooms, p, claims, (c, r) =>
    closed.push([c, r]),
  );
  return { p, onText, closed };
}
const join = (roomId?: string, role = "phone") =>
  JSON.stringify({ type: "join", roomId: "", t: 0, payload: { role, roomId } });

beforeEach(() => {
  resetTickets();
  resetAttempts();
});

describe("R1-S1: ticket identity decides role and room", () => {
  test("a phone ticket joins as phone even if the join message claims screen", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;

    const ph = connect(rooms, phoneOf("t1", "p1"));
    ph.onText(join(roomId, "screen"));
    expect(last(ph.p)).toMatchObject({
      type: "joined",
      payload: { role: "phone", roomId },
    });
    expect(rooms.counts(roomId)).toEqual({ phones: 1, screens: 1 });
  });

  test("a screen ticket cannot take the phone role by claiming it", () => {
    const rooms = new Rooms();
    const a = connect(rooms, screenOf("t1"));
    a.onText(join(undefined, "screen"));
    const roomId = last(a.p).payload.roomId as string;
    const b = connect(rooms, screenOf("t1"));
    b.onText(join(roomId, "phone"));
    expect(last(b.p).payload.role).toBe("screen");
    expect(rooms.counts(roomId)).toEqual({ phones: 0, screens: 2 });
  });

  test("another therapist's screen cannot join or eavesdrop on the room", () => {
    const rooms = new Rooms();
    const owner = connect(rooms, screenOf("t1"));
    owner.onText(join(undefined, "screen"));
    const roomId = last(owner.p).payload.roomId as string;

    const intruder = connect(rooms, screenOf("t2"));
    intruder.onText(join(roomId, "screen"));
    expect(last(intruder.p)).toMatchObject({
      type: "error",
      payload: { code: "no-room" },
    });
    expect(rooms.counts(roomId).screens).toBe(1);
  });

  test("another therapist's patient phone cannot join, and gets the same answer as a missing room", () => {
    const rooms = new Rooms();
    const owner = connect(rooms, screenOf("t1"));
    owner.onText(join(undefined, "screen"));
    const roomId = last(owner.p).payload.roomId as string;

    const foreign = connect(rooms, phoneOf("t2", "p9"));
    foreign.onText(join(roomId));
    const missing = connect(rooms, phoneOf("t2", "p9"));
    missing.onText(join("0000"));
    expect(last(foreign.p).payload).toEqual(last(missing.p).payload);
    expect(rooms.counts(roomId).phones).toBe(0);
  });

  test("the room is bound to one patient: a second patient of the same therapist is refused", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;

    const first = connect(rooms, phoneOf("t1", "p1"));
    first.onText(join(roomId));
    expect(last(first.p).type).toBe("joined");

    const other = connect(rooms, phoneOf("t1", "p2"));
    other.onText(join(roomId));
    expect(last(other.p)).toMatchObject({ payload: { code: "no-room" } });
    expect(first.p.kicked).toBe("");

    // The same patient may reconnect and replaces the old socket.
    const again = connect(rooms, phoneOf("t1", "p1"));
    again.onText(join(roomId));
    expect(first.p.kicked).toBe("replaced");
  });

  test("a phone ticket without a patient cannot join", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;
    const ph = connect(rooms, { ...phoneOf("t1", "p1"), patientId: null });
    ph.onText(join(roomId));
    expect(last(ph.p).type).toBe("error");
  });

  test("a peer that never joined cannot inject into a room", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const before = sc.p.inbox.length;
    const rogue = connect(rooms, phoneOf("t1", "p1"));
    rogue.onText(
      JSON.stringify({ type: "breach", roomId: "", t: 0, payload: {} }),
    );
    expect(sc.p.inbox.length).toBe(before);
  });

  test("joined peers relay to the others", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;
    const ph = connect(rooms, phoneOf("t1", "p1"));
    ph.onText(join(roomId));
    const msg = JSON.stringify({ type: "state", roomId, t: 1, payload: {} });
    ph.onText(msg);
    expect(sc.p.inbox.at(-1)).toBe(msg);
  });

  test("failed joins in a row close the connection; a success resets the count", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;

    const ph = connect(rooms, phoneOf("t1", "p1"));
    for (let i = 0; i < MAX_JOIN_FAILURES - 1; i++) ph.onText(join("0000"));
    expect(ph.closed).toEqual([]);
    ph.onText(join(roomId)); // success resets
    for (let i = 0; i < MAX_JOIN_FAILURES - 1; i++) ph.onText(join("0000"));
    expect(ph.closed).toEqual([]);

    ph.onText(join("0000"));
    expect(ph.closed).toEqual([[CLOSE_TOO_MANY_ATTEMPTS, "too-many-attempts"]]);
    expect(codes(ph.p).at(-1)?.payload.code).toBe("too-many-attempts");
  });
});

describe("R1-S2: malformed ws messages", () => {
  const bad = [
    "null",
    "[]",
    "123",
    '"join"',
    "true",
    "not json",
    "",
    '{"type":"join"}',
    '{"type":"join","payload":null}',
    '{"type":"join","payload":[]}',
    '{"type":"join","payload":"x"}',
    '{"type":1,"payload":{}}',
    '{"type":"","payload":{}}',
    '{"payload":{}}',
    '{"type":"state","payload":5}',
    '{"type":"join","payload":{"role":"admin"}}',
    '{"type":"join","payload":{"role":["screen"]}}',
    '{"type":"join","payload":{"roomId":1234}}',
  ];

  test("parseClientMessage rejects every malformed shape", () => {
    for (const text of bad) expect(parseClientMessage(text)).toBeNull();
  });

  test("parseClientMessage accepts a well formed message", () => {
    const m = parseClientMessage(
      '{"type":"telemetry","roomId":"1234","t":1,"payload":{"points":[]}}',
    );
    expect(m?.type).toBe("telemetry");
    expect(parseClientMessage('{"type":"join","payload":{}}')).not.toBeNull();
  });

  test("the handler answers each with bad-message, never throws, relays nothing", () => {
    const rooms = new Rooms();
    const sc = connect(rooms, screenOf("t1"));
    sc.onText(join(undefined, "screen"));
    const roomId = last(sc.p).payload.roomId as string;
    const ph = connect(rooms, phoneOf("t1", "p1"));
    ph.onText(join(roomId));
    const seen = sc.p.inbox.length;

    for (const text of bad) {
      expect(() => ph.onText(text)).not.toThrow();
      expect(last(ph.p)).toMatchObject({
        type: "error",
        payload: { code: "bad-message" },
      });
    }
    expect(sc.p.inbox.length).toBe(seen);
    expect(rooms.counts(roomId)).toEqual({ phones: 1, screens: 1 });
  });

  test("a throwing room layer is caught and the connection stays usable", () => {
    const rooms = new Rooms();
    rooms.relay = () => {
      throw new Error("boom");
    };
    const c = connect(rooms, screenOf("t1"));
    expect(() =>
      c.onText('{"type":"state","roomId":"","t":0,"payload":{}}'),
    ).not.toThrow();
    expect(last(c.p).payload.code).toBe("bad-message");
  });
});

describe("R1-K2: ticket store is shared across module copies and the route path", () => {
  test("a second copy of tickets.ts sees tickets minted by the first", async () => {
    const copyPath = "../src/lib/relay/tickets.ts?copy=duplicate-bundle";
    const copy = (await import(
      copyPath
    )) as typeof import("../src/lib/relay/tickets");
    expect(copy.issueTicket).not.toBe(issueTicket); // really a different module instance
    const t = copy.issueTicket(screenOf("t1"));
    expect(consumeTicket(t)).toEqual(screenOf("t1"));
    expect(consumeTicket(t)).toBeNull();
  });

  test("a ticket minted by the route's module copy is consumed by the server copy", async () => {
    const copyPath = "../src/lib/relay/tickets.ts?copy=route-bundle";
    const copy = (await import(
      copyPath
    )) as typeof import("../src/lib/relay/tickets");
    const t = copy.issueTicket(screenOf("t1"));
    const allow = makeOriginCheck([], undefined);
    expect(
      authorizeUpgrade(
        {
          url: `/ws?ticket=${encodeURIComponent(t)}`,
          headers: { origin: "http://localhost:3000" },
        },
        allow,
      ),
    ).toEqual({ ok: true, claims: screenOf("t1") });
    // One shared store: the main copy sees it consumed too.
    expect(consumeTicket(t)).toBeNull();
  });

  test("a ticket from the route handler is consumed by the upgrade path, once", async () => {
    const res = await handleWsTicket({
      guard: guard(profile("THERAPIST", "t1")),
      linkedPatient: async () => null,
    });
    expect(res.status).toBe(201);
    const { ticket, role } = (await res.json()) as {
      ticket: string;
      role: string;
    };
    expect(role).toBe("screen");

    const allow = makeOriginCheck([], undefined);
    const req = {
      url: `/ws?ticket=${encodeURIComponent(ticket)}`,
      headers: { origin: "http://localhost:3000", host: "localhost:3000" },
    };
    const ok = authorizeUpgrade(req, allow);
    expect(ok).toEqual({ ok: true, claims: screenOf("t1") });
    expect(authorizeUpgrade(req, allow)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  test("the upgrade path refuses missing and bogus tickets, and bad origins first", () => {
    const allow = makeOriginCheck([], undefined);
    const headers = { origin: "http://localhost:3000" };
    expect(authorizeUpgrade({ url: "/ws", headers }, allow)).toMatchObject({
      status: 401,
    });
    expect(
      authorizeUpgrade({ url: "/ws?ticket=nope", headers }, allow),
    ).toMatchObject({ status: 401 });
    const t = issueTicket(screenOf("t1"));
    expect(
      authorizeUpgrade(
        { url: `/ws?ticket=${t}`, headers: { origin: "https://evil.example" } },
        allow,
      ),
    ).toMatchObject({ status: 403 });
  });
});

function profile(
  role: Profile["role"],
  id: string,
  therapistId: string | null = null,
) {
  return { id, role, displayName: id, therapistId } as Profile;
}
function guard(p: Profile | null): GuardDeps {
  return {
    getUser: async () => (p ? { id: p.id } : null),
    findProfile: async () => p,
  };
}
async function mint(p: Profile | null, linked: LinkedPatient | null = null) {
  const res = await handleWsTicket({
    guard: guard(p),
    linkedPatient: async () => linked,
  });
  return {
    status: res.status,
    body: (await res.json()) as { ticket?: string },
  };
}

describe("ticket route binds identity from the database profile", () => {
  test("therapist -> screen owned by herself", async () => {
    const { body } = await mint(profile("THERAPIST", "t1"));
    expect(consumeTicket(body.ticket ?? "")).toEqual(screenOf("t1"));
  });

  test("patient -> phone bound to the patient and the patient's therapist", async () => {
    const { body } = await mint(profile("PATIENT", "p1", "t1"));
    expect(consumeTicket(body.ticket ?? "")).toEqual(phoneOf("t1", "p1"));
  });

  test("caregiver -> phone bound to the linked patient", async () => {
    const { body } = await mint(profile("CAREGIVER", "c1"), {
      id: "p1",
      therapistId: "t1",
    });
    expect(consumeTicket(body.ticket ?? "")).toEqual({
      userId: "c1",
      role: "phone",
      therapistId: "t1",
      patientId: "p1",
    });
  });

  test("caregiver without an active link, or a patient without a therapist, gets 403", async () => {
    expect((await mint(profile("CAREGIVER", "c1"))).status).toBe(403);
    expect(
      (await mint(profile("CAREGIVER", "c1"), { id: "p1", therapistId: null }))
        .status,
    ).toBe(403);
    expect((await mint(profile("PATIENT", "p1", null))).status).toBe(403);
    expect(ticketCount()).toBe(0);
  });

  test("no session gives 401 and mints nothing", async () => {
    expect((await mint(null)).status).toBe(401);
    expect(ticketCount()).toBe(0);
  });
});

describe("R1-S5: ticket rate limit and sweeping", () => {
  test("per user: over the limit gives 429, another user is unaffected", async () => {
    const p = profile("PATIENT", "p1", "t1");
    for (let i = 0; i < WS_TICKETS_PER_HOUR; i++)
      expect((await mint(p)).status).toBe(201);
    expect((await mint(p)).status).toBe(429);
    expect((await mint(profile("PATIENT", "p2", "t1"))).status).toBe(201);
    expect(ticketCount()).toBe(WS_TICKETS_PER_HOUR + 1);
  });

  test("sweepTickets drops expired tickets and keeps live ones", () => {
    issueTicket(screenOf("t1"), 1_000);
    issueTicket(screenOf("t1"), 1_000);
    const live = issueTicket(screenOf("t1"), 50_000);
    // sweepTickets also runs inside issueTicket, so look at the store after a quiet period.
    expect(sweepTickets(1_000 + TICKET_TTL_MS + 1)).toBe(2);
    expect(ticketCount()).toBe(1);
    expect(consumeTicket(live, 50_000)).not.toBeNull();
  });

  test("the periodic sweeper clears expired tickets without any new mint", async () => {
    issueTicket(screenOf("t1"), 1_000); // expired long ago relative to Date.now()
    expect(ticketCount()).toBe(1);
    const stop = startTicketSweeper(5);
    await Bun.sleep(40);
    stop();
    expect(ticketCount()).toBe(0);
  });
});

describe("R1-K1: Origin allowlist", () => {
  const lan = ["192.168.1.20"];

  test("dev default: localhost, loopback, LAN IP on any port or scheme", () => {
    const ok = makeOriginCheck(lan, undefined);
    for (const o of [
      "http://localhost:3000",
      "https://localhost:3443",
      "http://127.0.0.1:3000",
      "https://192.168.1.20:3443",
    ])
      expect(ok(o, undefined)).toBe(true);
  });

  test("refuses missing, unparsable, and foreign origins", () => {
    const ok = makeOriginCheck(lan, undefined);
    expect(ok(undefined, "localhost")).toBe(false);
    expect(ok("null", "localhost")).toBe(false);
    expect(ok("not a url", "localhost")).toBe(false);
    expect(ok("https://evil.example", "localhost")).toBe(false);
    expect(ok("http://localhost.evil.example", "localhost")).toBe(false);
  });

  test("a trycloudflare tunnel is accepted only when it is the host that was reached", () => {
    const ok = makeOriginCheck(lan, undefined);
    const origin = "https://quiet-river-1234.trycloudflare.com";
    expect(ok(origin, "quiet-river-1234.trycloudflare.com")).toBe(true);
    expect(ok(origin, "localhost:3000")).toBe(false);
    expect(ok(origin, undefined)).toBe(false);
    expect(
      ok(
        "https://evil.trycloudflare.com",
        "quiet-river-1234.trycloudflare.com",
      ),
    ).toBe(false);
    expect(ok("https://trycloudflare.com", "trycloudflare.com")).toBe(false);
  });

  test("ALLOWED_ORIGINS adds production hosts, as bare hosts or origin URLs", () => {
    expect(
      parseAllowedOrigins(
        " rehat.example.com, https://app.rehat.id:8443 ,,:::",
      ),
    ).toEqual(["rehat.example.com", "app.rehat.id"]);
    const ok = makeOriginCheck(lan, "rehat.example.com,https://app.rehat.id");
    expect(ok("https://rehat.example.com", "rehat.example.com")).toBe(true);
    expect(ok("https://app.rehat.id", undefined)).toBe(true);
    expect(ok("https://other.example.com", undefined)).toBe(false);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});
