// Server only. Uses the pooled DATABASE_URL (Supabase pgBouncer, port 6543) through the pg
// driver adapter that Prisma 7 requires. Named prisma.ts because src/lib/db.ts is the Dexie
// (IndexedDB) store used by the phone and screen UI.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

type Adapter = NonNullable<
  NonNullable<ConstructorParameters<typeof PrismaClient>[0]>["adapter"]
>;

// Models with a deletedAt column (schema.prisma). tests/soft-delete.test.ts fails when this
// list and the schema drift apart.
export const SOFT_DELETED_MODELS: ReadonlySet<string> = new Set([
  "Profile",
  "CareLink",
  "EmergencyContact",
  "Program",
  "PlanExercise",
  "RehabSession",
  "AttemptSummary",
  "BreachEvent",
  "Alert",
  "ScheduledSession",
  "Feedback",
  "TherapistReview",
]);

const SOFT_DELETE_READS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
]);

function rejectAuditLogWrite(): never {
  throw new Error("AuditLog bersifat append-only: update dan delete ditolak.");
}

// shortcut: top-level reads only. Nested include/select on a relation, aggregate and
// groupBy are not filtered; add them when a caller needs them.
export function createPrismaClient(adapter: Adapter) {
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (
            !SOFT_DELETED_MODELS.has(model) ||
            !SOFT_DELETE_READS.has(operation)
          )
            return query(args);
          const { where, ...rest } = args as { where?: object };
          return query({ ...rest, where: { ...where, deletedAt: null } });
        },
      },
      auditLog: {
        update: rejectAuditLogWrite,
        updateMany: rejectAuditLogWrite,
        upsert: rejectAuditLogWrite,
        delete: rejectAuditLogWrite,
        deleteMany: rejectAuditLogWrite,
      },
    },
  });
}

function fromEnv() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL belum diisi. Lihat .env.example.");
  }
  return createPrismaClient(new PrismaPg({ connectionString }));
}

// Hot reload re-evaluates this module; keep one client on globalThis so dev does not
// open a new connection pool on every save.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

globalForPrisma.prisma ??= fromEnv();
export const prisma = globalForPrisma.prisma;
