"use client";
// One patient on the dashboard. Owns the patient's live channel (patient:<id>) so every tab can
// use it: Live shows the phones, Program tells phones to re-pull limits after a save.
import {
  ArrowLeft,
  BellRing,
  History,
  LineChart,
  MessageCircle,
  NotebookPen,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RelayPill } from "@/components/ConnectionPills";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useLiveChannel } from "@/hooks/useLiveChannel";
import type { LiveMsg, LivePeer } from "@/lib/live/protocol";
import type { BreachEvent } from "@/lib/rehab/envelope";
import type { PhoneState } from "@/lib/rehab/messages";
import { api, type DashError, type PatientDetail } from "./_lib/api";
import { LivePanel, type PhoneLive } from "./LivePanel";
import { MessagePanel } from "./MessagePanel";
import {
  AlertsPanel,
  HistoryPanel,
  LinkPhonePanel,
  NotesPanel,
} from "./PatientPanels";
import { ProgramPanel } from "./ProgramPanel";

export type Tab =
  | "live"
  | "message"
  | "program"
  | "history"
  | "alerts"
  | "notes"
  | "link";

export function PatientView({
  patientId,
  me,
  onBack,
  onAlertsChanged,
  initialTab = "live",
}: {
  initialTab?: Tab;
  patientId: string;
  me: LivePeer;
  onBack: () => void;
  onAlertsChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phones, setPhones] = useState<Record<string, PhoneLive>>({});
  const phonesRef = useRef(phones);
  phonesRef.current = phones;

  const reload = useCallback(() => {
    api
      .patient(patientId)
      .then(setDetail)
      .catch((x) => setErr((x as DashError).message));
  }, [patientId]);
  useEffect(() => {
    setDetail(null);
    setPhones({});
    reload();
  }, [reload]);

  const onMessage = useCallback((m: LiveMsg) => {
    const cur = phonesRef.current[m.from] ?? {
      deviceId: m.from,
      state: null,
      receivedAt: 0,
      breaches: [],
    };
    if (m.type === "state") {
      setPhones((p) => ({
        ...p,
        [m.from]: {
          ...cur,
          state: m.payload as PhoneState,
          receivedAt: Date.now(),
        },
      }));
    } else if (m.type === "breach") {
      setPhones((p) => ({
        ...p,
        [m.from]: {
          ...cur,
          breaches: [
            { ...(m.payload as BreachEvent), at: Date.now() },
            ...cur.breaches,
          ].slice(0, 20),
        },
      }));
    }
  }, []);

  const live = useLiveChannel({ patientId, enabled: true, me, onMessage });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Pasien
        </Button>
        <h2 className="flex-1 text-2xl font-semibold">
          {detail?.patient.displayName ?? "..."}
        </h2>
        <RelayPill
          state={
            live.state === "open"
              ? "open"
              : live.state === "error"
                ? "error"
                : live.state === "off"
                  ? "off"
                  : "connecting"
          }
        />
      </div>
      {err && <p className="text-base text-danger">{err}</p>}

      <Tabs<Tab>
        items={[
          { id: "live", label: "Live", icon: LineChart },
          { id: "message", label: "Pesan", icon: MessageCircle },
          { id: "program", label: "Program & batas", icon: ShieldAlert },
          { id: "history", label: "Riwayat", icon: History },
          { id: "alerts", label: "Peringatan", icon: BellRing },
          { id: "notes", label: "Catatan", icon: NotebookPen },
          { id: "link", label: "Hubungkan HP", icon: QrCode },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "live" && (
        <LivePanel
          live={live.state}
          peers={live.peers}
          phones={phones}
          onPause={(to) => live.send("pause", to ? { to } : {})}
        />
      )}
      {tab === "program" && detail && (
        <ProgramPanel
          detail={detail}
          reload={reload}
          onEnvelopeSaved={() => live.send("refresh-bundle", {})}
        />
      )}
      {tab === "history" && <HistoryPanel patientId={patientId} />}
      {tab === "alerts" && (
        <AlertsPanel patientId={patientId} onChange={onAlertsChanged} />
      )}
      {tab === "notes" && <NotesPanel patientId={patientId} />}
      {tab === "link" && <LinkPhonePanel patientId={patientId} />}
      {tab === "message" && <MessagePanel patientId={patientId} />}
    </div>
  );
}
