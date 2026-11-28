"use client";
// The landing page (/) — for the nurse, therapist or trained volunteer.
// Two layouts picked by screen width (useIsDesktop, 1024 px):
// - phone: one work list, most urgent first, plain words, one-tap actions. Needs nothing else:
//   no laptop, no pairing. Shows the last cached list instantly, then refreshes.
// - desktop: the same data plus every column, sortable, with 28-day trends per exercise and the
//   full patient view beside it.
// Both read ONE endpoint (/api/overview) computed by src/lib/care/triage.ts, and listen on the
// nurse's private staff:<id> channel for help requests from any of their patients.
//
// Many patients at once: each patient has their own live room (patient:<id>), opened only while
// that patient is open. Nothing from one patient can show up under another.
import {
  FlaskConical,
  HandHelping,
  LogIn,
  LogOut,
  Plus,
  Search,
  Smartphone,
  UserPlus,
  Users,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { signInTherapist, signOutTherapist } from "@/app/screen/_lib/auth";
import { HowItWorks } from "@/components/care/HowItWorks";
import { LiveDot } from "@/components/care/Motion";
import { StrokeWarning } from "@/components/care/StrokeWarning";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { Tabs } from "@/components/ui/Tabs";
import { deviceLabel, getDeviceIdentity, newId } from "@/lib/device";
import type { LivePeer } from "@/lib/live/protocol";
import { api, type DashError } from "./_lib/api";
import { clearOverviewCache, useOverview } from "./_lib/useOverview";
import { useIsDesktop } from "./_lib/useScreen";
import { DesktopHome } from "./DesktopHome";
import { MobileHome } from "./MobileHome";
import { PatientView, type Tab } from "./PatientView";

const field =
  "h-12 w-full rounded-(--radius-control) border-2 border-border bg-surface px-3 text-lg focus:border-primary focus:outline-none";

type Auth =
  | { kind: "loading" }
  | { kind: "out" }
  | { kind: "forbidden" }
  | { kind: "in"; id: string; name: string };

/** First screen of a new nurse: what to do, in order, with the add-patient form right there. */
function GettingStarted({ children }: { children: React.ReactNode }) {
  const steps = [
    ["Tambah pasien", "Cukup nama. Pasien tidak perlu email."],
    [
      "Atur program dan batas",
      "Masukkan batas sudut dan kecepatan dari terapis pasien.",
    ],
    [
      "Sambungkan HP pasien",
      "Tampilkan QR atau kode 8 huruf, pasien pindai atau ketik.",
    ],
  ];
  return (
    <Card title="Mulai di sini" icon={Users}>
      <ol className="mb-4 grid gap-3 sm:grid-cols-3">
        {steps.map(([t, d], i) => (
          <motion.li
            key={t}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="rounded-(--radius-control) bg-surface-2 p-3"
          >
            <div className="mb-1 flex size-8 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-fg">
              {i + 1}
            </div>
            <div className="text-base font-semibold">{t}</div>
            <div className="text-sm text-muted">{d}</div>
          </motion.li>
        ))}
      </ol>
      <div className="max-w-md">{children}</div>
    </Card>
  );
}

type AuthMode = "in" | "up";

/** Sign in, or (hackathon) register as a nurse. Same card so nobody has to hunt for the link. */
function LoginCard({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<AuthMode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "up") {
        const res = await fetch("/api/staff/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            displayName: name,
            email,
            password,
            attest,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErr((b as { error?: string }).error ?? "Pendaftaran gagal.");
          return;
        }
      }
      const m = await signInTherapist(email, password);
      if (m) setErr(m);
      else {
        setPassword("");
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={mode === "in" ? "Masuk sebagai perawat" : "Daftar sebagai perawat"}
      icon={mode === "in" ? LogIn : UserPlus}
    >
      <Tabs<AuthMode>
        items={[
          { id: "in", label: "Masuk" },
          { id: "up", label: "Daftar baru" },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setErr(null);
        }}
      />
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === "up" && (
          <label className="block">
            <span className="mb-1 block text-base font-medium">Nama</span>
            <input
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              placeholder="Ners Ani"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-base font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete={mode === "in" ? "username" : "email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-base font-medium">Kata sandi</span>
          <input
            type="password"
            required
            minLength={mode === "up" ? 10 : undefined}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          {mode === "up" && (
            <span className="mt-1 block text-sm text-muted">
              Minimal 10 karakter.
            </span>
          )}
        </label>
        {mode === "up" && (
          <label className="flex items-start gap-3 rounded-(--radius-control) bg-warning-soft p-3 text-base">
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-(--color-primary)"
            />
            <span>
              Saya perawat, terapis, atau pendamping terlatih. Batas latihan
              yang saya masukkan berasal dari terapis pasien, bukan tebakan
              saya.
            </span>
          </label>
        )}
        {err && (
          <p role="alert" className="text-base text-danger">
            {err}
          </p>
        )}
        <Button
          type="submit"
          size="xl"
          icon={mode === "in" ? LogIn : UserPlus}
          loading={busy}
          disabled={mode === "up" && !attest}
        >
          {mode === "in" ? "Masuk" : "Daftar dan masuk"}
        </Button>
        {mode === "in" && (
          <p className="text-sm text-muted">
            Belum punya akun?{" "}
            <button
              type="button"
              onClick={() => setMode("up")}
              className="font-medium text-primary underline"
            >
              Daftar sebagai perawat
            </button>
          </p>
        )}
      </form>
    </Card>
  );
}

function NewPatient({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const p = await api.newPatient(name.trim());
          setName("");
          onCreated(p.id);
        } catch (x) {
          setErr((x as DashError).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        required
        maxLength={80}
        placeholder="Nama pasien (boleh nama panggilan)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={field}
        aria-label="Nama pasien baru"
      />
      <Button type="submit" icon={Plus} loading={busy} disabled={!name.trim()}>
        Tambah
      </Button>
      {err && <p className="text-base text-danger">{err}</p>}
    </form>
  );
}

export function DashboardApp() {
  const [auth, setAuth] = useState<Auth>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [q, setQ] = useState("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  const checkAuth = useCallback(async () => {
    try {
      const me = await api.me();
      if (me.role !== "THERAPIST") return setAuth({ kind: "forbidden" });
      setAuth({ kind: "in", id: me.id, name: me.displayName });
    } catch (x) {
      const s = (x as DashError).status;
      setAuth(s === 403 ? { kind: "forbidden" } : { kind: "out" });
    }
  }, []);

  useEffect(() => {
    checkAuth();
    // Per TAB id: two dashboard tabs of one browser must not share one presence key.
    getDeviceIdentity()
      .then((d) => setDeviceId(`${d.id}:${newId().slice(0, 8)}`))
      .catch(() => setDeviceId(newId()));
    const h = new URLSearchParams(location.search).get("p");
    if (h) setSelected(h);
  }, [checkAuth]);

  const me: LivePeer | null = useMemo(
    () =>
      deviceId && auth.kind === "in"
        ? {
            deviceId,
            role: "screen",
            label: `Dashboard · ${deviceLabel()}`,
            account: "THERAPIST",
          }
        : null,
    [deviceId, auth.kind],
  );

  const ov = useOverview(auth.kind === "in" ? auth.id : null, me);
  const rows = ov.rows ?? [];
  const shown = rows.filter((p) =>
    p.displayName.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const open = useCallback((id: string, t: Tab = "live") => {
    setSelected(id);
    setTab(t);
    // Phone: the detail replaces the list, start at the top. Desktop scrolls to the detail itself.
    if (!window.matchMedia("(min-width: 1024px)").matches)
      window.scrollTo({ top: 0 });
  }, []);

  const right =
    auth.kind === "in" ? (
      <>
        <span className="hidden text-base text-muted sm:inline">
          {auth.name}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={LogOut}
          onClick={async () => {
            await signOutTherapist();
            clearOverviewCache();
            setSelected(null);
            setAuth({ kind: "out" });
          }}
        >
          Keluar
        </Button>
      </>
    ) : null;

  const tools = (
    <div className="space-y-3">
      <NewPatient
        onCreated={(id) => {
          ov.refresh();
          open(id, "program");
        }}
      />
      {rows.length > 5 && (
        <label className="relative block">
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari pasien"
            aria-label="Cari pasien"
            className={`${field} pl-10`}
          />
        </label>
      )}
    </div>
  );

  // Time of day is read after mount: during prerender there is no "now" (cacheComponents).
  const [greet, setGreet] = useState("Halo");
  useEffect(() => {
    const h = new Date().getHours();
    setGreet(
      h < 11
        ? "Selamat pagi"
        : h < 15
          ? "Selamat siang"
          : h < 18
            ? "Selamat sore"
            : "Selamat malam",
    );
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Screen
        title="Rehat"
        subtitle="Pemantauan latihan stroke di rumah untuk perawat dan pendamping terlatih"
        right={right}
        wide={isDesktop === true}
      >
        {auth.kind === "loading" && <p className="text-muted">Memuat...</p>}
        {auth.kind === "out" && (
          <div className="mx-auto grid max-w-5xl items-start gap-4 lg:grid-cols-[1fr_420px]">
            <div className="order-2 space-y-4 lg:order-1">
              <h2 className="text-3xl font-semibold leading-tight">
                Latihan stroke di rumah, dipantau dari HP perawat.
              </h2>
              <p className="text-lg text-muted">
                HP pasien menjadi sensor gerak. Batas latihan dari terapis dicek
                langsung di HP. Perawat melihat siapa yang perlu dibantu dulu.
              </p>
              <HowItWorks />
            </div>
            <div className="order-1 space-y-4 lg:order-2">
              <LoginCard onDone={checkAuth} />
              <Card title="Pasien atau pendamping?" icon={Smartphone}>
                <p className="text-base">
                  Buka halaman HP, lalu pindai QR dari perawat. Tidak perlu
                  email.
                </p>
                <Link
                  href="/phone"
                  className="mt-3 inline-flex h-12 items-center gap-2 rounded-(--radius-control) bg-primary px-4 text-lg font-semibold text-primary-fg"
                >
                  <Smartphone size={20} aria-hidden /> Buka halaman HP
                </Link>
              </Card>
              <StrokeWarning compact />
            </div>
          </div>
        )}
        {auth.kind === "forbidden" && (
          <div className="mx-auto max-w-md space-y-4">
            <Alert tone="info" title="Ini akun pasien">
              Dashboard untuk perawat. Latihan pasien ada di halaman HP.
            </Alert>
            <Link
              href="/phone"
              className="flex h-14 items-center justify-center gap-2 rounded-(--radius-control) bg-primary text-lg font-semibold text-primary-fg hover:bg-primary-hover"
            >
              <Smartphone size={20} aria-hidden /> Buka halaman latihan
            </Link>
            <Button
              variant="secondary"
              className="w-full"
              icon={LogOut}
              onClick={async () => {
                await signOutTherapist();
                setAuth({ kind: "out" });
              }}
            >
              Keluar, masuk sebagai perawat
            </Button>
          </div>
        )}

        {auth.kind === "in" && (
          <div className="space-y-4">
            {!selected && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xl font-semibold">
                  {greet}, {auth.name}
                </p>
                <span className="inline-flex items-center gap-2 text-sm text-muted">
                  <LiveDot on={ov.liveState === "open"} />
                  {ov.liveState === "open" ? "Siaga bantuan" : "Menyambung..."}
                </span>
              </div>
            )}
            {ov.ping && (
              <Alert
                tone="danger"
                title={`${ov.ping.displayName} minta bantuan`}
                icon={HandHelping}
              >
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    onClick={() => {
                      open(ov.ping?.patientId ?? "", "message");
                      ov.clearPing();
                    }}
                  >
                    Buka dan kirim pesan
                  </Button>
                  <Button variant="ghost" onClick={ov.clearPing}>
                    Tutup
                  </Button>
                </div>
              </Alert>
            )}
            {ov.error && !ov.rows && (
              <Alert tone="warning" title="Data belum bisa dimuat">
                {ov.error}
              </Alert>
            )}
            {ov.rows === null && !ov.error && (
              <p className="text-muted">Memuat pasien...</p>
            )}

            {ov.rows && rows.length === 0 && !q && !selected && (
              <GettingStarted>{tools}</GettingStarted>
            )}
            {isDesktop === false &&
              !(ov.rows && rows.length === 0 && !q && !selected) &&
              (selected && me ? (
                <PatientView
                  key={`${selected}:${tab}`}
                  patientId={selected}
                  me={me}
                  initialTab={tab}
                  onBack={() => {
                    setSelected(null);
                    ov.refresh();
                  }}
                  onAlertsChanged={ov.refresh}
                />
              ) : (
                ov.rows && (
                  <>
                    <MobileHome
                      rows={shown}
                      onOpen={open}
                      onChanged={ov.refresh}
                      fetchedAt={ov.fetchedAt}
                      fromCache={ov.fromCache}
                    />
                    <Card title="Tambah pasien" icon={Users}>
                      {tools}
                    </Card>
                    <StrokeWarning compact />
                  </>
                )
              ))}

            {isDesktop === true && ov.rows && rows.length > 0 && (
              <>
                <div className="grid grid-cols-[1fr_420px] items-start gap-4">
                  <p className="text-base text-muted">
                    {rows.length} pasien. Klik baris untuk detail, grafik tren,
                    live, program, pesan dan QR.
                  </p>
                  <Card title="Tambah / cari pasien" icon={Users}>
                    {tools}
                  </Card>
                </div>
                <DesktopHome
                  rows={shown}
                  selected={selected}
                  tab={tab}
                  onOpen={open}
                  onClose={() => setSelected(null)}
                  onChanged={ov.refresh}
                  me={me}
                  fetchedAt={ov.fetchedAt}
                />
              </>
            )}
          </div>
        )}

        <footer className="flex items-center justify-between pt-6 text-sm text-muted">
          <span>
            Bukan alat diagnosis. Batas latihan ditetapkan terapis per pasien.
          </span>
          {/* Mode 2 (gesture / sign language) is a lab experiment, kept out of the main flow. */}
          {auth.kind === "in" && (
            <Link
              href="/lab"
              className="inline-flex items-center gap-1 rounded-lg p-2 text-muted/70 hover:bg-surface-2 hover:text-muted"
              aria-label="Lab eksperimen"
              title="Lab eksperimen"
            >
              <FlaskConical size={16} aria-hidden />
            </Link>
          )}
        </footer>
      </Screen>
    </MotionConfig>
  );
}
