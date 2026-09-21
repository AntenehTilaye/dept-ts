import type { Readable } from "node:stream";
import { env } from "../../lib/env";
import { storage } from "../../lib/storage";
import type { Db } from "../../lib/db/types";
import { record } from "../audit/record";
import { publish } from "../audit/outbox";
import type { Actor } from "../identity/can";
import { assertExists } from "../subject-registry";
import type { SubjectRef } from "../subject-registry/types";
import {
  canContribute,
  canManageDocument,
  canReadDocument,
  DOWNLOAD_TTL_SECONDS,
  downloadPath,
  signDownload,
  type AccessDocument,
} from "./access";
import { DocumentAccessError, DocumentNotFoundError } from "./errors";
import { extractText } from "./extract";
import { gateFor } from "./gate";
import { createLinks, type LinkSpec } from "./links";

// The document service: the only API that touches the storage provider. Every mutation runs
// on the caller's department transaction; access decisions come from ./access.

export interface UploadMeta {
  title: string;
  originalName: string;
  mimeType: string;
  category?: string | null;
  tags?: string[];
  note?: string | null;
  accessMode?: "inherit" | "explicit";
}

export type DocumentWithLinks = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

export async function loadDocument(db: Db, documentId: string) {
  return db.document.findUnique({
    where: { id: documentId },
    include: {
      links: true,
      grants: true,
      versions: { orderBy: { versionNo: "desc" } },
    },
  });
}

export function accessView(doc: DocumentWithLinks): AccessDocument {
  return {
    createdBy: doc.createdBy,
    accessMode: doc.accessMode,
    links: doc.links.map((l) => ({ subjectType: l.subjectType, subjectId: l.subjectId })),
    grants: doc.grants.map((g) => ({
      granteeType: g.granteeType,
      granteeId: g.granteeId,
      permission: g.permission,
    })),
  };
}

async function requireDoc(db: Db, documentId: string): Promise<DocumentWithLinks> {
  const doc = await loadDocument(db, documentId);
  if (!doc || doc.deletedAt) throw new DocumentNotFoundError(documentId);
  return doc;
}

async function assertContribute(db: Db, actor: Actor, links: LinkSpec[]): Promise<void> {
  // existence first: a dangling reference is a 422, not a permission problem
  for (const l of links) await assertExists(db, l);
  const gate = gateFor(db, actor);
  for (const l of links) {
    const d = await canContribute(gate, l);
    if (!d.allowed) throw new DocumentAccessError(`Cannot attach to ${l.subjectType}: ${d.reason}`);
  }
}

async function storeVersion(
  db: Db,
  departmentId: string,
  documentId: string,
  versionNo: number,
  source: Readable | Buffer,
  meta: UploadMeta,
  uploadedBy: string,
) {
  const stored = await storage().put(source, { mimeType: meta.mimeType });
  try {
    const version = await db.documentVersion.create({
      data: {
        departmentId,
        documentId,
        versionNo,
        storageKey: stored.key,
        mimeType: meta.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        originalName: meta.originalName,
        uploadedBy,
        note: meta.note ?? null,
      },
    });
    await db.document.update({
      where: { id: documentId },
      data: { currentVersionNo: versionNo },
    });
    // text extraction is best-effort and never blocks the upload
    const text = await extractText(meta.mimeType, await storage().get(stored.key)).catch(
      () => null,
    );
    if (text)
      await db.documentVersion.update({ where: { id: version.id }, data: { extractedText: text } });
    return version;
  } catch (error) {
    // the transaction rolls back; the stored object must not be orphaned
    await storage()
      .delete(stored.key)
      .catch(() => undefined);
    throw error;
  }
}

/** New document with version 1 and its links; the actor must be allowed to contribute to every linked subject. */
export async function upload(
  db: Db,
  actor: Actor,
  source: Readable | Buffer,
  meta: UploadMeta,
  links: LinkSpec[],
) {
  await assertContribute(db, actor, links);
  const doc = await db.document.create({
    data: {
      departmentId: actor.departmentId,
      title: meta.title,
      category: meta.category ?? null,
      tags: meta.tags ?? [],
      accessMode: meta.accessMode ?? "inherit",
      createdBy: actor.userId,
    },
  });
  const version = await storeVersion(db, actor.departmentId, doc.id, 1, source, meta, actor.userId);
  await createLinks(db, actor.departmentId, doc.id, links, actor.userId);
  await publish(
    db,
    "document.uploaded",
    { subjectType: "document", subjectId: doc.id },
    { documentId: doc.id, versionNo: 1, links },
    { departmentId: actor.departmentId },
  );
  return { document: doc, version };
}

