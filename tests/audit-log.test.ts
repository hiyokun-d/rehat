import { expect, test } from "bun:test";

// Dummy URL: the guard throws before any query, so nothing connects.
process.env.DATABASE_URL = "postgresql://user:pass@localhost:6543/none";

test("AuditLog rejects update and delete at app level", async () => {
  const { prisma } = await import("../src/lib/prisma");
  const id = "00000000-0000-4000-8000-000000000099";
  const calls = [
    async () => {
      await prisma.auditLog.update({ where: { id }, data: { action: "x" } });
    },
    async () => {
      await prisma.auditLog.delete({ where: { id } });
    },
    async () => {
      await prisma.auditLog.deleteMany();
    },
  ];
  for (const call of calls) {
    await expect(call()).rejects.toThrow("append-only");
  }
});
