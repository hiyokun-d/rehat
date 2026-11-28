"use client";
// "Riwayat server" panel on /screen: sessions and breach events the therapist's patients synced
// to the backend. Needs a therapist login; without one /screen keeps showing the live view from
// the phone (labelled as local). The panel only displays what the therapist's own limits
// recorded: no completion %, no recovery score, no safe/unsafe verdict (AGENTS.md).
import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { signInTherapist, signOutTherapist } from "./_lib/auth";
import {
  fetchBreaches,
  fetchSessions,
  type HistoryError,
  type ServerBreach,
  type ServerSession,
} from "./_lib/historyApi";

export type PanelState =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | {
      kind: "ready";
      sessions: ServerSession[];
      page: number;
      hasMore: boolean;
    };

export type BreachState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: ServerBreach[] };

type FetchImpl = Parameters<typeof fetchSessions>[1];

const STATUS_LABEL: Record<ServerSession["status"], string> = {
  COMPLETED: "Dikerjakan",
  CANNOT_DO: "Tidak bisa dikerjakan",
  POSTPONED: "Ditunda",
};
const REPORTER_LABEL: Record<ServerSession["reportedBy"], string> = {
  PATIENT: "Pasien",
  CAREGIVER: "Pendamping",
};

const fail = (e: HistoryError): PanelState =>
  e === "login" || e === "forbidden" ? { kind: e } : { kind: "error" };

/** Loads one page of sessions and folds the result (including 401/403) into a panel state. */
export async function loadSessionsState(
  page = 1,
  previous: ServerSession[] = [],
  fetchImpl?: FetchImpl,
): Promise<PanelState> {
  const res = await fetchSessions(page, fetchImpl);
  if (!res.ok) return fail(res.error);
  return {
    kind: "ready",
    sessions: [...previous, ...res.data.items],
    page: res.data.page,
    hasMore: res.data.hasMore,
  };
}

export async function loadBreachesState(
  sessionId: string,
  fetchImpl?: FetchImpl,
): Promise<BreachState> {
  const res = await fetchBreaches(sessionId, 1, fetchImpl);
  return res.ok ? { kind: "ready", items: res.data.items } : { kind: "error" };
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });

function LoginForm({
  onSubmit,
}: {
  onSubmit: (email: string, password: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(await onSubmit(email, password));
        setBusy(false);
      }}
    >
      <label className="block text-base">
        Email terapis
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3"
        />
      </label>
      <label className="block text-base">
        Kata sandi
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3"
        />
      </label>
      {error && (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      )}
      <Button type="submit" icon={LogIn} loading={busy}>
        Masuk
      </Button>
    </form>
  );
}

function BreachList({ state }: { state: BreachState | undefined }) {
  if (!state || state.kind === "loading")
    return <p className="text-sm text-muted">Memuat kejadian…</p>;
  if (state.kind === "error")
    return <p className="text-sm text-danger">Kejadian gagal dimuat.</p>;
  if (state.items.length === 0)
    return (
      <p className="text-sm text-muted">
        Tidak ada kejadian melewati batas terapis.
      </p>
    );
  return (
    <ul className="space-y-1">
      {state.items.map((b) => (
        <li key={b.id} className="text-sm tabular-nums">
          <Badge tone="danger">
            {b.kind === "ANGLE" ? "Sudut" : "Kecepatan"}
          </Badge>{" "}
          {b.value.toFixed(0)}
          {b.kind === "ANGLE" ? "°" : "°/s"} (batas terapis {b.limit}), bertahan{" "}
          {b.heldMs} ms · {dateTime(b.occurredAt)}
        </li>
      ))}
    </ul>
  );
}

