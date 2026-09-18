import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prismaRoot } from "./prisma";
import { SHARED_MODELS, TENANT_MODELS } from "./tenancy-manifest";

// Department-scoped Prisma client.
//
// Row-level security is the boundary: every operation runs inside a transaction that first sets
// the transaction-local `app.current_department_id`, so the dept_app role only ever sees (and
// can only write) the active department's rows plus faculty-wide (NULL) rows of shared tables.
// The extension is a convenience on top of that: it injects `departmentId` into writes of
// tenant and shared models and rejects a foreign department id before it reaches the database.
// Nested writes and raw SQL are protected by RLS, not by this extension.

export class TenantMismatchError extends Error {
  constructor(
    readonly model: string,
    readonly expected: string,
    readonly received: unknown,
  ) {
    super(
      `${model}: departmentId "${String(received)}" does not match the active department "${expected}"`,
    );
    this.name = "TenantMismatchError";
  }
}

type AnyArgs = Record<string, unknown> | undefined;

function injectInto(
  record: Record<string, unknown>,
  model: string,
  departmentId: string,
  allowNull: boolean,
): void {
  if (!("departmentId" in record) || record.departmentId === undefined) {
    record.departmentId = departmentId;
    return;
  }
  if (record.departmentId === null && allowNull) return;
  if (record.departmentId !== departmentId)
    throw new TenantMismatchError(model, departmentId, record.departmentId);
}

/**
 * Adds `departmentId` to the data of create / createMany / upsert (and rejects a foreign one).
 * Exported for unit tests; the extension calls it for tenant and shared models only.
 */
export function injectDepartmentId(
  model: string,
  operation: string,
  args: AnyArgs,
  departmentId: string,
): AnyArgs {
  if (!args) return args;
  const allowNull = SHARED_MODELS.has(model) && !TENANT_MODELS.has(model);
  const data = args.data;
  switch (operation) {
    case "create":
    case "update":
    case "updateMany":
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (operation === "create" || "departmentId" in data)
      ) {
        injectInto(data as Record<string, unknown>, model, departmentId, allowNull);
      }
      break;
    case "createMany":
    case "createManyAndReturn":
      if (Array.isArray(data)) {
        for (const row of data)
          injectInto(row as Record<string, unknown>, model, departmentId, allowNull);
      } else if (data && typeof data === "object") {
        injectInto(data as Record<string, unknown>, model, departmentId, allowNull);
      }
      break;
    case "upsert":
      if (args.create && typeof args.create === "object") {
        injectInto(args.create as Record<string, unknown>, model, departmentId, allowNull);
      }
      if (
        args.update &&
        typeof args.update === "object" &&
        "departmentId" in (args.update as object)
      ) {
        injectInto(args.update as Record<string, unknown>, model, departmentId, allowNull);
      }
      break;
    default:
      break;
  }
  return args;
}

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Prisma client extension: scope every model operation of the given department. */
export function forDepartment(departmentId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: `dept:${departmentId}`,
      query: {
        // Raw queries carry no model: run them inside a department transaction too.
        async $allOperations({ model, operation, args, query }) {
          if (model) return query(args);
          return client.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_department_id', ${departmentId}, true)`;
            const raw = tx as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
            const fn = raw[operation];
            if (!fn) throw new Error(`Unsupported raw operation ${operation}`);
            return Array.isArray(args) ? fn.call(tx, ...args) : fn.call(tx, args);
          });
        },
        $allModels: {
          async $allOperations({ model, operation, args }) {
            const scoped = TENANT_MODELS.has(model) || SHARED_MODELS.has(model);
            const finalArgs = scoped
              ? injectDepartmentId(model, operation, args as AnyArgs, departmentId)
              : args;
            return client.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.current_department_id', ${departmentId}, true)`;
              const delegate = (
                tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>
              )[delegateName(model)];
              if (!delegate) throw new Error(`No delegate for model ${model}`);
              return delegate[operation]!(finalArgs);
            });
          },
        },
      },
    }),
  );
}

export type ScopedClient = ReturnType<typeof scopedClient>;

/** A department-scoped client over the process-wide root client. */
export function scopedClient(departmentId: string, base: PrismaClient = prismaRoot) {
  return base.$extends(forDepartment(departmentId));
}

const scopedCache = new Map<string, ScopedClient>();

/** Request-cached scoped client for a department id (Server Components; actions use withTenantTx). */
export function getDb(departmentId: string): ScopedClient {
  let db = scopedCache.get(departmentId);
  if (!db) {
    db = scopedClient(departmentId);
    scopedCache.set(departmentId, db);
  }
  return db;
}
