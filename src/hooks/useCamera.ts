"use client";
// Front camera at ~480p. Errors are mapped to messages a user can act on.
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraError = "denied" | "busy" | "unsupported" | "other";

/** `width`/`height` are ideals: the browser picks the closest the camera supports. */
export function useCamera({ width = 640, height = 480 } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"off" | "starting" | "on">("off");
  const [error, setError] = useState<CameraError | null>(null);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setError("unsupported");
    setState("starting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: width },
          height: { ideal: height },
        },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
      }
      setState("on");
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "denied"
          : name === "NotReadableError"
            ? "busy"
            : "other",
      );
      setState("off");
    }
  }, [width, height]);

  const stop = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    setState("off");
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, state, error, start, stop };
}
