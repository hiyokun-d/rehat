import { Hand, Monitor } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Screen } from "@/components/ui/Screen";

// Lab: experiments kept OUT of the main Rehat flow (team decision 28 Nov 2026: focus on Mode 1).
// Only linked from the small flask button in the dashboard footer. Not a secret (no data here is
// sensitive), just out of the way; search engines are told not to index it.
export const metadata: Metadata = {
  title: "Rehat · Lab",
  robots: { index: false, follow: false },
};

const ITEMS = [
  {
    href: "/gesture",
    icon: Hand,
    title: "Mode 2: gestur ke suara",
    body: "Kata buatan sendiri, atau ASL siap pakai (250 isyarat). Bukan penerjemah bahasa isyarat.",
  },
  {
    href: "/screen",
    icon: Monitor,
    title: "Layar LAN (prototipe)",
    body: "Layar lama berbasis kode ruang 4 digit lewat relay lokal. Untuk demo tanpa internet.",
  },
];

export default function LabPage() {
  return (
    <Screen title="Lab" subtitle="Eksperimen di luar alur utama Rehat" narrow>
      <Alert tone="warning" title="Eksperimen">
        Fitur di sini belum divalidasi dan bukan bagian dari layanan Rehat.
      </Alert>
      <div className="grid gap-3">
        {ITEMS.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-(--radius-card) bg-surface p-5 shadow-(--shadow-card) transition-colors hover:bg-surface-2"
          >
            <Icon size={32} className="shrink-0 text-primary" aria-hidden />
            <div>
              <div className="text-lg font-semibold">{title}</div>
              <div className="text-sm text-muted">{body}</div>
            </div>
          </Link>
        ))}
      </div>
      <Link href="/" className="text-base text-primary underline">
        Kembali ke dashboard
      </Link>
    </Screen>
  );
}
