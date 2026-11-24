"use client";
// "HP vs busur derajat": log the app's angle next to an angle measured by hand (protractor /
// goniometer app) to get OUR OWN error number. Pairs are kept in IndexedDB on this laptop.
import { Download, Plus, Ruler, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { getDb, type ValidationRow } from "@/lib/db";
import { downloadJson, stamp } from "@/lib/sensor/recording";

/** Only log while the arm is held still, otherwise the two numbers are from different moments. */
const STILL_DEG_S = 5; // tuned by testing

export function ValidationPanel({
  readApp,
  exercise,
  device,
}: {
  readApp: () => { angleDeg: number; velDegS: number } | null;
  exercise: string;
  device: string;
}) {
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(
    async () =>
      setRows(await getDb().validations.orderBy("createdAt").toArray()),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const add = async () => {
    const app = readApp();
    const refDeg = Number(ref);
    if (!app)
      return setMsg("Belum ada sudut: hubungkan HP dan kalibrasi dulu.");
    if (!Number.isFinite(refDeg) || ref === "")
      return setMsg("Isi sudut dari busur dulu.");
    if (app.velDegS > STILL_DEG_S)
      return setMsg("Lengan masih bergerak. Tahan diam lalu catat lagi.");
    await getDb().validations.add({
      createdAt: new Date().toISOString(),
      exercise,
      device,
      appDeg: app.angleDeg,
      refDeg,
    });
    setRef("");
    setMsg(null);
    reload();
  };

  const errs = rows.map((r) => r.appDeg - r.refDeg);
  const n = errs.length;
  const mae = n ? errs.reduce((a, e) => a + Math.abs(e), 0) / n : 0;
  const bias = n ? errs.reduce((a, e) => a + e, 0) / n : 0;
  const maxAbs = n ? Math.max(...errs.map(Math.abs)) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <Card title="Catat satu pengukuran" icon={Ruler}>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Kalibrasi di HP pada posisi awal (sudut 0).</li>
          <li>Gerakkan ke suatu sudut lalu tahan diam.</li>
          <li>
            Ukur sudut segmen dari posisi awal dengan busur / aplikasi
            goniometer.
          </li>
          <li>Ketik angkanya, tekan Catat. Ulangi di beberapa sudut.</li>
        </ol>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Sudut busur (°)"
            aria-label="Sudut dari busur dalam derajat"
            className="h-11 min-w-0 flex-1 rounded-(--radius-control) border border-border bg-surface px-3 focus:border-primary focus:outline-none"
          />
          <Button icon={Plus} onClick={add}>
            Catat
          </Button>
        </div>
        {msg && <p className="mt-2 text-sm text-warning">{msg}</p>}
        <p className="mt-4 text-xs text-muted">
          Ini galat pengukuran tim pada orang sehat, bukan akurasi klinis, dan
          tidak membuktikan apa pun untuk pasien stroke.
        </p>
      </Card>

      <Card
        title="Hasil"
        actions={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={Download}
              aria-label="Ekspor JSON"
              onClick={() => downloadJson(`validasi-${stamp()}.json`, rows)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label="Hapus semua"
              onClick={async () => {
                await getDb().validations.clear();
                reload();
              }}
            />
          </div>
        }
      >
        <div className="mb-4 grid grid-cols-4 gap-3">
          <Stat label="n" value={n} />
          <Stat label="Galat rata2 |e|" value={mae.toFixed(1)} unit="°" />
          <Stat label="Bias" value={bias.toFixed(1)} unit="°" />
          <Stat label="Galat maks" value={maxAbs.toFixed(1)} unit="°" />
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-medium">Waktu</th>
                <th className="font-medium">Aplikasi</th>
                <th className="font-medium">Busur</th>
                <th className="font-medium">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{r.createdAt.slice(11, 19)}</td>
                  <td>{r.appDeg.toFixed(1)}°</td>
                  <td>{r.refDeg.toFixed(1)}°</td>
                  <td>{(r.appDeg - r.refDeg).toFixed(1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
