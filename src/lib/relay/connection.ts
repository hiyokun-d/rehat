// What the relay does with one authenticated ws connection, kept free of `ws` so it can be
// tested without a socket. server.mts wires it to a real WebSocket.
// Imports use .ts extensions because Node type-stripping loads this file directly.
import { makeMsg, parseClientMessage } from "./protocol.ts";
import type { Peer, Rooms } from "./rooms.ts";
import type { TicketClaims } from "./tickets.ts";

/** Failed joins in a row before the connection is closed (R1-S1: limits room-code guessing). */
export const MAX_JOIN_FAILURES = 5;
export const CLOSE_TOO_MANY_ATTEMPTS = 4008;

const error = (code: string, message: string) =>
  JSON.stringify(makeMsg("error", "", { code, message }));

/**
 * Returns the handler for raw text frames of one connection. The role and identity come from
 * the ticket `claims`; whatever `role` the client puts in its join message is ignored. A frame
 * of any shape, however broken, is answered with an error instead of throwing.
 *
 * shortcut: the failure counter is per connection, so a client can reconnect to reset it. Each
 * reconnect needs a fresh ticket, and POST /api/ws-ticket is rate limited per user. Add a
 * per-user counter if that proves too loose.
 */
export function createMessageHandler(
  rooms: Rooms,
  peer: Peer,
  claims: TicketClaims,
  close: (code: number, reason: string) => void,
): (text: string) => void {
  let joinFailures = 0;

  const handle = (text: string) => {
    const msg = parseClientMessage(text);
    if (!msg) return peer.send(error("bad-message", "Pesan tidak valid"));

    if (msg.type === "join") {
      const { roomId } = msg.payload as { roomId?: string };
      const res = rooms.join(peer, claims.role, claims, roomId);
      if (res.ok) {
        joinFailures = 0;
        return peer.send(
          JSON.stringify(
            makeMsg("joined", res.roomId, {
              role: claims.role,
              roomId: res.roomId,
            }),
          ),
        );
      }
      peer.send(error(res.code, res.message));
      joinFailures += 1;
      if (joinFailures >= MAX_JOIN_FAILURES) {
        peer.send(error("too-many-attempts", "Terlalu banyak percobaan."));
        close(CLOSE_TOO_MANY_ATTEMPTS, "too-many-attempts");
      }
      return;
    }
    rooms.relay(peer, text);
  };

  return (text) => {
    try {
      handle(text);
    } catch {
      // Last line of defence: one bad frame must never take the shared process down.
      peer.send(error("bad-message", "Pesan tidak valid"));
    }
  };
}
