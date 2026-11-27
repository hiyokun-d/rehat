import type { BreachEvent } from "./envelope";

export const CUES: Record<BreachEvent["kind"], string> = {
  angle: "Pelan-pelan, turunkan tangan.",
  velocity: "Pelan-pelan, gerakkan lebih lambat.",
};
