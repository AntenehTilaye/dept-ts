import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: the datasource URL lives here, not in schema.prisma. The CLI (migrate, db seed,
// studio) runs as the owner role dept_migrator (BYPASSRLS); the runtime client in
// src/lib/db/prisma.ts uses DATABASE_URL (dept_app, NOBYPASSRLS).
export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL_MIGRATE"),
  },
});