export function ServerHistoryView({
  state,
  openId,
  breaches,
  onLogin,
  onSignOut,
  onOpen,
  onMore,
  onRetry,
}: {
  state: PanelState;
  openId: string | null;
  breaches: Record<string, BreachState>;
  onLogin: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => void;
  onOpen: (id: string) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  return (
    <Card
      title="Riwayat server"
      actions={
        state.kind === "ready" ? (
          <Button size="sm" variant="ghost" icon={LogOut} onClick={onSignOut}>
            Keluar
          </Button>
        ) : undefined
      }
    >
      {state.kind === "loading" && (
        <p className="text-base text-muted">Memuat…</p>
      )}

      {state.kind === "login" && (
        <div className="space-y-3">
          <Alert tone="info" title="Mode lokal: belum masuk">
            Layar ini hanya menampilkan data langsung dari HP dan riwayat di
            laptop ini. Masuk sebagai terapis untuk melihat riwayat dari server.
          </Alert>
          <LoginForm onSubmit={onLogin} />
        </div>
      )}

      {state.kind === "forbidden" && (
        <Alert tone="warning" title="Akun ini bukan terapis">
          Riwayat server hanya untuk akun terapis.{" "}
          <button type="button" className="underline" onClick={onSignOut}>
            Keluar
          </button>
        </Alert>
      )}

      {state.kind === "error" && (
        <div className="space-y-2">
          <Alert tone="danger" title="Riwayat server gagal dimuat">
            Coba lagi sebentar lagi.
          </Alert>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            onClick={onRetry}
          >
            Coba lagi
          </Button>
        </div>
      )}

      {state.kind === "ready" &&
        (state.sessions.length === 0 ? (
          <p className="text-base text-muted">
            Belum ada sesi dari pasien Anda.
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="divide-y divide-border">
              {state.sessions.map((s) => (
                <li key={s.id} className="py-2">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    aria-expanded={openId === s.id}
                    onClick={() => onOpen(s.id)}
                  >
                    <span className="text-base font-medium">
                      {dateTime(s.startedAt)}
                    </span>
                    <Badge>{STATUS_LABEL[s.status]}</Badge>
                    <span className="text-sm text-muted">
                      dilaporkan {REPORTER_LABEL[s.reportedBy]}
                    </span>
                  </button>
                  {s.attempt && (
                    <p className="mt-1 text-sm text-muted tabular-nums">
                      {s.attempt.reps} repetisi · sudut maks{" "}
                      {s.attempt.maxAngleDeg.toFixed(0)}° · kecepatan maks{" "}
                      {s.attempt.maxVelDegPerS.toFixed(0)}°/s · jeda{" "}
                      {s.attempt.pauses}
                    </p>
                  )}
                  {openId === s.id && (
                    <div className="mt-2 border-l-2 border-border pl-3">
                      <BreachList state={breaches[s.id]} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {state.hasMore && (
              <Button size="sm" variant="secondary" onClick={onMore}>
                Muat lebih banyak
              </Button>
            )}
          </div>
        ))}
    </Card>
  );
}

/** Container: owns fetching and login. `onTherapist` tells /screen whether it is in local mode. */
export function ServerHistory({
  onTherapist,
}: {
  onTherapist?: (therapist: boolean) => void;
}) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [breaches, setBreaches] = useState<Record<string, BreachState>>({});

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await loadSessionsState());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state.kind === "loading") return;
    onTherapist?.(state.kind === "ready");
  }, [state.kind, onTherapist]);

  return (
    <ServerHistoryView
      state={state}
      openId={openId}
      breaches={breaches}
      onLogin={async (email, password) => {
        const err = await signInTherapist(email, password);
        if (!err) await load();
        return err;
      }}
      onSignOut={async () => {
        await signOutTherapist();
        setOpenId(null);
        setBreaches({});
        await load();
      }}
      onOpen={(id) => {
        setOpenId((cur) => (cur === id ? null : id));
        if (breaches[id]?.kind === "ready") return;
        setBreaches((b) => ({ ...b, [id]: { kind: "loading" } }));
        loadBreachesState(id).then((r) =>
          setBreaches((b) => ({ ...b, [id]: r })),
        );
      }}
      onMore={async () => {
        if (state.kind !== "ready") return;
        const next = await loadSessionsState(state.page + 1, state.sessions);
        if (next.kind === "ready") setState(next);
      }}
      onRetry={load}
    />
  );
}
