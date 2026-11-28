// DEMO DATA ONLY. Fills a staff account with 4 fictional patients and 28 days of SYNTHETIC sessions
// so the dashboard, the triage list and the Theil–Sen / SPARC numbers have something to show.
// Every number here is made up to exercise the UI, not measured on anyone. Names say "(demo)".
// Re-running replaces the previous demo patients of that nurse (matched by "(demo)" suffix).
//
//   bun --env-file=.env.local scripts/seed-demo.ts demo.perawat@rehat-demo.invalid
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "../src/generated/prisma/client";

const email = process.argv[2];
if (!email) throw new Error("Pakai: seed-demo.ts <email staf>");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
}).auth.admin;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL as string }),
});

const DAY = 86_400_000;
const now = Date.now();
// Deterministic pseudo-random so the demo looks the same every run.
let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

type Pattern = {
  name: string;
  /** days ago with a session */
  days: number[];
  base: number;
  slopePerDay: number;
  breachDays?: number[];
  cannotDays?: number[];
  help?: boolean;
  pendingAlert?: boolean;
};

const PATTERNS: Pattern[] = [
  {
    name: "Bu Sri (demo)",
    days: [0, 1, 2, 3, 5, 6, 8, 9, 10, 12, 14, 16, 19, 21, 23, 26],
    base: 70,
    slopePerDay: 0.6,
  },
  {
    name: "Pak Budi (demo)",
    days: [5, 6, 8, 10, 13, 15, 18, 22],
    base: 85,
    slopePerDay: -1.1, // older sessions higher -> recent peaks lower
    cannotDays: [5, 6],
  },
  {
    name: "Bu Wati (demo)",
    days: [0, 1, 2, 4, 6, 9, 11, 13, 16, 20],
    base: 95,
    slopePerDay: -0.2,
    breachDays: [0, 1, 2],
    pendingAlert: true,
    help: true,
  },
  { name: "Pak Joko (demo)", days: [], base: 0, slopePerDay: 0 },
];

async function main() {
  const staff = (await admin.listUsers({ perPage: 1000 })).data.users.find(
    (u) => u.email === email,
  );
  if (!staff)
    throw new Error("Staf tidak ditemukan. Jalankan make-staff.ts dulu.");
  const nurseId = staff.id;

  // Remove previous demo patients of this nurse.
  const old = await prisma.profile.findMany({
    where: { therapistId: nurseId, displayName: { endsWith: "(demo)" } },
    select: { id: true },
  });
  for (const o of old) {
    await prisma.auditLog
      .deleteMany({ where: { patientId: o.id } })
      .catch(() => {});
    await prisma.alert.deleteMany({ where: { patientId: o.id } });
    await prisma.rehabSession.deleteMany({ where: { patientId: o.id } });
    await prisma.program.deleteMany({ where: { patientId: o.id } });
    await prisma.profile.delete({ where: { id: o.id } });
    await admin.deleteUser(o.id).catch(() => {});
  }

  const ex = await prisma.exercise.findUniqueOrThrow({
    where: { slug: "shoulder-flexion" },
  });

  for (const p of PATTERNS) {
    const { data, error } = await admin.createUser({
      email: `p-${randomBytes(9).toString("hex")}@pasien.rehat.invalid`,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      app_metadata: { created_by: "seed-demo" },
    });
    if (error || !data.user) throw error;
    const pid = data.user.id;
    await prisma.profile.create({
      data: {
        id: pid,
        role: "PATIENT",
        displayName: p.name,
        therapistId: nurseId,
      },
    });
    const program = await prisma.program.create({
      data: {
        title: "Program lengan (demo)",
        active: true,
        patientId: pid,
        therapistId: nurseId,
      },
    });
    const pe = await prisma.planExercise.create({
      data: { position: 0, programId: program.id, exerciseId: ex.id },
    });
    if (p.name.startsWith("Pak Joko")) continue; // no envelope, no sessions -> flags show it
    // ILLUSTRATIVE limits, not clinical.
    await prisma.safetyEnvelope.create({
      data: {
        planExerciseId: pe.id,
        version: 1,
        maxAngleDeg: 100,
        maxVelDegPerS: 120,
        debounceMs: 300,
        onBreach: "CUE_AND_PAUSE",
        notifyCaregiver: true,
        createdById: nurseId,
      },
    });

    for (const d of p.days) {
      const startedAt = new Date(now - d * DAY - 3600_000 * (8 + rnd() * 6));
      const cannot = p.cannotDays?.includes(d);
      const breaches = p.breachDays?.includes(d)
        ? 1 + Math.floor(rnd() * 2)
        : 0;
      const sid = randomUUID();
      const peak = p.base - p.slopePerDay * d + (rnd() - 0.5) * 6;
      await prisma.rehabSession.create({
        data: {
          id: sid,
          status: cannot ? "CANNOT_DO" : "COMPLETED",
          reportedBy: rnd() < 0.3 ? "CAREGIVER" : "PATIENT",
          startedAt,
          endedAt: new Date(startedAt.getTime() + 300_000),
          envelopeVersion: 1,
          patientId: pid,
          reporterId: pid,
          planExerciseId: pe.id,
          ...(cannot
            ? {}
            : {
                attempt: {
                  create: {
                    reps: 8 + Math.floor(rnd() * 6),
                    activeMs: 180_000 + Math.floor(rnd() * 120_000),
                    maxAngleDeg: Math.round(peak * 10) / 10,
                    maxVelDegPerS: 60 + Math.round(rnd() * 50),
                    pauses: breaches ? 1 : 0,
                    sparcMedian: Math.round((-1.5 - rnd() * 1.2) * 100) / 100,
                    peakCv: Math.round(rnd() * 15) / 100,
                    peakTrendDeg: Math.round((rnd() - 0.5) * 10),
                  },
                },
              }),
          breaches: {
            create: Array.from({ length: breaches }, (_, i) => ({
              kind: "ANGLE" as const,
              value: 104 + i * 2,
              limit: 100,
              heldMs: 400,
              occurredAt: new Date(startedAt.getTime() + 60_000 * (i + 1)),
            })),
          },
        },
      });
      if (p.pendingAlert && d === 0)
        await prisma.alert.create({
          data: {
            level: "L2",
            status: "PENDING",
            patientId: pid,
            sessionId: sid,
          },
        });
    }
    if (p.help)
      await prisma.auditLog.create({
        data: {
          actorId: pid,
          patientId: pid,
          action: "help.request",
          entityType: "Profile",
          entityId: pid,
        },
      });
    console.log(`+ ${p.name}: ${p.days.length} sesi`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
