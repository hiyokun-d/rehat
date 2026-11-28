"use client";
// One patient's live room on Supabase Realtime (see src/lib/live/protocol.ts for the why).
// Same return shape idea as useRelay (state, send, error) plus the list of members, so pages can
// switch transport without changing their logic.
//
// Reconnects: supabase-js rejoins a channel by itself after a network drop. We still surface the
// state so the UI can show "not monitored" (AGENTS.md: not monitored = not safe).
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  LIVE_EVENT,
  type LiveMsg,
  type LivePeer,
  parseLiveMsg,
  patientTopic,
} from "@/lib/live/protocol";
import { createClient } from "@/lib/supabase/client";

export type LiveState = "off" | "connecting" | "open" | "error";

export interface LiveOptions {
  patientId: string | null;
  enabled: boolean;
  me: LivePeer | null;
  onMessage: (m: LiveMsg) => void;
  /** Other private topic, e.g. "staff:<id>" (receive-only, no presence). Default patient:<id>. */
  topic?: string;
}

export function useLiveChannel({
  patientId,
  enabled,
  me,
  onMessage,
  topic: topicOverride,
}: LiveOptions) {
  const topic = topicOverride ?? (patientId ? patientTopic(patientId) : null);
  // Presence needs INSERT rights; staff:* is receive-only, so only track in patient rooms.
  const withPresence = !topicOverride;
  const [state, setState] = useState<LiveState>("off");
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chRef = useRef<RealtimeChannel | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  const handle = useEffectEvent((raw: unknown) => {
    const m = parseLiveMsg(raw);
    if (m) onMessage(m);
  });

  const deviceId = me?.deviceId ?? null;
  useEffect(() => {
    if (!enabled || !topic || !deviceId) {
      setState("off");
      setPeers([]);
      return;
    }
    let stopped = false;
    const supabase = createClient();
    setState("connecting");
    setError(null);

    const ch = supabase.channel(topic, {
      config: {
        private: true, // RLS on realtime.messages decides who may join
        broadcast: { self: false, ack: false },
        presence: { key: deviceId },
      },
    });
    chRef.current = ch;

    ch.on("broadcast", { event: LIVE_EVENT }, ({ payload }) =>
      handle(payload),
    ).on("presence", { event: "sync" }, () => {
      const st = ch.presenceState<LivePeer>();
      // One entry per device; a device that reconnected may briefly appear twice.
      const list = Object.values(st)
        .map((metas) => metas[metas.length - 1])
        .filter(Boolean) as unknown as LivePeer[];
      setPeers(list.filter((p) => p.deviceId !== deviceId));
    });

    (async () => {
      // Private channels need the user's JWT on the realtime socket.
      await supabase.realtime.setAuth().catch(() => {});
      if (stopped) return;
      ch.subscribe(async (status, err) => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          setState("open");
          setError(null);
          if (withPresence && meRef.current)
            await ch.track(meRef.current).catch(() => {});
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("error");
          setError(
            err?.message?.includes("Unauthorized")
              ? "Tidak punya akses ke ruang pasien ini."
              : "Koneksi live terputus. Mencoba lagi...",
          );
        } else if (status === "CLOSED") {
          setState("connecting");
        }
      });
    })();

    return () => {
      stopped = true;
      chRef.current = null;
      supabase.removeChannel(ch).catch(() => {});
    };
  }, [enabled, topic, deviceId, withPresence]);

  // Placement or label changed: update presence without rejoining. `me` is a new object on
  // every render of some callers, so compare by value.
  const meKey = JSON.stringify(me);
  const lastTracked = useRef<string | null>(null);
  useEffect(() => {
    if (!withPresence || state !== "open" || !chRef.current || !meRef.current) {
      lastTracked.current = null;
      return;
    }
    if (lastTracked.current === meKey) return;
    lastTracked.current = meKey;
    chRef.current.track(meRef.current).catch(() => {});
  }, [state, meKey, withPresence]);

  const send = useCallback(<P>(type: string, payload: P) => {
    const ch = chRef.current;
    const from = meRef.current?.deviceId;
    if (!ch || !from) return;
    const msg: LiveMsg<P> = { type, from, t: Date.now(), payload };
    ch.send({ type: "broadcast", event: LIVE_EVENT, payload: msg }).catch(
      () => {},
    );
  }, []);

  return { state, peers, error, send };
}
