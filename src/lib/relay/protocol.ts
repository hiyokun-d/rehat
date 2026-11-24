// Every message on the wire has the same shape: { type, roomId, t, payload }.
// `t` is the sender's clock (ms) — only useful for ordering/latency within one device.

export type Role = "phone" | "screen";

export interface Msg<T extends string = string, P = unknown> {
  type: T;
  roomId: string;
  t: number;
  payload: P;
}

/** Client -> server. The only message the server itself interprets. */
export type JoinMsg = Msg<"join", { role: Role; roomId?: string }>;

/** Server -> client. */
export type ServerMsg =
  | Msg<"joined", { role: Role; roomId: string }>
  | Msg<"peers", { phones: number; screens: number }>
  | Msg<
      "error",
      { code: "no-room" | "bad-message" | "replaced"; message: string }
    >;

export const ROOM_CODE = /^\d{4}$/;

export function makeMsg<T extends string, P>(
  type: T,
  roomId: string,
  payload: P,
): Msg<T, P> {
  return { type, roomId, t: Date.now(), payload };
}
