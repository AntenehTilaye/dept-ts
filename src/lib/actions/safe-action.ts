import "server-only";
import { z, type ZodType } from "zod";
import {
  ForbiddenError,
  requireAdmin,
  requireCan,
  requireDeptContext,
  UnauthenticatedError,
  type Ctx,
  type DeptCtx,
} from "../auth/require";
import { withTenantTx, type TxClient } from "../db/tenant";
import { TenantMismatchError } from "../db/scoped";
import type { SubjectRef } from "@/platform/identity/can";
import type { ActionVerb } from "@/platform/identity/levels";

// Server-action wrappers. Every department action: Zod-validated input carrying the `dept`
// slug -> requireDeptContext -> optional permission check -> handler inside one department
// transaction. Errors are mapped to a result object (never thrown to the client), except
// Next.js control-flow errors (redirect/notFound), which are re-thrown.

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "unauthenticated" | "forbidden" | "validation" | "conflict" | "error";
      message: string;
      issues?: Record<string, string[]>;
    };

export interface DeptActionOptions<I> {
  permission?: string;
  verb?: ActionVerb;
  subject?: (input: I) => SubjectRef | undefined;
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export function mapActionError(error: unknown): ActionResult<never> {
  if (isNextControlFlow(error)) throw error;
  if (error instanceof UnauthenticatedError)
    return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  if (error instanceof ForbiddenError || error instanceof TenantMismatchError) {
    return { ok: false, code: "forbidden", message: error.message };
  }
  const code = (error as { code?: string })?.code;
  if (code === "P2002")
    return { ok: false, code: "conflict", message: "A record with the same key already exists." };
  console.error("[action]", error);
  return {
    ok: false,
    code: "error",
    message: error instanceof Error ? error.message : "Unexpected error",
  };
}

export function validationResult(error: z.ZodError): ActionResult<never> {
  const issues: Record<string, string[]> = {};
  for (const i of error.issues) {
    const path = i.path.join(".") || "_";
    (issues[path] ??= []).push(i.message);
  }
  return {
    ok: false,
    code: "validation",
    message: "Please correct the highlighted fields.",
    issues,
  };
}

const withDept = z.object({ dept: z.string().min(1) });

export function safeAction<S extends ZodType, R>(
  schema: S,
  handler: (args: {
    input: z.output<S> & { dept: string };
    ctx: DeptCtx;
    db: TxClient;
  }) => Promise<R>,
  opts: DeptActionOptions<z.output<S>> = {},
) {
  return async (raw: unknown): Promise<ActionResult<R>> => {
    const parsed = withDept.and(schema).safeParse(raw);
    if (!parsed.success) return validationResult(parsed.error);
    const input = parsed.data as z.output<S> & { dept: string };
    try {
      const ctx = await requireDeptContext(input.dept);
      if (opts.permission) await requireCan(ctx, opts.permission, opts.subject?.(input), opts.verb);
      const data = await withTenantTx(ctx.departmentId, (db) => handler({ input, ctx, db }));
      return { ok: true, data };
    } catch (error) {
      return mapActionError(error);
    }
  };
}

/** Faculty-level administrator action (no department transaction; handlers use prismaRoot or withTenantBypass). */
export function adminAction<S extends ZodType, R>(
  schema: S,
  handler: (args: { input: z.output<S>; ctx: Ctx }) => Promise<R>,
) {
  return async (raw: unknown): Promise<ActionResult<R>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return validationResult(parsed.error);
    try {
      const ctx = await requireAdmin();
      const data = await handler({ input: parsed.data, ctx });
      return { ok: true, data };
    } catch (error) {
      return mapActionError(error);
    }
  };
}
