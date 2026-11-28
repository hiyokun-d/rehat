// Owner-only setup. Creates (or promotes) a nurse / therapist account and makes sure the exercise
// catalog exists. Run on your own machine with the service-role key in .env.local:
//
//   bun --env-file=.env.local scripts/make-staff.ts nurse@example.org "Ners Ani"
//
// Prints a generated password ONCE. Nobody can become staff by signing up (docs/ACCOUNT-SETUP.md):
// the THERAPIST role is only ever written here or in SQL by the owner, and only for people who set
// limits under a clinician's direction.
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "../src/generated/prisma/client";

const [email, displayName = "Tenaga kesehatan"] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error(
    'Pakai: bun --env-file=.env.local scripts/make-staff.ts <email> "<nama>"',
  );
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = process.env.DIRECT_URL;
if (!url || !key || !db)
  throw new Error("Env Supabase belum lengkap (.env.local).");

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
}).auth.admin;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db }),
});

// Catalog = WHAT an exercise is. HOW FAR a patient may go is the therapist's envelope, per patient.
const CATALOG = [
  {
    slug: "shoulder-flexion",
    name: "Fleksi bahu",
    description:
      "HP di sisi luar lengan atas. Angkat lengan ke depan lalu turunkan.",
  },
  {
    slug: "elbow-flexion",
    name: "Fleksi siku (lengan atas di meja)",
    description:
      "Lengan atas bersandar di meja, HP di lengan bawah. Tekuk lalu luruskan siku.",
  },
];

async function main() {
  for (const c of CATALOG)
    await prisma.exercise.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description },
      create: c,
    });

  // Find or create the auth user.
  let userId: string | null = null;
  for (let page = 1; page < 50 && !userId; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  let password: string | null = null;
  if (!userId) {
    password = randomBytes(12).toString("base64url");
    const { data, error } = await admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { created_by: "make-staff" },
    });
    if (error || !data.user) throw error ?? new Error("createUser gagal");
    userId = data.user.id;
  }

  const existing = await prisma.profile.findUnique({ where: { id: userId } });
  if (existing?.therapistId)
    throw new Error(
      "Akun ini terdaftar sebagai pasien milik terapis lain. Tidak diubah.",
    );
  await prisma.profile.upsert({
    where: { id: userId },
    update: { role: "THERAPIST", displayName, therapistId: null },
    create: { id: userId, role: "THERAPIST", displayName },
  });
  await prisma.auditLog.create({
    data: {
      actorId: null,
      patientId: null,
      action: "profile.role_therapist",
      entityType: "Profile",
      entityId: userId,
      metadata: { via: "scripts/make-staff.ts" },
    },
  });
  console.log(`Staf siap: ${email} (${displayName})`);
  if (password)
    console.log(
      `Kata sandi (simpan sekarang, tidak ditampilkan lagi): ${password}`,
    );
  else console.log("Akun sudah ada; kata sandi tidak diubah.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
