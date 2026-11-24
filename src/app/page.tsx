import { Hand, Monitor, Smartphone } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Screen } from "@/components/ui/Screen";

const ROLES = [
  {
    href: "/phone",
    icon: Smartphone,
    title: "HP (sensor)",
    body: "Buka di HP yang dipasang di lengan.",
  },
  {
    href: "/screen",
    icon: Monitor,
    title: "Layar (laptop)",
    body: "Buka di laptop. Menampilkan kode ruang dan data live.",
  },
  {
    href: "/gesture",
    icon: Hand,
    title: "Mode 2: gestur ke suara",
    body: "Kata buatan sendiri, atau ASL siap pakai (250 isyarat). Bukan penerjemah.",
  },
];

export default function Home() {
  return (
    <Screen
      title="Rehat"
      subtitle="Prototipe kelayakan: apakah sensor HP bekerja di HP sungguhan?"
      narrow
    >
      <Alert tone="warning" title="Prototipe, bukan alat medis">
        Semua batas di aplikasi ini hanya contoh. Batas sungguhan ditentukan
        terapis.
      </Alert>
      <div className="grid gap-3">
        {ROLES.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-(--radius-card) bg-surface p-5 shadow-(--shadow-card) transition-colors hover:bg-surface-2"
          >
            <Icon size={36} className="shrink-0 text-primary" aria-hidden />
            <div>
              <div className="text-lg font-semibold">{title}</div>
              <div className="text-sm text-muted">{body}</div>
            </div>
          </Link>
        ))}
      </div>
    </Screen>
  );
}
