import { describe, expect, test } from "bun:test";
import { type Peer, Rooms } from "../src/lib/relay/rooms";

function peer() {
  const p = { inbox: [] as string[], kicked: "" } as Peer & {
    inbox: string[];
    kicked: string;
  };
  p.send = (t) => p.inbox.push(t);
  p.kick = (r) => {
    p.kicked = r;
  };
  return p;
}

describe("rooms", () => {
  test("phone cannot join a room that does not exist", () => {
    const r = new Rooms();
    expect(r.join(peer(), "phone", "1234").ok).toBe(false);
  });
  test("screen creates, phone joins, messages relay to others only", () => {
    const r = new Rooms();
    const sc = peer();
    const ph = peer();
    const res = r.join(sc, "screen");
    if (!res.ok) throw new Error();
    expect(res.roomId).toMatch(/^\d{4}$/);
    expect(r.join(ph, "phone", res.roomId).ok).toBe(true);
    sc.inbox.length = 0;
    ph.inbox.length = 0;
    r.relay(ph, "hi");
    expect(sc.inbox).toEqual(["hi"]);
    expect(ph.inbox).toEqual([]);
  });
  test("a second phone replaces the first", () => {
    const r = new Rooms();
    const sc = peer();
    const a = peer();
    const b = peer();
    const res = r.join(sc, "screen");
    if (!res.ok) throw new Error();
    r.join(a, "phone", res.roomId);
    r.join(b, "phone", res.roomId);
    expect(a.kicked).toBe("replaced");
    expect(r.counts(res.roomId)).toEqual({ phones: 1, screens: 1 });
  });
  test("rooms are isolated", () => {
    const r = new Rooms();
    const s1 = peer();
    const s2 = peer();
    r.join(s1, "screen", "1111");
    r.join(s2, "screen", "2222");
    s2.inbox.length = 0;
    r.relay(s1, "x");
    expect(s2.inbox).toEqual([]);
  });
});
