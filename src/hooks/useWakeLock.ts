"use client";
// Keep the screen on while `active`. If the screen locks, the browser stops sending motion
// events, which would (correctly) pause the session — but that should not happen by accident.
import { useEffect, useState } from "react";

export function useWakeLock(active: boolean): "on" | "off" | "unsupported" {
  const [state, setState] = useState<"on" | "off" | "unsupported">("off");

  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) {
      setState("unsupported");
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) return lock.release();
        setState("on");
        lock.addEventListener("release", () => setState("off"));
      } catch {
        setState("off");
      }
    };
    // The browser drops the lock when the tab is hidden; take it again when we come back.
    const onVisible = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release();
    };
  }, [active]);

  return active ? state : "off";
}
