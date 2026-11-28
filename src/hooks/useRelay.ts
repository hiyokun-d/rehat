"use client";
// WebSocket client for the relay: join a room, reconnect with backoff, expose send().
// Reconnect matters on phones: switching apps or a Wi-Fi hiccup kills the socket silently.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { relayUrl } from "@/lib/api/wsTicket";
import {
  type Msg,
  makeMsg,
  type Role,
  type ServerMsg,
} from "@/lib/relay/protocol";

export type RelayState = "off" | "connecting" | "open" | "closed" | "error";

export interface RelayOptions {
  role: Role;
  /** Room to join. Screens may pass null to get a new code. */
  roomId: string | null;
  enabled: boolean;
  onMessage: (m: Msg) => void;
  /**
   * Optional one-time ticket per connect (server.mts S1). Resolve a string to connect with it,
   * null to give up (not allowed: no retry), or throw for a temporary failure (retry with backoff).
   * Omit to connect without a ticket.
   */
  getTicket?: () => Promise<string | null>;
}

export function useRelay({
  role,
  roomId,
  enabled,
  onMessage,
  getTicket,
}: RelayOptions) {
  const [state, setState] = useState<RelayState>("off");
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [peers, setPeers] = useState({ phones: 0, screens: 0 });
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(null);

  const handle = useEffectEvent((m: Msg) => {
    const s = m as ServerMsg;
    if (s.type === "joined") {
      roomRef.current = s.payload.roomId;
      setJoinedRoom(s.payload.roomId);
      setError(null);
      setState("open");
    } else if (s.type === "peers") {
      setPeers(s.payload);
    } else if (s.type === "error") {
      setError(s.payload.message);
    }
    onMessage(m);
  });

  // undefined = this caller uses no tickets.
  const ticketFor = useEffectEvent(
    async (): Promise<string | null | undefined> =>
      getTicket ? await getTicket() : undefined,
  );

  useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }
    roomRef.current = roomId;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const later = () => {
      setState("closed");
      // Backoff 0.5 s, 1 s, 2 s ... capped at 5 s (tuned by feel, not critical).
      timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };

    const connect = async () => {
      setState("connecting");
      let ticket: string | null | undefined;
      try {
        ticket = await ticketFor();
      } catch {
        if (!stopped) later();
        return;
      }
      if (stopped) return;
      if (ticket === null) {
        // Not allowed to use the relay (e.g. signed out): the phone keeps working on its own.
        setError("Masuk dulu untuk tersambung ke layar terapis.");
        return setState("error");
      }
      const ws = new WebSocket(
        relayUrl(location.protocol, location.host, ticket),
      );
      wsRef.current = ws;
      let fatal = false;
      ws.onopen = () => {
        retry = 0;
        ws.send(
          JSON.stringify(
            makeMsg("join", roomRef.current ?? "", {
              role,
              roomId: roomRef.current ?? undefined,
            }),
          ),
        );
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data) as Msg;
        // No room / replaced by another phone: retrying would not help (or would fight).
        if (
          m.type === "error" &&
          ["no-room", "replaced"].includes(
            (m as ServerMsg & { type: "error" }).payload.code,
          )
        ) {
          fatal = true;
        }
        handle(m);
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (stopped) return;
        if (fatal) return setState("error");
        later();
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, role, roomId]);

  const send = useCallback(<P>(type: string, payload: P) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(makeMsg(type, roomRef.current ?? "", payload)));
  }, []);

  return { state, roomId: joinedRoom, peers, error, send };
}
