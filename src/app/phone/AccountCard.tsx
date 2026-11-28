"use client";
// Optional login for the phone. Signed out, the phone runs in local mode: nothing is sent to a
// server and sessions stay on this phone.
import { Cloud, CloudOff, LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { AuthState } from "./useBackend";

const field =
  "h-12 w-full rounded-(--radius-control) border-2 border-border bg-surface px-3 text-lg focus:border-primary focus:outline-none";

export function AccountCard({
  auth,
  pending,
  onSignIn,
  onSignOut,
}: {
  auth: AuthState;
  pending: number;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "loading") return null;

  if (auth.status === "unavailable")
    return (
      <Card title="Akun" icon={CloudOff}>
        <p className="text-base text-muted">
          Mode lokal. Login belum disiapkan di aplikasi ini, jadi sesi hanya
          tersimpan di HP ini.
        </p>
      </Card>
    );

  if (auth.status === "in")
    return (
      <Card title="Akun" icon={Cloud}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold break-all">{auth.email}</div>
            <div className="text-sm text-muted">
              {pending
                ? `${pending} sesi menunggu dikirim ke server`
                : "Sesi dikirim ke server saat selesai"}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={onSignOut}>
            Keluar
          </Button>
        </div>
      </Card>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setError(await onSignIn(email.trim(), password));
    setPassword("");
    setBusy(false);
  };

  return (
    <Card title="Akun (opsional)" icon={CloudOff}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-base text-muted">
          Mode lokal: belum masuk, sesi hanya tersimpan di HP ini. Masuk untuk
          mengambil batas dari terapis dan mengirim sesi ke server.
        </p>
        <label className="block">
          <span className="mb-1 block text-base font-medium">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-base font-medium">Kata sandi</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
        </label>
        {error && (
          <p role="alert" className="text-base text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="xl" icon={LogIn} loading={busy}>
          Masuk
        </Button>
      </form>
    </Card>
  );
}
