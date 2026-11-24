import { Hand, Hourglass, Pause, Scan } from "lucide-react";
import type { GState } from "@/lib/gesture/segmenter";
import { StatusPill, type StatusTone } from "../ui/StatusPill";

const MAP: Record<GState, [StatusTone, string, typeof Hand]> = {
  rest: ["idle", "Menunggu gerakan", Hand],
  signing: ["busy", "Mulai: merekam gerakan", Scan],
  ended: ["ok", "Berhenti: mengenali", Hourglass],
  cooldown: ["idle", "Jeda singkat", Pause],
};

export function GestureStatePill({ state }: { state: GState }) {
  const [tone, label, icon] = MAP[state];
  return <StatusPill tone={tone} label={label} icon={icon} />;
}
