import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The one unscoped Prisma client per process, connected as the runtime role dept_app
// (NOBYPASSRLS). Tenant-scoped access goes through src/lib/db/scoped.ts and tenant.ts
// (added in the tenancy phase); GLOBAL tables are read through this client directly.
const globalForPrisma = globalThis as unknown as { __prismaRoot?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    },
    { schema: process.env.DATABASE_SCHEMA ?? "public" },
  );
  return new PrismaClient({ adapter });
}

export const prismaRoot: PrismaClient = globalForPrisma.__prismaRoot ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaRoot = prismaRoot;
}
