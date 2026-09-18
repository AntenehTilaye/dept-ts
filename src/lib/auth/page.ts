import "server-only";
import { notFound, redirect } from "next/navigation";
import {
  canDo,
  ForbiddenError,
  requireAdmin,
  requireDeptContext,
  UnauthenticatedError,
  type Ctx,
  type DeptCtx,
} from "./require";
import { getDb } from "../db/scoped";
import type { Db } from "../db/types";
import type { ActionVerb } from "@/platform/identity/levels";

// Page/layout wrappers: map the typed errors to Next control flow. Unauthenticated -> login,
// forbidden or unknown department -> 404 (never reveal that a department exists).
export async function pageContext(deptSlug: string, currentPath?: string): Promise<DeptCtx> {
  try {
    return await requireDeptContext(deptSlug);
  } catch (error) {
    if (error instanceof UnauthenticatedError)
      redirect(`/login?next=${encodeURIComponent(currentPath ?? `/d/${deptSlug}`)}`);
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export async function adminPageContext(): Promise<Ctx> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login?next=/admin");
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/** Page wrapper with a permission check: forbidden -> 404 like an unknown department. */
export async function pageContextCan(
  deptSlug: string,
  permissionKey: string,
  verb?: ActionVerb,
): Promise<DeptCtx> {
  const ctx = await pageContext(deptSlug);
  const decision = await canDo(ctx, permissionKey, undefined, verb);
  if (!decision.allowed) notFound();
  return ctx;
}

/** The department-scoped read client for Server Components (actions use the transaction from safeAction). */
export function dbOf(ctx: DeptCtx): Db {
  return getDb(ctx.departmentId) as unknown as Db;
}
