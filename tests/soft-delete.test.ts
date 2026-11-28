import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Dummy URL: the module builds its default client from it, but no test below connects.
process.env.DATABASE_URL = "postgresql://user:pass@localhost:6543/none";

const { SOFT_DELETED_MODELS, createPrismaClient } = await import(
  "../src/lib/prisma"
);

// Adapter that records SQL and returns no rows, so the extension runs without a database.
function recordingAdapter(sqls: string[]) {
  const adapter = {
    provider: "postgres" as const,
    adapterName: "recording",
    connect: async () => ({
      provider: "postgres" as const,
      adapterName: "recording",
      queryRaw: async (query: { sql: string }) => {
        sqls.push(query.sql);
        // count() needs one row back; 0 is ColumnTypeEnum.Int32.
        return /COUNT/i.test(query.sql)
          ? { columnNames: ["_count$_all"], columnTypes: [0], rows: [[0]] }
          : { columnNames: [], columnTypes: [], rows: [] };
      },
      executeRaw: async () => 0,
      executeScript: async () => {},
      startTransaction: async () => {
        throw new Error("not used");
      },
      dispose: async () => {},
    }),
  };
  return adapter as unknown as Parameters<typeof createPrismaClient>[0];
}

const ID = "00000000-0000-4000-8000-000000000001";

test("reads on soft-deletable models filter deletedAt IS NULL", async () => {
  const sqls: string[] = [];
  const prisma = createPrismaClient(recordingAdapter(sqls));
  await prisma.rehabSession.findMany();
  await prisma.rehabSession.findFirst({ where: { patientId: ID } });
  await prisma.profile.findUnique({ where: { id: ID } });
  await prisma.alert.count();
  expect(sqls).toHaveLength(4);
  for (const sql of sqls) expect(sql).toMatch(/"deletedAt" IS NULL/);
});

test("a caller cannot opt into deleted rows", async () => {
  const sqls: string[] = [];
  const prisma = createPrismaClient(recordingAdapter(sqls));
  await prisma.careLink.findMany({ where: { deletedAt: { not: null } } });
  expect(sqls[0]).toMatch(/"deletedAt" IS NULL/);
  expect(sqls[0]).not.toMatch(/"deletedAt" IS NOT NULL/);
});

test("models without deletedAt are not filtered", async () => {
  const sqls: string[] = [];
  const prisma = createPrismaClient(recordingAdapter(sqls));
  await prisma.exercise.findMany();
  expect(sqls[0]).not.toMatch(/deletedAt/);
});

test("SOFT_DELETED_MODELS matches the models with deletedAt in schema.prisma", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const withDeletedAt = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .filter(([, , body]) => /^\s+deletedAt\s/m.test(body))
    .map(([, name]) => name)
    .sort();
  expect([...SOFT_DELETED_MODELS].sort()).toEqual(withDeletedAt);
});
