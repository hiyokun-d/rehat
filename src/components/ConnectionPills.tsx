// The status row both pages show: relay link, and the sensor/session as reported by the phone.
import { Smartphone, Unplug, Wifi, WifiOff } from "lucide-react";
import type { RelayState } from "@/hooks/useRelay";
import type { Phase } from "@/lib/rehab/session";
import type { SensorStatus } from "@/lib/sensor/types";
import { StatusPill, type StatusTone } from "./ui/StatusPill";

const relayPill: Record<RelayState, [StatusTone, string]> = {
  off: ["idle", "Tidak terhubung"],
  connecting: ["busy", "Menghubungkan"],
  open: ["ok", "Terhubung"],
  closed: ["warn", "Menyambung ulang"],
  error: ["danger", "Gagal terhubung"],
};

export function RelayPill({ state }: { state: RelayState }) {
  const [tone, label] = relayPill[state];
  return (
    <StatusPill
      tone={tone}
      label={label}
      icon={
        state === "open"
          ? Wifi
          : state === "off" || state === "error"
            ? WifiOff
            : undefined
      }
    />
  );
}

export function SensorPill({
  status,
}: {
  status: SensorStatus | "off" | "stale";
}) {
  if (status === "ok")
    return <StatusPill tone="ok" label="Sensor aktif" icon={Smartphone} />;
  if (status === "lost")
    return <StatusPill tone="danger" label="Sensor terputus" icon={Unplug} />;
  if (status === "stale")
    return (
      <StatusPill tone="danger" label="Data dari HP terhenti" icon={Unplug} />
    );
  return <StatusPill tone="idle" label="Sensor mati" icon={Smartphone} />;
}

const phasePill: Record<Phase, [StatusTone, string]> = {
  idle: ["idle", "Belum mulai"],
  calibrating: ["busy", "Kalibrasi"],
  running: ["ok", "Latihan berjalan"],
  paused: ["danger", "Dijeda"],
};

export function PhasePill({ phase }: { phase: Phase }) {
  const [tone, label] = phasePill[phase];
  return <StatusPill tone={tone} label={label} />;
}
