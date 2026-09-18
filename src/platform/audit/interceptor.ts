import { Prisma } from "@/generated/prisma/client";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { currentAudit } from "./context";
import { auditSubjectOf, IGNORED_FIELDS } from "./subjects";
import type { FieldChange } from "./record";

// Field-level audit as a Prisma query extension on the root client: every create/update/delete
// of an audited model records before/after values, the actor and correlation id from the
// ambient AuditContext, on the ambient transaction (withTenantTx, bypass, scoped client) or the
// root client when there is none. Excluded and unmapped models pass through untouched.

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

const WRITE_OPS = new Set([
  "create",
  "update",
  "delete",
  "upsert",
  "createMany",
  "createManyAndReturn",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

type Delegate = {
  findUnique(a: unknown): Promise<unknown>;
  findMany(a: unknown): Promise<unknown>;
};

function delegateOf(db: unknown, model: string): Delegate {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  return (db as Record<string, Delegate>)[name]!;
}

function diff(before: Row | null, after: Row | null): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    const b = before?.[k];
    const a = after?.[k];
    if (
      typeof b === "object" &&
      b !== null &&
      !(b instanceof Date) &&
      !Array.isArray(b) &&
      typeof a !== "object"
    )
      continue; // relations
    if (b instanceof Date || a instanceof Date) {
      if ((b instanceof Date ? b.getTime() : b) !== (a instanceof Date ? a.getTime() : a))
        out[k] = { before: b, after: a };
      continue;
    }
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { before: b, after: a };
  }
  return out;
}

function scalarsOnly(row: Row | null | undefined): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof Date) &&
      !Array.isArray(v) &&
      !(typeof (v as { toFixed?: unknown }).toFixed === "function")
    )
      continue;
    out[k] = v;
  }
  return out;
}

async function writeAudit(
  db: Db,
  model: string,
  action: "create" | "update" | "delete",
  before: Row | null,
  after: Row | null,
): Promise<void> {
  const mapping = auditSubjectOf(model);
  if (!mapping) return;
  const ctx = currentAudit();
  const row = after ?? before ?? {};
  const changes =
    action === "create"
      ? diff(null, after)
      : action === "delete"
        ? diff(before, null)
        : diff(before, after);
  if (action === "update" && Object.keys(changes).length === 0) return;
  const rowDept = typeof row.departmentId === "string" ? row.departmentId : null;
  await db.auditEvent.create({
    data: {
      departmentId: ctx?.tx ? (ctx.departmentId ?? rowDept) : ctx?.bypass ? rowDept : null,
      actorUserId: ctx?.actorUserId ?? null,
      action,
      subjectType: mapping.subjectType as never,
      subjectId: mapping.subjectId(row),
      fieldChangesJson: toJson(changes),
      correlationId: ctx?.correlationId ?? null,
      clientInfoJson: ctx?.clientInfo ? toJson(ctx.clientInfo) : undefined,
    },
  });
}

export const auditExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!WRITE_OPS.has(operation) || !auditSubjectOf(model)) return query(args);
          const ctx = currentAudit();
          const db = (ctx?.tx ?? client) as unknown as Db;
          const delegate = delegateOf(db, model);
          const a = args as Args;

          if (operation === "create") {
            const result = await query(args);
            await writeAudit(db, model, "create", null, scalarsOnly(result as Row));
            return result;
          }
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const result = await query(args);
            const rows =
              operation === "createManyAndReturn"
                ? (result as Row[])
                : (a.data as Row[] | Row) instanceof Array
                  ? (a.data as Row[])
                  : [a.data as Row];
            for (const r of rows) await writeAudit(db, model, "create", null, scalarsOnly(r));
            return result;
          }
          if (operation === "update" || operation === "delete" || operation === "upsert") {
            const before = scalarsOnly(
              (await delegate.findUnique({ where: a.where })) as Row | null,
            );
            const result = await query(args);
            if (operation === "delete") await writeAudit(db, model, "delete", before, null);
            else
              await writeAudit(
                db,
                model,
                before ? "update" : "create",
                before,
                scalarsOnly(result as Row),
              );
            return result;
          }
          // updateMany / deleteMany: before images by the same filter
          const befores = ((await delegate.findMany({ where: a.where })) as Row[]).map((r) =>
            scalarsOnly(r)!,
          );
          const result = await query(args);
          if (operation === "deleteMany") {
            for (const b of befores) await writeAudit(db, model, "delete", b, null);
            return result;
          }
          const ids = befores.map((b) => b.id).filter((id): id is string => typeof id === "string");
          const afters = ids.length
            ? ((await delegate.findMany({ where: { id: { in: ids } } })) as Row[])
            : [];
          const afterById = new Map(afters.map((r) => [r.id as string, scalarsOnly(r)!]));
          for (const b of befores) {
            const after = typeof b.id === "string" ? (afterById.get(b.id) ?? null) : null;
            if (after) await writeAudit(db, model, "update", b, after);
          }
          return result;
        },
      },
    },
  }),
);
