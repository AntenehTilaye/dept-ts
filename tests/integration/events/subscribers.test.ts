import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending, publish } from "@/platform/audit/outbox";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("grant subscribers", () => {
  it("repair grants for group membership, teaching, representative, section and person events", async () => {
    const user = await migratorDb.user.findUniqueOrThrow({
      where: { email: "instructor2.cs@deptts.local" },
    });
    const ids = await withDept(DEPT_CS, async (tx) => {
      const p = await f.staff(tx, DEPT_CS, {
        userId: user.id,
        email: "instructor2.cs@deptts.local",
      });
      const { group, memberships } = await f.committee(tx, DEPT_CS, [
        { personId: p.id, role: "chair" },
      ]);
      const section = await f.section(tx, DEPT_CS);
      const { sectionOfferings } = await f.offering(tx, DEPT_CS, { sectionIds: [section.id] });
      const ta = await tx.teachingAssignment.create({
        data: {
          departmentId: DEPT_CS,
          sectionOfferingId: sectionOfferings[0]!.id,
          personId: p.id,
          role: "lecture",
          source: "manual",
        },
      });
      return { personId: p.id, groupId: group.id, membershipId: memberships[0]!.id, taId: ta.id };
    });
    // wipe the grants the services derived so the subscribers have something to repair
    await migratorDb.roleGrant.deleteMany({
      where: { userId: user.id, scopeType: { in: ["committee", "section_offering"] } },
    });
    await withTenantTx(DEPT_CS, async (tx) => {
      await publish(tx, "group.membership.changed", {
        subjectType: "group_membership",
        subjectId: ids.membershipId,
      });
      await publish(tx, "group.status.changed", { subjectType: "group", subjectId: ids.groupId });
      await publish(tx, "teaching.assigned", {
        subjectType: "teaching_assignment",
        subjectId: ids.taId,
      });
      await publish(tx, "person.user_linked", { subjectType: "person", subjectId: ids.personId });
      await publish(
        tx,
        "member.changed",
        { subjectType: "user", subjectId: user.id },
        { userId: user.id, organizationId: DEPT_CS },
      );
      await publish(
        tx,
        "student.section_membership.changed",
        { subjectType: "student", subjectId: "none" },
        { studentId: "none" },
      );
      await publish(tx, "representative.changed", {
        subjectType: "section_representative",
        subjectId: "none",
      });
      await publish(tx, "teaching.ended", {
        subjectType: "teaching_assignment",
        subjectId: "none",
      });
      await publish(tx, "member.removed", { subjectType: "user", subjectId: "u" }, {});
    });
    const summary = await dispatchPending(100);
    expect(summary.failed).toBe(0);
    const grants = await withDept(DEPT_CS, (tx) =>
      tx.roleGrant.findMany({ where: { userId: user.id, validTo: null }, include: { role: true } }),
    );
    const keys = grants.map((g) => `${g.role.key}@${g.scopeType}`).sort();
    expect(keys).toEqual(
      expect.arrayContaining([
        "committee_chair@committee",
        "committee_member@committee",
        "instructor@section_offering",
        "instructor@department",
      ]),
    );
  });
});
