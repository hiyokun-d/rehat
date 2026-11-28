// Demo data. Run with `bun run db:seed` once the database exists.
// Profile.id must equal an auth.users id: create the two users in Supabase Dashboard >
// Authentication > Users, then replace these UUIDs with theirs before seeding.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const THERAPIST_ID = "00000000-0000-4000-8000-000000000001";
const PATIENT_ID = "00000000-0000-4000-8000-000000000002";
const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";

const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL belum diisi. Lihat .env.example.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const CATALOG = [
  { slug: "shoulder-flexion", name: "Fleksi bahu" },
  { slug: "elbow-flexion", name: "Fleksi siku (lengan atas di meja)" },
];

// contoh, bukan nilai klinis: the therapist sets real limits per patient and per exercise.
const PLAN = [
  {
    id: "00000000-0000-4000-8000-000000000021",
    slug: "shoulder-flexion",
    envelope: { maxAngleDeg: 90, maxVelDegPerS: 120, debounceMs: 300 },
  },
  {
    id: "00000000-0000-4000-8000-000000000022",
    slug: "elbow-flexion",
    envelope: { maxAngleDeg: 100, maxVelDegPerS: 100, debounceMs: 300 },
  },
];

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "1")
    throw new Error("Seed hanya untuk demo. Set ALLOW_DEMO_SEED=1.");

  const catalog = new Map<string, string>();
  for (const item of CATALOG) {
    const row = await prisma.exercise.upsert({
      where: { slug: item.slug },
      update: {},
      create: item,
    });
    catalog.set(row.slug, row.id);
  }

  await prisma.profile.upsert({
    where: { id: THERAPIST_ID },
    update: {},
    create: {
      id: THERAPIST_ID,
      role: "THERAPIST",
      displayName: "Terapis Demo",
    },
  });
  await prisma.profile.upsert({
    where: { id: PATIENT_ID },
    update: {},
    create: {
      id: PATIENT_ID,
      role: "PATIENT",
      displayName: "Pasien Demo",
      therapistId: THERAPIST_ID,
    },
  });
  await prisma.program.upsert({
    where: { id: PROGRAM_ID },
    update: {},
    create: {
      id: PROGRAM_ID,
      title: "Program demo",
      active: true,
      patientId: PATIENT_ID,
      therapistId: THERAPIST_ID,
    },
  });

  for (const [position, { id, slug, envelope }] of PLAN.entries()) {
    const exerciseId = catalog.get(slug);
    if (!exerciseId)
      throw new Error(`Latihan katalog tidak ditemukan: ${slug}`);
    await prisma.planExercise.upsert({
      where: { id },
      update: {},
      create: {
        id,
        position,
        programId: PROGRAM_ID,
        exerciseId,
        envelopes: {
          create: {
            ...envelope,
            version: 1,
            onBreach: "CUE_AND_PAUSE",
            notifyCaregiver: true,
            createdById: THERAPIST_ID,
          },
        },
      },
    });
  }
}

main().finally(() => prisma.$disconnect());
