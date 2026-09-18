import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The one unscoped Prisma client per process, connected as the runtime role dept_app
// (NOBYPASSRLS). Tenant-scoped access goes through src/lib/db/scoped.ts and tenant.ts
// (added in the tenancy phase); GLOBAL tables are read through this client directly.
const globalForPrisma = globalThis as unknown as { __prismaRoot?: PrismaClient };

/** Pool config for a schema: the adapter qualifies model queries, the search_path covers raw SQL. */
export function poolConfig(connectionString: string | undefined, schema: string, max: number) {
  return {
    connectionString,
    max,
    ...(schema === "public" ? {} : { options: `-c search_path="${schema}",public` }),
  };
}

function createClient(): PrismaClient {
  const schema = process.env.DATABASE_SCHEMA ?? "public";
  const adapter = new PrismaPg(
    poolConfig(process.env.DATABASE_URL, schema, Number(process.env.PG_POOL_MAX ?? 10)),
    {
      schema,
    },
  );
  return new PrismaClient({ adapter });
}

export const prismaRoot: PrismaClient = globalForPrisma.__prismaRoot ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaRoot = prismaRoot;
}
