import type { Db } from "../../lib/db/types";
import { DocumentLockedError } from "./errors";

/**
 * Locks a version through the SECURITY DEFINER function (migration document_locks); the
 * approving transition passes its log id so the lock is traceable. A second lock fails.
 */
export async function lockVersion(
  db: Db,
  documentId: string,
  versionNo: number,
  transitionLogId: string | null,
): Promise<void> {
  try {
    await db.$executeRaw`SELECT document_version_lock(${documentId}, ${versionNo}, ${transitionLogId})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already locked|is locked/.test(message)) throw new DocumentLockedError(message);
    throw error;
  }
}

export async function isLocked(db: Db, documentId: string, versionNo: number): Promise<boolean> {
  const v = await db.documentVersion.findUnique({
    where: { documentId_versionNo: { documentId, versionNo } },
    select: { lockedAt: true },
  });
  return !!v?.lockedAt;
}
