import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { auditExtension } from "@/platform/audit/interceptor";

// The one unscoped Prisma client per process, connected as the runtime role dept_app
// (NOBYPASSRLS). Tenant-scoped access goes through src/lib/db/scoped.ts and tenant.ts;
// GLOBAL tables are read through this client directly.
//
// `prismaRoot` is a proxy over the current client so that a change of DATABASE_SCHEMA (the
// per-run schemas of the integration and worker test projects, which share one process for
// their global setup) transparently re-targets it. Production never changes the schema.

/** Pool config for a schema: the adapter qualifies model queries, the search_path covers raw SQL. */
export function poolConfig(connectionString: string | undefined, schema: string, max: number) {
  return {
    connectionString,
    max,
    ...(schema === "public" ? {} : { options: `-c search_path="${schema}",public` }),
  };
}

function createClient(schema: string): PrismaClient {
  const adapter = new PrismaPg(
    poolConfig(process.env.DATABASE_URL, schema, Number(process.env.PG_POOL_MAX ?? 10)),
    {
      schema,
    },
  );
  // The audit interceptor is part of the root client so every write path is covered.
  return new PrismaClient({ adapter }).$extends(auditExtension) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  __prismaRoot?: { schema: string; client: PrismaClient };
};

export function currentPrismaClient(): PrismaClient {
  const schema = process.env.DATABASE_SCHEMA ?? "public";
  const cached = globalForPrisma.__prismaRoot;
  if (cached && cached.schema === schema) return cached.client;
  const client = createClient(schema);
  globalForPrisma.__prismaRoot = { schema, client };
  return client;
}

export const prismaRoot: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = currentPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
