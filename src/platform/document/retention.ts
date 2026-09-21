import { storage } from "../../lib/storage";
import type { Db } from "../../lib/db/types";
import { registerRetentionProvider } from "../scheduler/providers";

export const DEFAULT_RETENTION_DAYS = 90;

/** Days a soft-deleted document is kept before its objects are purged (SystemSetting document.retentionDays). */
export async function retentionDays(db: Db): Promise<number> {
  const row = await db.systemSetting.findFirst({
    where: { key: "document.retentionDays", scope: "global" },
  });
  return typeof row?.valueJson === "number" ? row.valueJson : DEFAULT_RETENTION_DAYS;
}

/**
 * Hard-deletes documents soft-deleted before the cut-off: unlocked versions through
 * document_version_purge() (dept_app holds no DELETE on the table), their objects from the
 * store, then the document row (which cascades links and grants). Documents that still hold
 * a locked version are kept.
 */
export async function purgeDeletedDocuments(tx: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - (await retentionDays(tx)) * 86_400_000);
  const docs = await tx.document.findMany({
    where: { deletedAt: { lt: cutoff } },
    include: { versions: true },
  });
  let n = 0;
  for (const d of docs) {
    if (d.versions.some((v) => v.lockedAt)) continue;
    await tx.$queryRaw`SELECT document_version_purge(${d.id})`;
    for (const v of d.versions) await storage().delete(v.storageKey);
    await tx.document.delete({ where: { id: d.id } });
    n++;
  }
  return n;
}

export function registerDocumentRetention(): void {
  registerRetentionProvider("document.purge", purgeDeletedDocuments);
}
