"use client";
// The patient's phone in its own live room (patient:<userId>) on Supabase Realtime.
// Only when signed in as a PATIENT; signed out, the phone works exactly as before (local, or the
// LAN relay with a room code).
//
// What goes out: hello, state (max 2/s), breach. NOT telemetry (10 msg/s of raw samples would
// burn the realtime quota and the dashboard does not need it), NOT sessions (they go to
// /api/sync, which is audited and idempotent), NOT recordings (raw data stays on the phone).
// What comes in: "pause" (from the nurse; can only make things safer), "refresh-bundle"
// (re-pull the therapist's versioned limits from the server) and "nurse-msg" (a short text the
// nurse sent through POST /api/patients/:id/message; only the server can send it, from="server").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveChannel } from "@/hooks/useLiveChannel";
import type { DeviceIdentity } from "@/lib/device";
import type { Placement } from "@/lib/live/placement";
import { CLOUD_RATES, type LivePeer } from "@/lib/live/protocol";

export interface NurseMessage {
  text: string;
  from: string;
  at: string;
}

const FORWARD = new Set(["hello", "state", "breach"]);

export function usePatientLive({
  userId,
  device,
  placement,
  onPause,
  onRefreshBundle,
}: {
  userId: string | null;
  device: DeviceIdentity | null;
  placement: Placement | null;
  onPause: () => void;
  onRefreshBundle: () => void;
}) {
  const [isPatient, setIsPatient] = useState<boolean | null>(null);
  const [message, setMessage] = useState<NurseMessage | null>(null);
  const handlers = useRef({ onPause, onRefreshBundle });
  handlers.current = { onPause, onRefreshBundle };

  // The role decides whose room this is. Only a PATIENT login owns patient:<its own id>.
  useEffect(() => {
    setIsPatient(null);
    if (!userId) return;
    let stale = false;
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => !stale && setIsPatient(me?.role === "PATIENT"))
      .catch(() => !stale && setIsPatient(false));
    return () => {
      stale = true;
    };
  }, [userId]);

  const me: LivePeer | null = useMemo(
    () =>
      device
        ? {
            deviceId: device.id,
            role: "phone",
            label: device.label,
            account: "PATIENT",
            ...(placement ? { placement } : {}),
          }
        : null,
    [device, placement],
  );

  const live = useLiveChannel({
    patientId: userId,
    enabled: !!userId && isPatient === true && !!me,
    me,
    onMessage: (m) => {
      const to = (m.payload as { to?: string }).to;
      if (m.type === "pause" && (!to || to === device?.id))
        handlers.current.onPause();
      if (m.type === "refresh-bundle") handlers.current.onRefreshBundle();
      // Nurse messages come through the server (audited, ownership-checked). Honest limit:
      // broadcast `from` is self-declared, so another member of THIS patient's room (their own
      // phones, linked caregiver) could fake one. Outsiders cannot (RLS). The text is display
      // only and can never change limits or start an exercise.
      if (m.type === "nurse-msg" && m.from === "server") {
        const p = m.payload as Partial<NurseMessage>;
        if (typeof p.text === "string" && p.text.length <= 200)
          setMessage({
            text: p.text,
            from: typeof p.from === "string" ? p.from.slice(0, 80) : "Perawat",
            at: typeof p.at === "string" ? p.at : new Date().toISOString(),
          });
      }
    },
  });

  const lastState = useRef(0);
  const { send: liveSend } = live;
  const send = useCallback(
    <P>(type: string, payload: P) => {
      if (!FORWARD.has(type)) return;
      if (type === "state") {
        const now = performance.now();
        if (now - lastState.current < CLOUD_RATES.stateEveryMs) return;
        lastState.current = now;
      }
      liveSend(type, payload);
    },
    [liveSend],
  );

  return {
    state: live.state,
    screens: live.peers.filter((p) => p.role === "screen").length,
    error: live.error,
    send,
    isPatient,
    message,
    clearMessage: useCallback(() => setMessage(null), []),
  };
}
