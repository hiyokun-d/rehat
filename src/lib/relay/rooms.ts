// Room bookkeeping for the relay, kept free of `ws` so it can be unit-tested.
// Rules: one room = at most one phone + any number of screens.
// A screen may (re)create a room with a known code (so a laptop reload keeps its code);
// a phone may only join an existing room. A newer phone replaces the older one, which
// is what you want when the phone's socket reconnects before the old one has timed out.
import { makeMsg, ROOM_CODE, type Role } from "./protocol.ts";

export interface Peer {
  send(text: string): void;
  kick(reason: string): void;
}

interface Room {
  phone: Peer | null;
  screens: Set<Peer>;
}

export type JoinResult =
  | { ok: true; roomId: string }
  | { ok: false; code: "no-room"; message: string };

export class Rooms {
  private rooms = new Map<string, Room>();
  private where = new Map<Peer, { roomId: string; role: Role }>();

  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  join(peer: Peer, role: Role, requested?: string): JoinResult {
    this.leave(peer);
    let roomId = requested && ROOM_CODE.test(requested) ? requested : undefined;

    if (role === "phone") {
      const room = roomId ? this.rooms.get(roomId) : undefined;
      if (!room || !roomId) {
        return {
          ok: false,
          code: "no-room",
          message: "Kode ruang tidak ditemukan. Cek kode di layar laptop.",
        };
      }
      if (room.phone && room.phone !== peer) {
        const old = room.phone;
        this.where.delete(old);
        old.kick("replaced");
      }
      room.phone = peer;
    } else {
      roomId ??= this.newCode();
      let room = this.rooms.get(roomId);
      if (!room) {
        room = { phone: null, screens: new Set() };
        this.rooms.set(roomId, room);
      }
      room.screens.add(peer);
    }

    this.where.set(peer, { roomId, role });
    this.broadcastPeers(roomId);
    return { ok: true, roomId };
  }

  leave(peer: Peer): void {
    const at = this.where.get(peer);
    if (!at) return;
    this.where.delete(peer);
    const room = this.rooms.get(at.roomId);
    if (!room) return;
    if (room.phone === peer) room.phone = null;
    room.screens.delete(peer);
    if (!room.phone && room.screens.size === 0) this.rooms.delete(at.roomId);
    else this.broadcastPeers(at.roomId);
  }

  /** Forward a message to everyone else in the sender's room. */
  relay(from: Peer, text: string): void {
    const at = this.where.get(from);
    if (!at) return;
    for (const p of this.members(at.roomId)) if (p !== from) p.send(text);
  }

  roomOf(peer: Peer): string | undefined {
    return this.where.get(peer)?.roomId;
  }

  counts(roomId: string): { phones: number; screens: number } {
    const room = this.rooms.get(roomId);
    return { phones: room?.phone ? 1 : 0, screens: room?.screens.size ?? 0 };
  }

  private members(roomId: string): Peer[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.phone ? [room.phone, ...room.screens] : [...room.screens];
  }

  private broadcastPeers(roomId: string): void {
    const text = JSON.stringify(makeMsg("peers", roomId, this.counts(roomId)));
    for (const p of this.members(roomId)) p.send(text);
  }

  private newCode(): string {
    for (;;) {
      const code = String(Math.floor(this.random() * 10000)).padStart(4, "0");
      if (!this.rooms.has(code)) return code;
    }
  }
}
