import { prismaRoot } from "../../lib/db/prisma";
import { withTenantTx } from "../../lib/db/tenant";
import { syncMemberGrants } from "./derive";

// Nightly repair of derived grants (grant.reconcile job, wired in the scheduler phase).
// Later sources are added by the registry phase; every rule is idempotent and expires rather
// than deletes.

export interface ReconcileSummary {
  departmentId: string;
  members: number;
  orphaned: number;
}

export async function reconcileDepartment(
  departmentId: string,
  now = new Date(),
): Promise<ReconcileSummary> {
  const members = await prismaRoot.member.findMany({
    where: { organizationId: departmentId },
    select: { userId: true },
  });
  for (const m of members) await syncMemberGrants(m.userId, departmentId, now);
  const orphaned = await withTenantTx(
    departmentId,
    (tx) =>
      tx.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT g.user_id FROM role_grant g
       WHERE g.source = 'derived' AND g.derived_from_type = 'user' AND g.valid_to IS NULL
         AND NOT EXISTS (SELECT 1 FROM member m WHERE m.user_id = g.user_id AND m.organization_id = ${departmentId})`,
  );
  for (const o of orphaned) await syncMemberGrants(o.user_id, departmentId, now);
  return { departmentId, members: members.length, orphaned: orphaned.length };
}

export async function reconcileAll(now = new Date()): Promise<ReconcileSummary[]> {
  const departments = await prismaRoot.department.findMany({ select: { id: true } });
  const out: ReconcileSummary[] = [];
  for (const d of departments) out.push(await reconcileDepartment(d.id, now));
  return out;
}
