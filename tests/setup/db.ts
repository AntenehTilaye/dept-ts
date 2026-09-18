import pg from "pg";
import { inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { requireEnv } from "./urls";

// Two clients bound to the per-run schema:
//   migratorDb - dept_migrator (BYPASSRLS): assertions that must see every row, resets, seeds
//   appDb      - dept_app (NOBYPASSRLS): the same construction as src/lib/db/prisma.ts
export const testSchema: string = inject("testSchema");

function client(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 4 }, { schema: testSchema }),
  });
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
    return fn(tx);
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
