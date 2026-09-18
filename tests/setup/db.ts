import pg from "pg";
import { inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { poolConfig } from "@/lib/db/prisma";
import type { Db } from "@/lib/db/types";
import { auditExtension } from "@/platform/audit/interceptor";
import { runWithAudit } from "@/platform/audit/context";
import { requireEnv } from "./urls";

// Two clients bound to the per-run schema:
//   migratorDb - dept_migrator (BYPASSRLS): assertions that must see every row, resets, seeds
//   appDb      - dept_app (NOBYPASSRLS): the same construction as src/lib/db/prisma.ts
export const testSchema: string = inject("testSchema");

function client(url: string): PrismaClient {
  // the app client carries the audit interceptor exactly like src/lib/db/prisma.ts
  return new PrismaClient({
    adapter: new PrismaPg(poolConfig(url, testSchema, 4), { schema: testSchema }),
  }).$extends(auditExtension) as unknown as PrismaClient;
}

export const migratorDb: PrismaClient = client(requireEnv("DATABASE_URL_MIGRATE"));
export const appDb: PrismaClient = client(requireEnv("DATABASE_URL"));

/** Runs `fn` as dept_app inside a transaction scoped to a department (transaction-local setting). */
export async function withDept<T>(
  departmentId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_department_id', ${departmentId}, true)`;
    return runWithAudit(
      { tx: tx as unknown as Db, departmentId, bypass: false },
      async () => await fn(tx),
    );
  });
}

/** Raw pg client on the per-run schema for privilege and catalogue assertions. */
export async function rawClient(role: "migrator" | "app" = "app"): Promise<pg.Client> {
  const c = new pg.Client({
    connectionString:
      role === "app" ? requireEnv("DATABASE_URL") : requireEnv("DATABASE_URL_MIGRATE"),
  });
  await c.connect();
  await c.query(`SET search_path TO "${testSchema}", public`);
  return c;
}
