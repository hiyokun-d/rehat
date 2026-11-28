// `bun x` does not forward environment variables into Prisma's config evaluation, so load .env
// here. dotenv never overrides a variable already set in the environment.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate, db push) needs the direct connection (port 5432); the app uses the pooled
// DATABASE_URL at runtime through the driver adapter in src/lib/prisma.ts.
// `prisma generate` needs no database, so a missing DIRECT_URL must not fail it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
