import { createHmac, timingSafeEqual } from "node:crypto";
import type { Relationship } from "../identity/levels";
import type { SubjectRef } from "../subject-registry/types";

// Access rules of the document service, framework-free so they unit-test with a fake gate.
//
// Reading (accessMode = inherit): the actor may read a document when `document.read` is
// allowed on any linked subject (level semantics apply: `view` is department-wide, `limited`
// needs a requester/representative relationship, ...). Explicit mode consults the grants
// instead. Creators always read their own uploads; administrators read everything.
//
// Contributing (upload, link, comment) on a subject: `document.manage` on the subject, or an
// involvement relationship with it (owner, assignee, member, ...). That keeps the permission
// matrix small — instructors attach files to what they are part of, heads to anything.

/** Relationships that count as being involved with a subject. */
export const INVOLVED: ReadonlySet<Relationship> = new Set<Relationship>([
  "owner",
  "creator",
  "assignee",
  "member",
  "chair",
  "participant",
  "requester",
  "reviewer",
  "section_rep",
]);

export interface AccessGate {
  isAdmin: boolean;
  userId: string;
  personId: string | null;
  can(permissionKey: string, ref?: SubjectRef, verb?: "read" | "manage"): Promise<boolean>;
  relationships(ref: SubjectRef): Promise<Relationship[]>;
  /** Role keys of the actor's active grants (explicit role grants). */
  roleKeys(): Promise<string[]>;
  /** Group ids the actor's person belongs to (explicit group grants). */
  groupIds(): Promise<string[]>;
}

export interface AccessDocument {
  createdBy: string;
  accessMode: "inherit" | "explicit";
  links: SubjectRef[];
  grants: { granteeType: "role" | "person" | "group"; granteeId: string; permission: string }[];
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

export async function canReadDocument(
  gate: AccessGate,
  doc: AccessDocument,
): Promise<AccessDecision> {
  if (gate.isAdmin) return { allowed: true, reason: "administrator" };
  if (doc.createdBy === gate.userId) return { allowed: true, reason: "creator" };
  if (doc.accessMode === "explicit") {
    const [roles, groups] = await Promise.all([gate.roleKeys(), gate.groupIds()]);
    for (const g of doc.grants) {
      if (g.granteeType === "person" && gate.personId && g.granteeId === gate.personId)
        return { allowed: true, reason: "explicit person grant" };
      if (g.granteeType === "role" && roles.includes(g.granteeId))
        return { allowed: true, reason: `explicit role grant (${g.granteeId})` };
      if (g.granteeType === "group" && groups.includes(g.granteeId))
        return { allowed: true, reason: "explicit group grant" };
    }
    // department managers still see explicit documents
    if (await gate.can("document.manage", undefined, "manage"))
      return { allowed: true, reason: "document.manage" };
    return { allowed: false, reason: "no explicit grant" };
  }
  for (const ref of doc.links) {
    if (await gate.can("document.read", ref, "read"))
      return { allowed: true, reason: `document.read via ${ref.subjectType}` };
  }
  if (doc.links.length === 0 && (await gate.can("document.manage", undefined, "manage")))
    return { allowed: true, reason: "document.manage (unlinked document)" };
  return { allowed: false, reason: "no linked subject grants document.read" };
}

/** Upload to, link to or comment on a subject. */
export async function canContribute(gate: AccessGate, ref: SubjectRef): Promise<AccessDecision> {
  if (gate.isAdmin) return { allowed: true, reason: "administrator" };
  if (await gate.can("document.manage", ref, "manage"))
    return { allowed: true, reason: "document.manage" };
  const rels = await gate.relationships(ref);
  const hit = rels.find((r) => INVOLVED.has(r));
  if (hit) return { allowed: true, reason: `involved as ${hit}` };
  return { allowed: false, reason: `not involved with ${ref.subjectType}` };
}

/** Delete, restore, lock or grant on a document. */
export async function canManageDocument(
  gate: AccessGate,
  doc: AccessDocument,
): Promise<AccessDecision> {
  if (gate.isAdmin) return { allowed: true, reason: "administrator" };
  if (doc.createdBy === gate.userId) return { allowed: true, reason: "creator" };
  for (const ref of doc.links) {
    if (await gate.can("document.manage", ref, "manage"))
      return { allowed: true, reason: `document.manage via ${ref.subjectType}` };
  }
  if (await gate.can("document.manage", undefined, "manage"))
    return { allowed: true, reason: "document.manage" };
  return { allowed: false, reason: "document.manage missing" };
}

// ---- signed download links -------------------------------------------------------------

export interface DownloadClaims {
  documentId: string;
  versionNo: number;
  /** Tenant of the document, so the download route can open the right transaction. */
  departmentId: string;
  /** The user the link was issued to; the download route requires the same session. */
  userId: string;
  /** Unix seconds. */
  exp: number;
}

export const DOWNLOAD_TTL_SECONDS = 5 * 60;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signDownload(claims: DownloadClaims, secret: string): string {
  const payload = b64url(
    JSON.stringify([
      claims.documentId,
      claims.versionNo,
      claims.departmentId,
      claims.userId,
      claims.exp,
    ]),
  );
  return `${payload}.${sign(payload, secret)}`;
}

export type VerifyFailure = "malformed" | "signature" | "expired";

export function verifyDownload(
  token: string,
  secret: string,
  now: Date = new Date(),
): { ok: true; claims: DownloadClaims } | { ok: false; reason: VerifyFailure } {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: "signature" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 5 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "number" ||
    typeof parsed[2] !== "string" ||
    typeof parsed[3] !== "string" ||
    typeof parsed[4] !== "number"
  )
    return { ok: false, reason: "malformed" };
  const claims: DownloadClaims = {
    documentId: parsed[0],
    versionNo: parsed[1],
    departmentId: parsed[2],
    userId: parsed[3],
    exp: parsed[4],
  };
  if (claims.exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

export function downloadPath(documentId: string, versionNo: number, token: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/v/${versionNo}/download?t=${encodeURIComponent(token)}`;
}
