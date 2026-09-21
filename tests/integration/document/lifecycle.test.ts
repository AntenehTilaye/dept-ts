import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import {
  addVersion,
  DocumentAccessError,
  DocumentLockedError,
  DocumentNotFoundError,
  downloadUrl,
  get,
  listFor,
  lockVersion,
  purgeDeletedDocuments,
  recordDownload,
  restore,
  slotStatus,
  softDelete,
  upload,
  verifyDownload,
} from "@/platform/document";
import type { Actor } from "@/platform/identity/can";
import { migratorDb, rawClient, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

let store: LocalDiskStorage;
let root: string;
let instructor: Actor;
let other: Actor;
let head: Actor;
let eeHead: Actor;
let personId: string;

async function actorFor(
  email: string,
  departmentId: string,
  personId: string | null,
): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, personId, departmentId, isAdmin: user.role === "admin" };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-docs-"));
  store = new LocalDiskStorage(root);
  setStorage(store);
  const [u1, u2] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor2.cs@deptts.local" } }),
  ]);
  const p1 = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: u1.id, email: "instructor1.cs@deptts.local" }),
  );
  const p2 = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: u2.id, email: "instructor2.cs@deptts.local" }),
  );
  personId = p1.id;
  instructor = await actorFor("instructor1.cs@deptts.local", DEPT_CS, p1.id);
  other = await actorFor("instructor2.cs@deptts.local", DEPT_CS, p2.id);
  head = await actorFor("dh.cs@deptts.local", DEPT_CS, null);
  eeHead = await actorFor("dh.ee@deptts.local", DEPT_EE, null);
});
afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

const me = () => ({ subjectType: "person", subjectId: personId });

