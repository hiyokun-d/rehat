import type { Sample } from "./types";

/** File format for Record / Replay. Raw samples only, no derived values. */
export interface Recording {
  version: 1;
  createdAt: string;
  device: string; // user agent, so axis/sign differences can be traced to a phone
  note?: string;
  samples: Sample[];
}

export function isRecording(x: unknown): x is Recording {
  const r = x as Recording;
  return r?.version === 1 && Array.isArray(r.samples);
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
