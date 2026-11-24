"use client";
// Runs MediaPipe Hand Landmarker on a <video>, once per new video frame, inside
// requestAnimationFrame (official web guide pattern). Assets are served from /mediapipe
// (scripts/mediapipe-assets.sh), never from a CDN.
import type { FaceLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { faceFeatures } from "@/lib/gesture/face";
import type { Landmark } from "@/lib/gesture/features";

export interface HandFrame {
  t: number;
  landmarks: Landmark[] | null; // image coordinates 0..1 of the first hand
  handedness: string;
  /** Every detected hand (up to numHands), for the laptop-camera setup. */
  hands: { landmarks: Landmark[]; handedness: string }[];
  /** Face features (face.ts) when face tracking is on and a face is visible. */
  face: number[] | null;
  /** Raw face landmarks, for drawing. */
  faceLandmarks: Landmark[] | null;
}

export function useHandTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFrame: (f: HandFrame) => void,
  /** Also run Face Landmarker (every 2nd frame, to protect FPS). */
  withFace = false,
) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);
  const [fps, setFps] = useState(0);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const emit = useEffectEvent(onFrame);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    let frameNo = 0;
    let lastFace: { features: number[] | null; landmarks: Landmark[] | null } =
      {
        features: null,
        landmarks: null,
      };
    const frameTimes: number[] = [];

    (async () => {
      setStatus("loading");
      try {
        const { FaceLandmarker, FilesetResolver, HandLandmarker } =
          await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const create = (d: "GPU" | "CPU") =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/hand_landmarker.task",
              delegate: d,
            },
            runningMode: "VIDEO",
            numHands: 2,
          });
        let lm: HandLandmarker;
        let used: "GPU" | "CPU" = "GPU";
        try {
          lm = await create("GPU");
        } catch {
          used = "CPU";
          lm = await create("CPU"); // some phones have no usable WebGL2
        }
        setDelegate(used);
        if (cancelled) return lm.close();
        landmarkerRef.current = lm;
        if (withFace) {
          const face = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: used, // same delegate that worked for hands
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
          }).catch(() => null); // face is optional: hands still work without it
          if (cancelled) return face?.close();
          faceRef.current = face;
        }
        setStatus("ready");
      } catch {
        setStatus("error");
        return;
      }

      const loop = () => {
        raf = requestAnimationFrame(loop);
        const v = videoRef.current;
        const lm = landmarkerRef.current;
        if (!v || !lm || v.readyState < 2 || v.currentTime === lastVideoTime)
          return;
        lastVideoTime = v.currentTime;
        const now = performance.now();
        const res = lm.detectForVideo(v, now);
        // Face every 2nd frame: expressions change slower than fingers; hold the last result.
        frameNo++;
        if (faceRef.current && frameNo % 2 === 0) {
          const fr = faceRef.current.detectForVideo(v, now);
          lastFace = {
            features: faceFeatures(
              fr.faceBlendshapes[0]?.categories,
              fr.faceLandmarks[0],
            ),
            landmarks: fr.faceLandmarks[0] ?? null,
          };
        }
        frameTimes.push(now);
        while (frameTimes.length && now - frameTimes[0] > 1000)
          frameTimes.shift();
        setFps(frameTimes.length);
        emit({
          t: now,
          landmarks: res.landmarks[0] ?? null,
          handedness: res.handedness[0]?.[0]?.categoryName ?? "Right",
          hands: res.landmarks.map((lm, i) => ({
            landmarks: lm,
            handedness: res.handedness[i]?.[0]?.categoryName ?? "Right",
          })),
          face: lastFace.features,
          faceLandmarks: lastFace.landmarks,
        });
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      faceRef.current?.close();
      faceRef.current = null;
      setStatus("idle");
    };
  }, [enabled, videoRef, withFace]);

  return { status, delegate, fps };
}