/** Appends a version; the actor must be able to manage the document or contribute to a linked subject. */
export async function addVersion(
  db: Db,
  actor: Actor,
  documentId: string,
  source: Readable | Buffer,
  meta: Omit<UploadMeta, "title" | "category" | "tags" | "accessMode"> & { title?: string },
) {
  const doc = await requireDoc(db, documentId);
  const gate = gateFor(db, actor);
  const manage = await canManageDocument(gate, accessView(doc));
  if (!manage.allowed) {
    let ok = false;
    for (const l of doc.links) {
      if ((await canContribute(gate, l)).allowed) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new DocumentAccessError(`Cannot add a version: ${manage.reason}`);
  }
  const versionNo = doc.currentVersionNo + 1;
  const version = await storeVersion(
    db,
    doc.departmentId,
    doc.id,
    versionNo,
    source,
    { ...meta, title: meta.title ?? doc.title },
    actor.userId,
  );
  if (meta.title && meta.title !== doc.title)
    await db.document.update({ where: { id: doc.id }, data: { title: meta.title } });
  await publish(
    db,
    "document.version_added",
    { subjectType: "document", subjectId: doc.id },
    { documentId: doc.id, versionNo },
    { departmentId: doc.departmentId },
  );
  return version;
}

/** Links an existing document to further subjects. */
export async function link(db: Db, actor: Actor, documentId: string, links: LinkSpec[]) {
  const doc = await requireDoc(db, documentId);
  const read = await canReadDocument(gateFor(db, actor), accessView(doc));
  if (!read.allowed) throw new DocumentAccessError(`Cannot link: ${read.reason}`);
  await assertContribute(db, actor, links);
  return createLinks(db, doc.departmentId, doc.id, links, actor.userId);
}

export async function unlink(db: Db, actor: Actor, linkId: string): Promise<void> {
  const l = await db.documentLink.findUnique({ where: { id: linkId } });
  if (!l) return;
  const doc = await requireDoc(db, l.documentId);
  const gate = gateFor(db, actor);
  const ok =
    (await canManageDocument(gate, accessView(doc))).allowed ||
    (await canContribute(gate, { subjectType: l.subjectType, subjectId: l.subjectId })).allowed;
  if (!ok) throw new DocumentAccessError("Cannot unlink this document");
  await db.documentLink.delete({ where: { id: linkId } });
}

/** Documents linked to a subject the actor may read (soft-deleted ones excluded). */
export async function listFor(
  db: Db,
  actor: Actor,
  ref: SubjectRef,
  filter: { linkRole?: LinkSpec["linkRole"]; slotKey?: string } = {},
) {
  const links = await db.documentLink.findMany({
    where: {
      subjectType: ref.subjectType as never,
      subjectId: ref.subjectId,
      ...(filter.linkRole ? { linkRole: filter.linkRole } : {}),
      ...(filter.slotKey !== undefined ? { slotKey: filter.slotKey } : {}),
      document: { deletedAt: null },
    },
    include: {
      document: {
        include: { links: true, grants: true, versions: { orderBy: { versionNo: "desc" } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const gate = gateFor(db, actor);
  const out = [];
  for (const l of links) {
    if ((await canReadDocument(gate, accessView(l.document))).allowed)
      out.push({ link: l, document: l.document });
  }
  return out;
}

/** The document with its versions when the actor may read it. */
export async function get(db: Db, actor: Actor, documentId: string) {
  const doc = await requireDoc(db, documentId);
  const read = await canReadDocument(gateFor(db, actor), accessView(doc));
  if (!read.allowed) throw new DocumentAccessError(read.reason);
  return doc;
}

/** A 5-minute signed download link bound to the actor, issued after the read check. */
export async function downloadUrl(
  db: Db,
  actor: Actor,
  documentId: string,
  versionNo?: number,
  now: Date = new Date(),
): Promise<{ url: string; versionNo: number; expiresAt: Date }> {
  const doc = await get(db, actor, documentId);
  const v = versionNo ?? doc.currentVersionNo;
  if (!doc.versions.some((x) => x.versionNo === v))
    throw new DocumentNotFoundError(`${documentId} v${v}`);
  const exp = Math.floor(now.getTime() / 1000) + DOWNLOAD_TTL_SECONDS;
  const token = signDownload(
    { documentId, versionNo: v, departmentId: doc.departmentId, userId: actor.userId, exp },
    env().BETTER_AUTH_SECRET,
  );
  return {
    url: downloadPath(documentId, v, token),
    versionNo: v,
    expiresAt: new Date(exp * 1000),
  };
}

/** Records an audited download (called by the download route after verifying the link). */
export async function recordDownload(
  db: Db,
  actor: { userId: string; departmentId: string },
  documentId: string,
  versionNo: number,
  clientInfo?: Record<string, unknown>,
) {
  await record(db, {
    action: "download",
    subjectType: "document",
    subjectId: documentId,
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    reason: `v${versionNo}`,
    clientInfo: clientInfo ?? null,
  });
}

/** System-generated files (reports, rendered minutes): no actor gate, the caller is trusted. */
export async function storeGenerated(
  db: Db,
  departmentId: string,
  createdBy: string,
  bytes: Buffer,
  meta: UploadMeta,
  links: LinkSpec[],
) {
  const doc = await db.document.create({
    data: {
      departmentId,
      title: meta.title,
      category: meta.category ?? "generated",
      tags: meta.tags ?? [],
      accessMode: meta.accessMode ?? "inherit",
      createdBy,
    },
  });
  const version = await storeVersion(db, departmentId, doc.id, 1, bytes, meta, createdBy);
  await createLinks(db, departmentId, doc.id, links, createdBy);
  return { document: doc, version };
}

export async function softDelete(db: Db, actor: Actor, documentId: string): Promise<void> {
  const doc = await requireDoc(db, documentId);
  const d = await canManageDocument(gateFor(db, actor), accessView(doc));
  if (!d.allowed) throw new DocumentAccessError(d.reason);
  if (doc.versions.some((v) => v.lockedAt))
    throw new DocumentAccessError("A document with a locked version cannot be deleted");
  await db.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
}

export async function restore(db: Db, actor: Actor, documentId: string): Promise<void> {
  const doc = await loadDocument(db, documentId);
  if (!doc) throw new DocumentNotFoundError(documentId);
  const d = await canManageDocument(gateFor(db, actor), accessView(doc));
  if (!d.allowed) throw new DocumentAccessError(d.reason);
  await db.document.update({ where: { id: documentId }, data: { deletedAt: null } });
}

/** The actor's own uploads in the department. */
export async function myUploads(db: Db, actor: Actor, limit = 100) {
  return db.document.findMany({
    where: { createdBy: actor.userId, deletedAt: null },
    include: { links: true, versions: { orderBy: { versionNo: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
