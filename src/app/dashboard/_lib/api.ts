// Fetch helpers for the nurse dashboard. One place for status handling so every panel shows the
// same messages. Same-origin cookies carry the Supabase session; the server decides the role.
import type { ServerBreach, ServerSession } from "@/app/screen/_lib/historyApi";

export type { ServerBreach, ServerSession };

export class DashError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: init?.body
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
    });
  } catch {
    throw new DashError(0, "Tidak ada koneksi ke server.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new DashError(
      res.status,
      (body as { error?: string }).error ?? "Terjadi kesalahan.",
    );
  return body as T;
}

const post = <T>(url: string, body: unknown, method = "POST") =>
  call<T>(url, { method, body: JSON.stringify(body) });

import type { PatientOverview } from "@/lib/care/triage";

export type OverviewRow = PatientOverview & {
  openHelp: { id: string; at: string }[];
};

export interface PatientRow {
  id: string;
  displayName: string;
  createdAt: string;
  lastSessionAt: string | null;
  pendingAlerts: number;
  sessionsThisWeek: number;
}

export interface EnvelopeRow {
  version: number;
  maxAngleDeg: number;
  maxVelDegPerS: number;
  debounceMs: number;
  onBreach: "CUE_ONLY" | "CUE_AND_PAUSE";
  notifyCaregiver: boolean;
  createdAt: string;
}

export interface PatientDetail {
  patient: { id: string; displayName: string; createdAt: string };
  program: {
    id: string;
    title: string;
    exercises: {
      id: string;
      position: number;
      exercise: { id: string; slug: string; name: string };
      envelope: EnvelopeRow | null;
    }[];
  } | null;
  catalog: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
  }[];
}

export interface AlertRow {
  id: string;
  level: "L1" | "L2";
  status: "PENDING" | "SENT" | "ACKNOWLEDGED" | "FALSE_ALARM";
  createdAt: string;
  acknowledgedAt: string | null;
  sessionId: string;
  breachEvent: {
    kind: "ANGLE" | "VELOCITY";
    value: number;
    limit: number;
    heldMs: number;
    occurredAt: string;
  } | null;
}

export interface ReviewRow {
  id: string;
  note: string;
  createdAt: string;
}

export const api = {
  overview: () => call<OverviewRow[]>("/api/overview"),
  ackHelp: (id: string) => post<{ ok: true }>(`/api/help/${id}/ack`, {}),
  message: (patientId: string, text: string) =>
    post<{ id: string; delivered: boolean }>(
      `/api/patients/${patientId}/message`,
      { text },
    ),
  me: () => call<{ id: string; role: string; displayName: string }>("/api/me"),
  patients: () => call<PatientRow[]>("/api/patients"),
  newPatient: (displayName: string) =>
    post<{ id: string; displayName: string }>("/api/patients/new", {
      displayName,
    }),
  patient: (id: string) => call<PatientDetail>(`/api/patients/${id}`),
  createProgram: (patientId: string, title: string) =>
    post<{ id: string }>("/api/programs", { patientId, title, active: true }),
  addExercise: (programId: string, exerciseId: string, position: number) =>
    post<{ id: string }>("/api/plan-exercises", {
      programId,
      exerciseId,
      position,
    }),
  removeExercise: (planExerciseId: string) =>
    call<void>(`/api/plan-exercises/${planExerciseId}`, { method: "DELETE" }),
  putEnvelope: (body: {
    planExerciseId: string;
    maxAngleDeg: number;
    maxVelDegPerS: number;
    debounceMs: number;
    onBreach: "CUE_ONLY" | "CUE_AND_PAUSE";
    notifyCaregiver: boolean;
  }) => post<EnvelopeRow>("/api/envelopes", body, "PUT"),
  sessions: (patientId: string, page = 1) =>
    call<{ items: ServerSession[]; hasMore: boolean; page: number }>(
      `/api/sessions?patientId=${patientId}&page=${page}&limit=20`,
    ),
  breaches: (sessionId: string) =>
    call<{ items: ServerBreach[] }>(
      `/api/breaches?sessionId=${sessionId}&limit=50`,
    ),
  alerts: (patientId: string) =>
    call<AlertRow[]>(`/api/patients/${patientId}/alerts`),
  ackAlert: (id: string, falseAlarm: boolean) =>
    post<unknown>(`/api/alerts/${id}/ack`, falseAlarm ? { falseAlarm } : {}),
  reviews: (patientId: string) =>
    call<ReviewRow[]>(`/api/patients/${patientId}/reviews`),
  addReview: (patientId: string, note: string) =>
    post<ReviewRow>(`/api/patients/${patientId}/reviews`, { note }),
  deviceLink: (patientId: string) =>
    post<{ token: string; code: string; expiresAt: number }>(
      `/api/patients/${patientId}/device-link`,
      {},
    ),
};

export const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

/** "baru saja", "3 jam lalu", "2 hari lalu". Short enough for a phone row. */
export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "belum pernah";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 2) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}
