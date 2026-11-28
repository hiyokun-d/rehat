"use client";
// Two small pieces of the phone's start screen:
// - LinkSignIn: the nurse's QR opens /phone#link=<token>; one tap signs this phone in as the
//   patient (no email, no password). The token sits in the URL fragment, which browsers never
//   send to a server, and is removed from the address bar right after use.
// - PlacementPicker: where this phone is strapped. Several phones on one patient each pick
//   their own place, so the dashboard can tell them apart.
import { LogIn, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  normalizePlacement,
  type Placement,
  SEGMENTS,
  type Segment,
  type Side,
} from "@/lib/live/placement";
import { createClient } from "@/lib/supabase/client";

function readLinkToken(): string | null {
  const m = /(?:^|[#&])link=([A-Za-z0-9_\-.]+)/.exec(location.hash);
  return m ? m[1] : null;
}

function clearHash() {
  history.replaceState(null, "", location.pathname + location.search);
}

/**
 * QR token or typed code -> one-time hash from the server -> Supabase session on this phone.
 * The secret never goes in a URL query or a log; the hash is used once by verifyOtp.
 */
async function claimAndSignIn(
  body: { token: string } | { code: string },
  signedIn: boolean,
) {
  const res = await fetch("/api/device-link/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Gagal masuk.");
  const supabase = createClient();
  // A previous login on this phone (another patient) must not linger.
  if (signedIn) await supabase.auth.signOut().catch(() => {});
  const { error } = await supabase.auth.verifyOtp({
    token_hash: out.tokenHash,
    type: "magiclink",
  });
  if (error) throw new Error("Gagal masuk. Minta kode baru ke perawat.");
}

/** "k7qm3x" -> "K7QM-3X". Letters the code never uses (0, O, 1, I, L) are dropped as typed. */
function formatCode(raw: string): string {
  const c = raw
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "")
    .slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Sign in by typing the 8-symbol code shown under the nurse's QR. */
export function CodeSignIn({ signedIn }: { signedIn: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = code.length === 9;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      await claimAndSignIn({ code }, signedIn);
      setCode("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="block">
        <span className="mb-1 block text-base font-medium">
          Kode dari perawat
        </span>
        <input
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          aria-describedby="code-help"
          className="h-16 w-full rounded-(--radius-control) border-2 border-border bg-surface px-3 text-center font-mono text-3xl tracking-widest focus:border-primary focus:outline-none"
        />
      </label>
      <p id="code-help" className="text-sm text-muted">
        8 huruf/angka di bawah QR di HP perawat. Berlaku 10 menit.
      </p>
      {err && <Alert tone="danger" title={err} />}
      <Button
        type="submit"
        size="xl"
        icon={LogIn}
        loading={busy}
        disabled={!ready}
      >
        Masuk
      </Button>
    </form>
  );
}

export function LinkSignIn({ signedIn }: { signedIn: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => setToken(readLinkToken()), []);
  if (!token || done) return null;

  const claim = async () => {
    setBusy(true);
    setErr(null);
    try {
      await claimAndSignIn({ token }, signedIn);
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      clearHash(); // used or not, the token is worthless now; do not keep it around
      setBusy(false);
    }
  };

  return (
    <Card title="QR dari perawat" icon={LogIn}>
      <p className="mb-3 text-lg">
        HP ini akan masuk sebagai pasien. Latihan dan batas dari terapis
        tersambung otomatis.
      </p>
      {signedIn && (
        <p className="mb-3 text-base text-muted">
          Akun yang sekarang masuk di HP ini akan diganti.
        </p>
      )}
      {err && (
        <div className="mb-3">
          <Alert tone="danger" title={err} />
        </div>
      )}
      {!err && (
        <Button size="xl" icon={LogIn} loading={busy} onClick={claim}>
          Masuk sebagai pasien
        </Button>
      )}
    </Card>
  );
}

const LIMB_SEGMENTS: Segment[] = [
  "upper-arm",
  "forearm",
  "hand",
  "thigh",
  "shank",
  "foot",
];
const AXIAL_SEGMENTS: Segment[] = ["trunk", "head"];

export function PlacementPicker({
  value,
  onChange,
}: {
  value: Placement | null;
  onChange: (p: Placement) => void;
}) {
  const side: Side = value?.side && value.side !== "C" ? value.side : "R";
  const pick = (segment: Segment, s: Side = side) =>
    onChange(normalizePlacement({ segment, side: s }));
  const chip = (active: boolean) =>
    `min-h-12 rounded-(--radius-control) border-2 px-3 text-base font-medium transition-colors ${
      active
        ? "border-primary bg-primary-soft text-text"
        : "border-border bg-surface text-muted hover:text-text"
    }`;
  return (
    <Card title="HP ini dipasang di mana?" icon={MapPin}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(["L", "R"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={chip(
              side === s && !SEGMENTS[value?.segment ?? "forearm"].axial,
            )}
            onClick={() =>
              pick(
                value && !SEGMENTS[value.segment].axial
                  ? value.segment
                  : "upper-arm",
                s,
              )
            }
          >
            Sisi {s === "L" ? "kiri" : "kanan"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[...LIMB_SEGMENTS, ...AXIAL_SEGMENTS].map((seg) => (
          <button
            key={seg}
            type="button"
            aria-pressed={value?.segment === seg}
            className={chip(value?.segment === seg)}
            onClick={() => pick(seg)}
          >
            {SEGMENTS[seg].label}
            {SEGMENTS[seg].experimental && (
              <span className="ml-1 align-middle">
                <Badge tone="warning">eksp.</Badge>
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        Latihan yang sudah diuji tim: lengan atas (fleksi bahu) dan lengan bawah
        (fleksi siku). Letak lain masih eksperimen. Beberapa HP boleh dipakai
        bersamaan, satu HP per letak.
      </p>
    </Card>
  );
}
