// Room bookkeeping for the relay, kept free of `ws` so it can be unit-tested.
// Rules: one room = at most one phone + any number of screens.
// A screen may (re)create a room with a known code (so a laptop reload keeps its code);
// a phone may only join an existing room. A newer phone replaces the older one, which
// is what you want when the phone's socket reconnects before the old one has timed out.
//
// Ownership (R1-S1), the simplest rule that holds with clients that send no patient id when they
// ask for a ticket: a room belongs to the therapist whose screen created it, and to ONE patient,
// bound by the first phone that joins. Afterwards only that patient's phone may join. A screen or
// phone from another therapist, or a phone of another patient, gets the same "no-room" answer as
// for a code that does not exist, so a guessed code reveals nothing. Who the therapist and
// patient are comes from the ticket (checked against the database when it was minted), never from
// the join message.
import { makeMsg, ROOM_CODE, type Role } from "./protocol.ts";

export interface Peer {
  send(text: string): void;
  kick(reason: string): void;
}

/** Identity taken from a validated ticket. `patientId` is null for a therapist's screen. */
export interface Owner {
  therapistId: string;
  patientId: string | null;
}

interface Room {
  therapistId: string;
  /** Bound by the first phone to join; null until then. */
  patientId: string | null;
  phone: Peer | null;
  screens: Set<Peer>;
}

export type JoinResult =
  | { ok: true; roomId: string }
  | { ok: false; code: "no-room"; message: string };

const NO_ROOM: JoinResult = {
  ok: false,
  code: "no-room",
  message: "Kode ruang tidak ditemukan. Cek kode di layar laptop.",
};

export class Rooms {
  private rooms = new Map<string, Room>();
  private where = new Map<Peer, { roomId: string; role: Role }>();

  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  join(peer: Peer, role: Role, who: Owner, requested?: string): JoinResult {
    this.leave(peer);
    let roomId = requested && ROOM_CODE.test(requested) ? requested : undefined;
    const existing = roomId ? this.rooms.get(roomId) : undefined;
    // Someone else's room is indistinguishable from a missing one.
    const foreign = existing && existing.therapistId !== who.therapistId;

    if (role === "phone") {
      const room = foreign ? undefined : existing;
      const wrongPatient =
        !who.patientId ||
        (room?.patientId != null && room.patientId !== who.patientId);
      if (!room || !roomId || wrongPatient) {
        return NO_ROOM;
      }
      room.patientId = who.patientId;
      if (room.phone && room.phone !== peer) {
        const old = room.phone;
        this.where.delete(old);
        old.kick("replaced");
      }
      room.phone = peer;
    } else {
      if (foreign) {
        return NO_ROOM;
      }
      roomId ??= this.newCode();
      let room = this.rooms.get(roomId);
      if (!room) {
        room = {
          therapistId: who.therapistId,
          patientId: null,
          phone: null,
          screens: new Set(),
        };
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
