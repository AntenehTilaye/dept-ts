import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { dispatchPending } from "@/platform/audit/outbox";
import { upload } from "@/platform/document";
import { act, createRecord } from "@/platform/feature";
import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import type { Actor } from "@/platform/identity/can";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// Constituting a committee has to do four things at once: make the committee, make the group its
// membership is, open the grants that membership implies, and leave a record somebody can follow.
// These tests drive the real process and then look at each of the four.

vi.setConfig({ testTimeout: 120_000 });
bootstrap();

let root: string;
let head: Actor;
let chairPersonId: string;
let memberPersonId: string;
let outsiderPersonId: string;
let chair: Actor;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-committee-"));
  setStorage(new LocalDiskStorage(root));

  const [dh, chairUser, memberUser] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "chair.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
  ]);
  await withDept(DEPT_CS, async (tx) => {
    const p1 = await f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" });
    const p2 = await f.staff(tx, DEPT_CS, {
      userId: chairUser.id,
      email: "chair.cs@deptts.local",
    });
    const p3 = await f.staff(tx, DEPT_CS, {
      userId: memberUser.id,
      email: "instructor1.cs@deptts.local",
    });
    // somebody in the department who is on no committee: a derived grant is the only thing
    // that would let them in, and they have none
    const p4 = await f.staff(tx, DEPT_CS, {});
    head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
    chair = { userId: chairUser.id, personId: p2.id, departmentId: DEPT_CS, isAdmin: false };
    chairPersonId = p2.id;
    memberPersonId = p3.id;
    outsiderPersonId = p4.id;
  });
});

afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

/** Creates a committee and constitutes it, the way the pages do. */
async function constitute(name: string, members: string[] = [memberPersonId]) {
  return withTenantTx(DEPT_CS, async (tx) => {
    const record = await createRecord(tx, DEPT_CS, head, "committee", {
      data: {
        name,
        purpose: "Something the department needs looked after",
        type: "standing",
        chair: chairPersonId,
        members,
      },
    });
    await upload(
      tx,
      head,
      Buffer.from("%PDF-1.4 terms of reference"),
      {
        title: `${name} — terms of reference`,
        originalName: "tor.pdf",
        mimeType: "application/pdf",
      },
      [
        {
          subjectType: "feature_record",
          subjectId: record.id,
          linkRole: "evidence",
          slotKey: "tor",
        },
      ],
    );
    await act(tx, record.id, "setup", "activate", head);
    return record;
  });
}

