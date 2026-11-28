import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { ErrorView } from "@/components/care/ErrorView";

export const metadata: Metadata = { title: "Halaman tidak ditemukan · Rehat" };

export default function NotFound() {
  return (
    <ErrorView code="404" icon={Compass} title="Halaman tidak ditemukan">
      Alamatnya mungkin salah ketik atau halamannya sudah dipindah. Data latihan
      tidak terpengaruh.
    </ErrorView>
  );
}
