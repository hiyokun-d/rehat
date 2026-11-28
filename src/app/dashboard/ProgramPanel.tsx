"use client";
// Program + safety envelope per exercise, for one patient. Every save is a NEW envelope version
// (server: append-only), and phones then pull it from the server (never pushed over live).
import { Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, ExampleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { Tabs } from "@/components/ui/Tabs";
import { EXAMPLE_ENVELOPE } from "@/lib/rehab/defaults";
import { api, type DashError, type PatientDetail } from "./_lib/api";

type Ex = NonNullable<PatientDetail["program"]>["exercises"][number];

function EnvelopeEditor({ pe, onSaved }: { pe: Ex; onSaved: () => void }) {
  const e = pe.envelope;
  const [v, setV] = useState({
    maxAngleDeg: e?.maxAngleDeg ?? EXAMPLE_ENVELOPE.maxAngleDeg,
    maxVelDegPerS: e?.maxVelDegPerS ?? EXAMPLE_ENVELOPE.maxVelDegPerS,
    debounceMs: e?.debounceMs ?? EXAMPLE_ENVELOPE.debounceMs,
    onBreach: e?.onBreach ?? ("CUE_AND_PAUSE" as const),
    notifyCaregiver: e?.notifyCaregiver ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty =
    !e ||
    e.maxAngleDeg !== v.maxAngleDeg ||
    e.maxVelDegPerS !== v.maxVelDegPerS ||
    e.debounceMs !== v.debounceMs ||
    e.onBreach !== v.onBreach ||
    e.notifyCaregiver !== v.notifyCaregiver;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.putEnvelope({ planExerciseId: pe.id, ...v });
      onSaved();
    } catch (x) {
      setErr((x as DashError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!e && (
        <Alert tone="warning" title="Belum ada batas">
          Pasien belum bisa menyimpan sesi latihan ini ke server sebelum batas
          ditetapkan. Angka awal di bawah hanya CONTOH.
        </Alert>
      )}
      <Slider
        label="Sudut maksimum"
        unit="°"
        min={10}
        max={180}
        value={v.maxAngleDeg}
        onChange={(x) => setV({ ...v, maxAngleDeg: x })}
        example={!e}
      />
      <Slider
        label="Kecepatan maksimum"
        unit="°/s"
        min={10}
        max={400}
        step={5}
        value={v.maxVelDegPerS}
        onChange={(x) => setV({ ...v, maxVelDegPerS: x })}
        example={!e}
      />
      <Slider
        label="Harus lewat batas selama"
        unit="ms"
        min={0}
        max={2000}
        step={50}
        value={v.debounceMs}
        onChange={(x) => setV({ ...v, debounceMs: x })}
        example={!e}
      />
      <div>
        <div className="mb-1 text-base font-medium">Saat melewati batas</div>
        <Tabs<"CUE_ONLY" | "CUE_AND_PAUSE">
          items={[
            { id: "CUE_ONLY", label: "Peringatan suara" },
            { id: "CUE_AND_PAUSE", label: "Suara + jeda latihan" },
          ]}
          value={v.onBreach}
          onChange={(onBreach) => setV({ ...v, onBreach })}
        />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input
          type="checkbox"
          className="size-5 accent-(--color-primary)"
          checked={v.notifyCaregiver}
          onChange={(x) => setV({ ...v, notifyCaregiver: x.target.checked })}
        />
        Beri tahu pendamping bila terjadi
      </label>
      {err && <p className="text-base text-danger">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Save} onClick={save} loading={busy} disabled={!dirty}>
          {e ? `Simpan sebagai versi ${e.version + 1}` : "Tetapkan batas"}
        </Button>
        {e && (
          <span className="text-sm text-muted">
            Versi {e.version}, {new Date(e.createdAt).toLocaleString("id-ID")}
          </span>
        )}
      </div>
    </div>
  );
}

export function ProgramPanel({
  detail,
  reload,
  onEnvelopeSaved,
}: {
  detail: PatientDetail;
  reload: () => void;
  onEnvelopeSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(
    detail.program?.exercises[0]?.id ?? null,
  );
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      reload();
    } catch (x) {
      setErr((x as DashError).message);
    } finally {
      setBusy(false);
    }
  };

  const program = detail.program;
  if (!program)
    return (
      <Card title="Program latihan" icon={ShieldAlert}>
        <p className="mb-3 text-base text-muted">
          Pasien ini belum punya program aktif.
        </p>
        {err && <p className="mb-2 text-base text-danger">{err}</p>}
        <Button
          icon={Plus}
          loading={busy}
          onClick={() =>
            run(() =>
              api.createProgram(detail.patient.id, "Program latihan di rumah"),
            )
          }
        >
          Buat program
        </Button>
      </Card>
    );

  const inPlan = new Set(program.exercises.map((x) => x.exercise.id));
  const addable = detail.catalog.filter((c) => !inPlan.has(c.id));

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Batas adalah keputusan klinis">
        Hanya terapis atau tenaga kesehatan yang ditunjuk terapis yang mengatur
        angka ini, per pasien dan per latihan. Rehat tidak menentukan apa yang
        aman.
      </Alert>
      {err && <p className="text-base text-danger">{err}</p>}
      {program.exercises.map((pe) => (
        <Card
          key={pe.id}
          title={pe.exercise.name}
          icon={ShieldAlert}
          actions={
            pe.envelope ? (
              <Badge tone="success">batas v{pe.envelope.version}</Badge>
            ) : (
              <Badge tone="warning">belum ada batas</Badge>
            )
          }
        >
          {open === pe.id ? (
            <EnvelopeEditor
              pe={pe}
              onSaved={() => {
                onEnvelopeSaved();
                reload();
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base tabular-nums">
                {pe.envelope
                  ? `Sudut maks ${pe.envelope.maxAngleDeg}° · kecepatan maks ${pe.envelope.maxVelDegPerS}°/s · ${pe.envelope.onBreach === "CUE_AND_PAUSE" ? "jeda" : "suara saja"}`
                  : "Batas belum ditetapkan."}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOpen(pe.id)}
              >
                Ubah
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            className="mt-3"
            disabled={busy}
            onClick={() => run(() => api.removeExercise(pe.id))}
          >
            Hapus dari program
          </Button>
        </Card>
      ))}
      {addable.length > 0 && (
        <Card title="Tambah latihan" icon={Plus}>
          <div className="flex flex-wrap gap-2">
            {addable.map((c) => (
              <Button
                key={c.id}
                variant="secondary"
                icon={Plus}
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.addExercise(program.id, c.id, program.exercises.length),
                  )
                }
              >
                {c.name}
              </Button>
            ))}
          </div>
        </Card>
      )}
      {program.exercises.length === 0 && addable.length === 0 && (
        <p className="text-base text-muted">
          Katalog latihan kosong. Jalankan seed katalog (docs/DEMO.md).
        </p>
      )}
      <ExampleBadge />
    </div>
  );
}
