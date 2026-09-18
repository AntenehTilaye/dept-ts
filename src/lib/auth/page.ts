import "server-only";
import { notFound, redirect } from "next/navigation";
import {
  ForbiddenError,
  requireAdmin,
  requireDeptContext,
  UnauthenticatedError,
  type Ctx,
  type DeptCtx,
} from "./require";

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
