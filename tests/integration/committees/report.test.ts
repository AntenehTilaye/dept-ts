import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { dispatchPending } from "@/platform/audit/outbox";
import { upload } from "@/platform/document";
import { act, createRecord, saveStepDraft } from "@/platform/feature";
import { boundOptionsFor } from "@/platform/forms";
import type { Actor } from "@/platform/identity/can";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// A committee report is the platform's first child record with a review loop, and the one place
// where a process turns what somebody wrote into work for somebody else: an issue the committee
// could not settle becomes a case the department has to answer.

vi.setConfig({ testTimeout: 180_000 });
bootstrap();

let root: string;
let head: Actor;
let chair: Actor;
let outsider: Actor;
let chairPersonId: string;
let memberPersonId: string;
let committeeId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-committee-report-"));
  setStorage(new LocalDiskStorage(root));

  const [dh, chairUser, memberUser, outsiderUser] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "chair.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor2.cs@deptts.local" } }),
  ]);
  await withDept(DEPT_CS, async (tx) => {
    const p1 = await f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" });
    const p2 = await f.staff(tx, DEPT_CS, { userId: chairUser.id, email: "chair.cs@deptts.local" });
    const p3 = await f.staff(tx, DEPT_CS, {
      userId: memberUser.id,
      email: "instructor1.cs@deptts.local",
    });
    // an instructor of the department who is not on this committee: they have every right an
    // instructor has, and still may not write in the committee's name
    const p4 = await f.staff(tx, DEPT_CS, {
      userId: outsiderUser.id,
      email: "instructor2.cs@deptts.local",
    });
    head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
    chair = { userId: chairUser.id, personId: p2.id, departmentId: DEPT_CS, isAdmin: false };
    outsider = { userId: outsiderUser.id, personId: p4.id, departmentId: DEPT_CS, isAdmin: false };
    chairPersonId = p2.id;
    memberPersonId = p3.id;
  });

  committeeId = await withTenantTx(DEPT_CS, async (tx) => {
    const record = await createRecord(tx, DEPT_CS, head, "committee", {
      data: {
        name: "Reporting committee",
        chair: chairPersonId,
        members: [memberPersonId],
        type: "standing",
      },
    });
    await upload(
      tx,
      head,
      Buffer.from("%PDF-1.4 terms"),
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
    return record.id;
  });
  await dispatchPending(200);
});

afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

const PERIOD = { period_from: "2026-01-01", period_to: "2026-03-31" };

async function draftReport() {
  return withTenantTx(DEPT_CS, (tx) =>
    createRecord(tx, DEPT_CS, chair, "committee_report", {
      parentRef: { subjectType: "committee", subjectId: committeeId },
      data: PERIOD,
    }),
  );
}

describe("writing a committee report", () => {
  it("creates the report row under the committee, with the period and the author", async () => {
    const record = await draftReport();
    const report = await withTenantTx(DEPT_CS, (tx) =>
      tx.committeeReport.findUniqueOrThrow({ where: { featureRecordId: record.id } }),
    );
    expect(report.id).toBe(record.id);
    expect(report.committeeId).toBe(committeeId);
    expect(report.authorPersonId).toBe(chairPersonId);
    expect(report.periodTo.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(report.submittedAt).toBeNull();
  });

  it("makes the report due on the day the period ends", async () => {
    const record = await draftReport();
    const step = await withTenantTx(DEPT_CS, (tx) =>
      tx.featureStepInstance.findFirstOrThrow({
        where: { recordId: record.id, stepKey: "draft" },
      }),
    );
    expect(step.deadlineAt?.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("refuses a submission from an instructor who is not on the committee", async () => {
    const record = await draftReport();
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        await saveStepDraft(tx, record.id, "draft", outsider, {
          progress_summary: "We met twice.",
        });
        await act(tx, record.id, "draft", "submit", outsider);
      }),
    ).rejects.toThrow(/relationship is missing/i);
  });

  it("refuses a submission from somebody who has left the committee", async () => {
    const record = await draftReport();
    // the grant that lets them in closes when the outbox catches up; the guard does not wait
    await withTenantTx(DEPT_CS, async (tx) => {
      const committee = await tx.committee.findUniqueOrThrow({ where: { id: committeeId } });
      await tx.groupMembership.updateMany({
        where: { groupId: committee.groupId, personId: chairPersonId },
        data: { validTo: new Date(Date.now() - 1000) },
      });
    });
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        await saveStepDraft(tx, record.id, "draft", chair, { progress_summary: "We met." });
        await act(tx, record.id, "draft", "submit", chair);
      }),
    ).rejects.toThrow(/member of the committee/i);

    // put them back, so the tests that follow find the committee as it was
    await withTenantTx(DEPT_CS, async (tx) => {
      const committee = await tx.committee.findUniqueOrThrow({ where: { id: committeeId } });
      await tx.groupMembership.updateMany({
        where: { groupId: committee.groupId, personId: chairPersonId },
        data: { validTo: null },
      });
    });
  });

  it("stamps the submission, hands the report to the head and keeps the answers", async () => {
    const record = await draftReport();
    await withTenantTx(DEPT_CS, async (tx) => {
      await saveStepDraft(tx, record.id, "draft", chair, {
        progress_summary: "We reviewed four syllabuses.",
        recommendations: "Merge CS301 and CS305.",
      });
      await act(tx, record.id, "draft", "submit", chair);
    });

    const after = await withTenantTx(DEPT_CS, async (tx) => ({
      report: await tx.committeeReport.findUniqueOrThrow({ where: { id: record.id } }),
      record: await tx.featureRecord.findUniqueOrThrow({ where: { id: record.id } }),
      steps: await tx.featureStepInstance.findMany({ where: { recordId: record.id } }),
    }));

    expect(after.record.currentStateKey).toBe("submitted");
    expect(after.report.submittedAt).not.toBeNull();
    // the effect is the only thing that writes it, and it binds the answers to the report
    expect(after.report.submissionId).not.toBeNull();
    const submitted = after.steps.filter((s) => s.stepKey === "submitted" && s.status === "active");
    expect(submitted).toHaveLength(1);
  });

  it("will not send a report back without saying why", async () => {
    const record = await draftReport();
    await withTenantTx(DEPT_CS, async (tx) => {
      await saveStepDraft(tx, record.id, "draft", chair, { progress_summary: "We met." });
      await act(tx, record.id, "draft", "submit", chair);
    });
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        act(tx, record.id, "submitted", "request_revision", head),
      ),
    ).rejects.toThrow(/comment/i);
  });
});

