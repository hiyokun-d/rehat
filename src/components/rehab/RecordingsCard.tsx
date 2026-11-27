"use client";
// Record raw samples on this device, keep them in IndexedDB, download / send / replay them.
import { CircleStop, Download, Play, Send, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDb, type RecordingRow } from "@/lib/db";
import {
  downloadJson,
  isRecording,
  type Recording,
  stamp,
} from "@/lib/sensor/recording";

export interface RecordingsCardProps {
  recording?: boolean;
  onStart?: () => void;
  onStop?: () => Recording;
  onSend?: (r: Recording) => void; // send to laptop
  onReplay?: (r: Recording) => void;
}

export function RecordingsCard({
  recording,
  onStart,
  onStop,
  onSend,
  onReplay,
}: RecordingsCardProps) {
  const [rows, setRows] = useState<RecordingRow[]>([]);
  const reload = useCallback(async () => {
    setRows(
      await getDb()
        .recordings.orderBy("createdAt")
        .reverse()
        .limit(10)
        .toArray(),
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const stopAndSave = async () => {
    if (!onStop) return;
    const rec = onStop();
    await getDb().recordings.add({ ...rec, name: `rekaman-${stamp()}` });
    reload();
  };

  const importFile = async (file: File) => {
    const data = JSON.parse(await file.text());
    if (!isRecording(data)) return;
    await getDb().recordings.add({
      ...data,
      name: file.name.replace(/\.json$/, ""),
    });
    reload();
  };

  return (
    <Card
      title="Rekaman data mentah"
      actions={
        onStart &&
        (recording ? (
          <Button
            size="sm"
            variant="danger"
            icon={Square}
            onClick={stopAndSave}
          >
            Berhenti
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={CircleStop}
            onClick={onStart}
          >
            Rekam
          </Button>
        ))
      }
    >
      {recording && (
        <p className="mb-2 text-base font-medium text-danger">
          Merekam sampel...
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-base text-muted">
          Belum ada rekaman di perangkat ini.
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0 text-base">
              <div className="truncate font-medium">{r.name}</div>
              <div className="text-muted">{r.samples.length} sampel</div>
            </div>
            <div className="flex gap-1">
              {onReplay && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Play}
                  aria-label="Putar"
                  onClick={() => onReplay(r)}
                />
              )}
              {onSend && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Send}
                  aria-label="Kirim ke laptop"
                  onClick={() => onSend(r)}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={Download}
                aria-label="Unduh"
                onClick={() => downloadJson(`${r.name}.json`, r)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label="Hapus"
                onClick={async () => {
                  if (r.id !== undefined) await getDb().recordings.delete(r.id);
                  reload();
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-base text-muted">
        Impor file rekaman (.json)
        <input
          type="file"
          accept="application/json"
          className="mt-1 block w-full text-base file:mr-3 file:h-10 file:rounded-(--radius-control) file:border file:border-border file:bg-surface file:px-4 file:font-medium file:text-text"
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
        />
      </label>
    </Card>
  );
}
