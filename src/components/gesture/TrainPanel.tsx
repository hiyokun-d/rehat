"use client";
// "Latih": pick a word, then perform it 5-10 times. Each automatically cut segment becomes a
// template (stored in IndexedDB on this phone). Export/import JSON to move templates around.
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { cn } from "@/lib/cn";
import type { Frame } from "@/lib/gesture/features";
import { expand } from "@/lib/gesture/vocab";
import { HandSkeletonPlayer } from "./HandSkeletonPlayer";

export interface TrainPanelProps {
  vocab: string[];
  groups: { title: string; words: string[] }[];
  userName: string;
  counts: Record<string, number>;
  selected: string | null;
  /** First recording of the selected word, replayed as the demonstration. */
  demo?: Frame[];
  onSelect: (w: string | null) => void;
  onAddWord: (w: string) => void;
  onDeleteWord: (w: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export function TrainPanel(p: TrainPanelProps) {
  const [newWord, setNewWord] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Pilih kata atau kalimat, lalu lakukan satu gerakan yang sama 5 sampai 10
        kali dengan jeda diam di antaranya. Ini gerakan uji buatan tim, bukan
        isyarat BISINDO.
      </p>
      {/* Words grouped like a communication board; user-added words go under "Kata saya". */}
      {[
        ...p.groups,
        {
          title: "Kata saya",
          words: p.vocab.filter(
            (w) => !p.groups.some((g) => g.words.includes(w)),
          ),
        },
      ]
        .map((g) => ({
          ...g,
          words: g.words.filter((w) => p.vocab.includes(w)),
        }))
        .filter((g) => g.words.length)
        .map((g) => (
          <Disclosure
            key={g.title}
            title={`${g.title} (${g.words.filter((w) => p.counts[w]).length}/${g.words.length} dilatih)`}
            defaultOpen={g.words.includes(p.selected ?? "")}
          >
            <div className="flex flex-wrap gap-2">
              {g.words.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => p.onSelect(p.selected === w ? null : w)}
                  aria-pressed={p.selected === w}
                  className={cn(
                    "min-h-12 rounded-full border px-4 text-base font-medium",
                    p.selected === w
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border bg-surface",
                  )}
                >
                  {expand(w, p.userName)}
                  <span className="ml-1 tabular-nums opacity-70">
                    {p.counts[w] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </Disclosure>
        ))}
      {p.selected && (
        <div className="space-y-1">
          <div className="text-sm font-medium">
            Contoh Anda untuk "{p.selected}"
          </div>
          {p.demo ? (
            <HandSkeletonPlayer
              frames={p.demo}
              label={`Rekaman pertama Anda untuk ${p.selected}, diputar ulang`}
            />
          ) : (
            <p className="rounded-(--radius-control) bg-surface-2 p-3 text-sm text-muted">
              Belum ada rekaman. Gerakan pertama yang Anda rekam akan diputar di
              sini sebagai contoh untuk ulangan berikutnya.
            </p>
          )}
          <p className="text-xs text-muted">
            Ini rekaman Anda sendiri, bukan contoh isyarat BISINDO resmi.
          </p>
        </div>
      )}
      {p.selected && (
        <div className="flex items-center justify-between gap-2 rounded-(--radius-control) bg-primary-soft p-3">
          <span className="font-medium">
            Merekam contoh untuk "{p.selected}" ({p.counts[p.selected] ?? 0}{" "}
            tersimpan)
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label={`Hapus contoh ${p.selected}`}
            onClick={() => p.selected && p.onDeleteWord(p.selected)}
          />
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newWord.trim()) p.onAddWord(newWord.trim().toLowerCase());
          setNewWord("");
        }}
      >
        <input
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          placeholder="Kata baru"
          aria-label="Kata baru"
          className="h-11 min-w-0 flex-1 rounded-(--radius-control) border border-border bg-surface px-3 focus:border-primary focus:outline-none"
        />
        <Button type="submit" icon={Plus} variant="secondary">
          Tambah
        </Button>
      </form>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={Download}
          onClick={p.onExport}
        >
          Ekspor
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-(--radius-control) border border-border bg-surface px-3 text-sm font-semibold">
          <Upload size={16} aria-hidden />
          Impor
          <input
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(e) =>
              e.target.files?.[0] && p.onImport(e.target.files[0])
            }
          />
        </label>
      </div>
    </div>
  );
}