describe("what the head does with a report", () => {
  it("raises each unsettled issue as a case, once, and reaches approved after a revision", async () => {
    const record = await draftReport();
    await withTenantTx(DEPT_CS, async (tx) => {
      await saveStepDraft(tx, record.id, "draft", chair, {
        progress_summary: "We reviewed the programme.",
        issues_requiring_attention: [
          { issue: "Two courses teach the same material and neither is examined", urgency: "high" },
          { issue: "Lab B has no working projector", urgency: "normal" },
        ],
      });
      await act(tx, record.id, "draft", "submit", chair);
      await act(tx, record.id, "submitted", "request_revision", head, {
        comment: "Say what you propose to do about the projector.",
      });
    });

    const sentBack = await withTenantTx(DEPT_CS, (tx) =>
      tx.featureRecord.findUniqueOrThrow({ where: { id: record.id } }),
    );
    expect(sentBack.currentStateKey).toBe("revision_required");

    await withTenantTx(DEPT_CS, async (tx) => {
      await act(tx, record.id, "revision_required", "resubmit", chair);
      await act(tx, record.id, "submitted", "review", head);
      await act(tx, record.id, "reviewed", "escalate_issues", head);
      // asking twice must not raise the same issue twice
      await act(tx, record.id, "reviewed", "escalate_issues", head);
      await act(tx, record.id, "reviewed", "approve", head);
    });

    const after = await withTenantTx(DEPT_CS, async (tx) => ({
      record: await tx.featureRecord.findUniqueOrThrow({ where: { id: record.id } }),
      cases: await tx.featureRecord.findMany({
        where: { parentSubjectType: "feature_record", parentSubjectId: record.id },
        orderBy: { number: "asc" },
      }),
    }));

    expect(after.record.currentStateKey).toBe("approved");
    expect(after.cases).toHaveLength(2);
    expect(after.cases[0]!.title).toMatch(/same material/);
    const details = after.cases.map((c) => (c.data as Record<string, unknown>).details);
    expect(details).toContain("Lab B has no working projector");
  });

  it("offers the committee's own tasks and members on the report's form", async () => {
    const task = await withTenantTx(DEPT_CS, async (tx) => {
      const created = await createRecord(tx, DEPT_CS, head, "task", {
        presetKey: "committee_task",
        parentRef: { subjectType: "committee", subjectId: committeeId },
        data: { title: "Read the external examiner report", assignee: chairPersonId },
      });
      await act(tx, created.id, "draft", "assign", head);
      return created;
    });
    const record = await draftReport();
    const options = await withTenantTx(DEPT_CS, (tx) =>
      boundOptionsFor(
        [
          { key: "completed_tasks", type: "task_picker", label: "Tasks", sourceBinding: "tasks_in_context" },
          { key: "who", type: "person_picker", label: "Who", sourceBinding: "members_of_parent" },
        ],
        {
          db: tx,
          departmentId: DEPT_CS,
          personId: chairPersonId,
          subject: { subjectType: "feature_record", subjectId: record.id },
        },
      ),
    );
    // the report is the subject, but the question is about the committee it hangs under
    expect(options.completed_tasks?.map((o) => o.label)).toContain(
      "Read the external examiner report",
    );
    expect(options.who?.map((o) => o.value)).toContain(chairPersonId);
    void task;
  });

  it("closes the committee tasks an approved report says were finished", async () => {
    const task = await withTenantTx(DEPT_CS, async (tx) => {
      const created = await createRecord(tx, DEPT_CS, head, "task", {
        presetKey: "committee_task",
        parentRef: { subjectType: "committee", subjectId: committeeId },
        data: { title: "Write the syllabus comparison", assignee: chairPersonId },
      });
      await act(tx, created.id, "draft", "assign", head);
      return created;
    });
    const taskRow = await withTenantTx(DEPT_CS, (tx) =>
      tx.featureRecord.findUniqueOrThrow({ where: { id: task.id } }),
    );

    const record = await draftReport();
    await withTenantTx(DEPT_CS, async (tx) => {
      await saveStepDraft(tx, record.id, "draft", chair, {
        progress_summary: "The comparison is done.",
        completed_tasks: taskRow.taskId,
      });
      await act(tx, record.id, "draft", "submit", chair);
      await act(tx, record.id, "submitted", "review", head);
      await act(tx, record.id, "reviewed", "approve", head);
    });

    const after = await withTenantTx(DEPT_CS, async (tx) => ({
      record: await tx.featureRecord.findUniqueOrThrow({ where: { id: task.id } }),
      task: await tx.task.findUniqueOrThrow({ where: { id: taskRow.taskId! } }),
    }));
    expect(after.record.currentStateKey).toBe("completed");
    expect(after.task.completedAt).not.toBeNull();
  });
});
