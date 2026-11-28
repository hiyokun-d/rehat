"use client";
// Error boundary for every page under the root layout. Shows only the digest (an id to match
// server logs), never the message: server error text can leak internals (OWASP A10).
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { ErrorView } from "@/components/care/ErrorView";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";
  return (
    <ErrorView
      code="500"
      icon={TriangleAlert}
      title="Ada yang salah di halaman ini"
      action={
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex h-12 items-center rounded-(--radius-control) bg-primary px-4 text-lg font-semibold text-primary-fg hover:bg-primary-hover"
        >
          Coba lagi
        </button>
      }
    >
      <p>
        Latihan yang sudah tersimpan di HP tidak hilang dan akan dikirim saat
        koneksi pulih. Bila sedang latihan, berhenti dulu dan istirahat.
      </p>
      {digest && <p className="mt-2 text-sm">Kode: {digest}</p>}
    </ErrorView>
  );
}