describe("document lifecycle", () => {
  it("uploads to a subject the actor owns, versions it, extracts text and lists it for readers", async () => {
    const { document, version } = await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        instructor,
        Buffer.from("cv line one\ncv line two\n"),
        { title: "My CV", originalName: "cv.txt", mimeType: "text/plain" },
        [{ ...me(), linkRole: "evidence" }],
      ),
    );
    expect(version.versionNo).toBe(1);
    expect(version.checksum).toHaveLength(64);
    expect(await store.exists(version.storageKey)).toBe(true);
    const stored = await migratorDb.documentVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(stored.extractedText).toContain("cv line two");
    expect(await migratorDb.documentLink.count({ where: { documentId: document.id } })).toBe(1);

    const v2 = await withTenantTx(DEPT_CS, (tx) =>
      addVersion(tx, instructor, document.id, Buffer.from("v2"), {
        originalName: "cv-v2.txt",
        mimeType: "text/plain",
        note: "updated",
      }),
    );
    expect(v2.versionNo).toBe(2);
    expect(
      (await migratorDb.document.findUniqueOrThrow({ where: { id: document.id } }))
        .currentVersionNo,
    ).toBe(2);

    // the owner, the head (document.read full) and a colleague (document.read view) all read it
    for (const actor of [instructor, head, other]) {
      const rows = await withTenantTx(DEPT_CS, (tx) => listFor(tx, actor, me()));
      expect(rows.map((r) => r.document.id)).toContain(document.id);
    }
    // another department never sees the rows (RLS) so the download is refused
    await expect(
      withTenantTx(DEPT_EE, (tx) => downloadUrl(tx, eeHead, document.id)),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    // audit rows for create and update exist through the interceptor
    const audits = await migratorDb.auditEvent.findMany({
      where: { subjectType: "document", subjectId: document.id },
    });
    expect(audits.map((a) => a.action)).toContain("create");
    // the outbox carries the upload
    expect(
      await migratorDb.domainEvent.count({
        where: { aggregateType: "document", aggregateId: document.id },
      }),
    ).toBe(2);
  });

  it("only involved actors or managers may attach to a subject", async () => {
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        upload(
          tx,
          other,
          Buffer.from("x"),
          { title: "Nope", originalName: "n.txt", mimeType: "text/plain" },
          [{ ...me(), linkRole: "attachment" }],
        ),
      ),
    ).rejects.toBeInstanceOf(DocumentAccessError);
    const byHead = await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        head,
        Buffer.from("from the head"),
        { title: "Appraisal", originalName: "appraisal.txt", mimeType: "text/plain" },
        [{ ...me(), linkRole: "attachment" }],
      ),
    );
    expect(byHead.document.createdBy).toBe(head.userId);
  });

  it("signed download links verify, bind the user and are audited", async () => {
    const { document } = await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        instructor,
        Buffer.from("dl"),
        { title: "Download me", originalName: "d.txt", mimeType: "text/plain" },
        [{ ...me(), linkRole: "attachment" }],
      ),
    );
    const link = await withTenantTx(DEPT_CS, (tx) => downloadUrl(tx, instructor, document.id));
    const token = new URL(`http://x${link.url}`).searchParams.get("t")!;
    const verdict = verifyDownload(token, process.env.BETTER_AUTH_SECRET!);
    expect(verdict.ok && verdict.claims).toMatchObject({
      documentId: document.id,
      versionNo: 1,
      departmentId: DEPT_CS,
      userId: instructor.userId,
    });
    expect(
      verifyDownload(token, process.env.BETTER_AUTH_SECRET!, new Date(Date.now() + 6 * 60_000)),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
    await withTenantTx(DEPT_CS, (tx) =>
      recordDownload(tx, { userId: instructor.userId, departmentId: DEPT_CS }, document.id, 1),
    );
    const audit = await migratorDb.auditEvent.findFirst({
      where: { subjectType: "document", subjectId: document.id, action: "download" },
    });
    expect(audit).toMatchObject({ actorUserId: instructor.userId, reason: "v1" });
  });

  it("locks a version through the SECURITY DEFINER function; direct updates as dept_app are denied", async () => {
    const { document } = await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        instructor,
        Buffer.from("minutes"),
        { title: "Minutes", originalName: "m.txt", mimeType: "text/plain" },
        [{ ...me(), linkRole: "minutes" }],
      ),
    );
    const c = await rawClient("app");
    try {
      await c.query(`SELECT set_config('app.current_department_id', $1, false)`, [DEPT_CS]);
      await expect(
        c.query(`UPDATE document_version SET mime_type = 'x' WHERE document_id = $1`, [
          document.id,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`DELETE FROM document_version WHERE document_id = $1`, [document.id]),
      ).rejects.toThrow(/permission denied/);
      // allowed column before the lock
      await c.query(`UPDATE document_version SET extracted_text = 'ok' WHERE document_id = $1`, [
        document.id,
      ]);
    } finally {
      await c.end();
    }
    await withTenantTx(DEPT_CS, (tx) => lockVersion(tx, document.id, 1, "log-1"));
    const locked = await migratorDb.documentVersion.findUniqueOrThrow({
      where: { documentId_versionNo: { documentId: document.id, versionNo: 1 } },
    });
    expect(locked.lockedAt).not.toBeNull();
    expect(locked.lockedByTransitionLogId).toBe("log-1");
    await expect(
      withTenantTx(DEPT_CS, (tx) => lockVersion(tx, document.id, 1, "log-2")),
    ).rejects.toBeInstanceOf(DocumentLockedError);
    // even the allowed columns are frozen once locked
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        tx.documentVersion.update({ where: { id: locked.id }, data: { extractedText: "later" } }),
      ),
    ).rejects.toThrow(/locked/);
    // another department cannot lock it either
    await expect(
      withTenantTx(DEPT_EE, (tx) => lockVersion(tx, document.id, 1, "log-3")),
    ).rejects.toThrow(/another department|already locked/);
    await expect(
      withTenantTx(DEPT_CS, (tx) => softDelete(tx, instructor, document.id)),
    ).rejects.toThrow(/locked/);
  });

  it("reports deliverable slots and hides soft-deleted documents until restored", async () => {
    const ref = me();
    const { document } = await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        instructor,
        Buffer.from("report"),
        { title: "Report", originalName: "r.txt", mimeType: "text/plain" },
        [{ ...ref, linkRole: "deliverable", slotKey: "report" }],
      ),
    );
    const before = await withTenantTx(DEPT_CS, (tx) => slotStatus(tx, ref, ["report", "annex"]));
    expect(before).toEqual([
      { slotKey: "report", satisfied: true, documentId: document.id, versionNo: 1 },
      { slotKey: "annex", satisfied: false },
    ]);
    await withTenantTx(DEPT_CS, (tx) => softDelete(tx, instructor, document.id));
    expect(
      (await withTenantTx(DEPT_CS, (tx) => slotStatus(tx, ref, ["report"])))[0]!.satisfied,
    ).toBe(false);
    await expect(
      withTenantTx(DEPT_CS, (tx) => get(tx, instructor, document.id)),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    await withTenantTx(DEPT_CS, (tx) => restore(tx, instructor, document.id));
    expect(
      (await withTenantTx(DEPT_CS, (tx) => slotStatus(tx, ref, ["report"])))[0]!.satisfied,
    ).toBe(true);
  });

  it("retention purges documents deleted before the cut-off, keeps locked ones", async () => {
    const mk = async (title: string) =>
      (
        await withTenantTx(DEPT_CS, (tx) =>
          upload(
            tx,
            instructor,
            Buffer.from(title),
            { title, originalName: `${title}.txt`, mimeType: "text/plain" },
            [{ ...me(), linkRole: "attachment" }],
          ),
        )
      ).document;
    const gone = await mk("old-deleted");
    const kept = await mk("locked-deleted");
    const fresh = await mk("fresh-deleted");
    await withTenantTx(DEPT_CS, (tx) => lockVersion(tx, kept.id, 1, null));
    const old = new Date(Date.now() - 400 * 86_400_000);
    await migratorDb.document.updateMany({
      where: { id: { in: [gone.id, kept.id] } },
      data: { deletedAt: old },
    });
    await migratorDb.document.update({ where: { id: fresh.id }, data: { deletedAt: new Date() } });
    const key = (
      await migratorDb.documentVersion.findFirstOrThrow({ where: { documentId: gone.id } })
    ).storageKey;
    const n = await withTenantBypass({ worker: true, jobName: "retention.run" }, "test", (tx) =>
      purgeDeletedDocuments(tx, new Date()),
    );
    expect(n).toBe(1);
    expect(await migratorDb.document.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await store.exists(key)).toBe(false);
    expect(await migratorDb.document.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(await migratorDb.document.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