describe("constituting a committee", () => {
  it("makes the committee, its group and its membership in one go", async () => {
    const record = await constitute("Curriculum review");
    const committee = await withTenantTx(DEPT_CS, (tx) =>
      tx.committee.findUniqueOrThrow({
        where: { featureRecordId: record.id },
        include: { group: { include: { members: true } } },
      }),
    );

    // the committee and the record it is are one thing with one id
    expect(committee.id).toBe(record.id);
    expect(committee.group.kind).toBe("committee");
    expect(committee.group.contextType).toBe("committee");
    expect(committee.group.contextId).toBe(committee.id);
    expect(committee.group.status).toBe("active");
    expect(committee.chairPersonId).toBe(chairPersonId);
    expect(committee.group.members.map((m) => m.personId).sort()).toEqual(
      [chairPersonId, memberPersonId].sort(),
    );
    expect(
      committee.group.members.find((m) => m.personId === chairPersonId)?.roleInGroup,
    ).toBe("chair");
  });

  it("opens the grants the membership implies once the outbox is dispatched", async () => {
    const record = await constitute("Ethics panel");
    await dispatchPending(200);
    const grants = await withTenantTx(DEPT_CS, (tx) =>
      tx.roleGrant.findMany({
        where: { scopeType: "committee", scopeId: record.id, validTo: null },
        include: { role: { select: { key: true } } },
      }),
    );
    const keys = grants.map((g) => g.role.key).sort();
    expect(keys).toEqual(["committee_chair", "committee_member", "committee_member"]);
  });

  it("closes those grants when the committee is stood down, and reopens them when it comes back", async () => {
    const record = await constitute("Timetable panel");
    await dispatchPending(200);

    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "active", "deactivate", head, { comment: "Work is finished for now" }),
    );
    await dispatchPending(200);

    const closed = await withTenantTx(DEPT_CS, async (tx) => {
      const group = await tx.committee.findUniqueOrThrow({ where: { id: record.id } });
      const g = await tx.group.findUniqueOrThrow({ where: { id: group.groupId } });
      const open = await tx.roleGrant.count({
        where: { scopeType: "committee", scopeId: record.id, validTo: null },
      });
      return { status: g.status, open };
    });
    expect(closed.status).toBe("inactive");
    expect(closed.open).toBe(0);

    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "inactive", "reactivate", head));
    await dispatchPending(200);
    const reopened = await withTenantTx(DEPT_CS, (tx) =>
      tx.roleGrant.count({
        where: { scopeType: "committee", scopeId: record.id, validTo: null },
      }),
    );
    expect(reopened).toBe(3);
  });

  it("refuses to constitute a committee whose chair is not on it", async () => {
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        const record = await createRecord(tx, DEPT_CS, head, "committee", {
          data: { name: "A committee with an absent chair", chair: chairPersonId },
        });
        // the chair is a member by construction, so the guard is proven by removing them
        const committee = await tx.committee.findUniqueOrThrow({ where: { id: record.id } });
        await tx.groupMembership.updateMany({
          where: { groupId: committee.groupId },
          data: { validTo: new Date(Date.now() - 1000) },
        });
        await upload(
          tx,
          head,
          Buffer.from("%PDF-1.4"),
          { title: "tor", originalName: "tor.pdf", mimeType: "application/pdf" },
          [
            {
              subjectType: "feature_record",
              subjectId: record.id,
              linkRole: "evidence",
              slotKey: "tor",
            },
          ],
        );
        await act(tx, record.id, "setup", "activate", head);
      }),
    ).rejects.toThrow(/chair is not a member/i);
  });

  it("will not constitute a committee whose terms of reference are missing", async () => {
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        const record = await createRecord(tx, DEPT_CS, head, "committee", {
          data: { name: "A committee with no mandate", chair: chairPersonId },
        });
        await act(tx, record.id, "setup", "activate", head);
      }),
    ).rejects.toThrow(/tor/i);
  });
});

describe("what a committee makes visible", () => {
  it("lets a member see the committee's task and keeps an outsider out of it", async () => {
    const record = await constitute("Assessment panel");
    await dispatchPending(200);

    const task = await withTenantTx(DEPT_CS, async (tx) => {
      const created = await createRecord(tx, DEPT_CS, head, "task", {
        presetKey: "committee_task",
        parentRef: { subjectType: "committee", subjectId: record.id },
        data: { title: "Review the marking scheme", assignee: chairPersonId },
      });
      await act(tx, created.id, "draft", "assign", head);
      return created;
    });

    const subject = { subjectType: "feature_record", subjectId: task.id };
    const asChair = await can(dbPolicyStore, chair, "feature.task.view", subject, {
      verb: "read",
    });
    expect(asChair.allowed).toBe(true);

    const outsider: Actor = {
      userId: "user-with-no-grants",
      personId: outsiderPersonId,
      departmentId: DEPT_CS,
      isAdmin: false,
    };
    const asOutsider = await can(dbPolicyStore, outsider, "feature.task.view", subject, {
      verb: "read",
    });
    expect(asOutsider.allowed).toBe(false);
  });

  it("keeps one department's committees out of the other's", async () => {
    const record = await constitute("Isolation panel");
    const fromEe = await withTenantTx(DEPT_EE, (tx) =>
      tx.committee.findMany({ where: { id: record.id } }),
    );
    expect(fromEe).toEqual([]);
  });
});
