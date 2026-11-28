// Shared body for 404 / error pages. Calm wording, one obvious way out, and the emergency number
// always visible: a broken page must never be the reason someone does not call for help.
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export function ErrorView({
  code,
  icon: Icon,
  title,
  children,
  action,
}: {
  code: string;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div className="flex items-center gap-3 text-primary">
        <Icon size={40} aria-hidden />
        <span className="text-5xl font-semibold tabular-nums">{code}</span>
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-lg text-muted">{children}</div>
      <div className="flex flex-wrap gap-2">
        {action}
        <Link
          href="/"
          className="inline-flex h-12 items-center rounded-(--radius-control) bg-surface-2 px-4 text-lg font-semibold hover:bg-border"
        >
          Ke dashboard
        </Link>
        <Link
          href="/phone"
          className="inline-flex h-12 items-center rounded-(--radius-control) bg-surface-2 px-4 text-lg font-semibold hover:bg-border"
        >
          Halaman HP pasien
        </Link>
      </div>
      <p className="rounded-(--radius-card) bg-danger-soft p-3 text-base text-danger">
        Darurat (wajah mencong, lengan lemah, bicara pelo)? Jangan menunggu
        aplikasi.{" "}
        <a href="tel:119" className="font-semibold underline">
          Telepon 119
        </a>
        .
      </p>
    </main>
  );
}
