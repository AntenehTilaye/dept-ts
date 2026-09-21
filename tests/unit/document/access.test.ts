import { describe, expect, it } from "vitest";
import {
  canContribute,
  canManageDocument,
  canReadDocument,
  downloadPath,
  signDownload,
  verifyDownload,
  type AccessGate,
} from "@/platform/document/access";
import type { Relationship } from "@/platform/identity/levels";

function gate(over: Partial<AccessGate> & { allow?: string[]; rels?: Relationship[] }): AccessGate {
  const allow = new Set(over.allow ?? []);
  return {
    isAdmin: false,
    userId: "u1",
    personId: "p1",
    can: async (key, ref) => allow.has(ref ? `${key}@${ref.subjectType}` : key),
    relationships: async () => over.rels ?? [],
    roleKeys: async () => ["instructor"],
    groupIds: async () => ["g1"],
    ...over,
  };
}
const task = { subjectType: "task", subjectId: "t1" };
const person = { subjectType: "person", subjectId: "p9" };

describe("document access", () => {
  it("inherit mode: any linked subject granting document.read allows, creators and admins always", async () => {
    const doc = {
      createdBy: "u2",
      accessMode: "inherit" as const,
      links: [task, person],
      grants: [],
    };
    expect((await canReadDocument(gate({ allow: ["document.read@person"] }), doc)).allowed).toBe(
      true,
    );
    expect((await canReadDocument(gate({ allow: ["document.read@meeting"] }), doc)).allowed).toBe(
      false,
    );
    expect((await canReadDocument(gate({ userId: "u2" }), doc)).allowed).toBe(true);
    expect((await canReadDocument(gate({ isAdmin: true }), doc)).allowed).toBe(true);
    const orphan = { ...doc, links: [] };
    expect((await canReadDocument(gate({}), orphan)).allowed).toBe(false);
    expect((await canReadDocument(gate({ allow: ["document.manage"] }), orphan)).allowed).toBe(
      true,
    );
  });

  it("explicit mode: grants for the person, a role or a group decide; managers still read", async () => {
    const base = { createdBy: "u2", accessMode: "explicit" as const, links: [task] };
    const g = (granteeType: "role" | "person" | "group", granteeId: string) => ({
      granteeType,
      granteeId,
      permission: "read",
    });
    expect(
      (await canReadDocument(gate({ allow: ["document.read@task"] }), { ...base, grants: [] }))
        .allowed,
    ).toBe(false);
    expect(
      (await canReadDocument(gate({}), { ...base, grants: [g("person", "p1")] })).allowed,
    ).toBe(true);
    expect(
      (await canReadDocument(gate({}), { ...base, grants: [g("role", "instructor")] })).allowed,
    ).toBe(true);
    expect((await canReadDocument(gate({}), { ...base, grants: [g("group", "g1")] })).allowed).toBe(
      true,
    );
    expect((await canReadDocument(gate({}), { ...base, grants: [g("group", "g2")] })).allowed).toBe(
      false,
    );
    expect(
      (await canReadDocument(gate({ allow: ["document.manage"] }), { ...base, grants: [] }))
        .allowed,
    ).toBe(true);
  });

  it("contributing needs document.manage on the subject or an involvement relationship", async () => {
    expect((await canContribute(gate({}), task)).allowed).toBe(false);
    expect((await canContribute(gate({ rels: ["assignee"] }), task)).allowed).toBe(true);
    expect((await canContribute(gate({ rels: ["target"] }), task)).allowed).toBe(false);
    expect((await canContribute(gate({ allow: ["document.manage@task"] }), task)).allowed).toBe(
      true,
    );
    const doc = { createdBy: "u2", accessMode: "inherit" as const, links: [task], grants: [] };
    expect((await canManageDocument(gate({}), doc)).allowed).toBe(false);
    expect((await canManageDocument(gate({ allow: ["document.manage@task"] }), doc)).allowed).toBe(
      true,
    );
    expect((await canManageDocument(gate({ userId: "u2" }), doc)).allowed).toBe(true);
  });

  it("signed links verify, and reject tampering and expiry", () => {
    const claims = {
      documentId: "d1",
      versionNo: 2,
      departmentId: "dep_cs",
      userId: "u1",
      exp: 1_000_000,
    };
    const token = signDownload(claims, "secret");
    const at = new Date(999_000 * 1000);
    expect(verifyDownload(token, "secret", at)).toEqual({ ok: true, claims });
    expect(verifyDownload(token, "other", at)).toEqual({ ok: false, reason: "signature" });
    expect(verifyDownload(token, "secret", new Date(1_000_000 * 1000))).toEqual({
      ok: false,
      reason: "expired",
    });
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify(["d2", 2, "dep_cs", "u1", 1_000_000])).toString("base64url")}.${sig}`;
    expect(verifyDownload(forged, "secret", at).ok).toBe(false);
    expect(verifyDownload(`${payload}`, "secret", at)).toEqual({ ok: false, reason: "malformed" });
    expect(downloadPath("d1", 2, token)).toBe(
      `/api/documents/d1/v/2/download?t=${encodeURIComponent(token)}`,
    );
  });
});
