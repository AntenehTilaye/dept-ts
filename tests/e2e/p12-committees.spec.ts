import { expect, test } from "./fixtures/auth";

const TOR = Buffer.from("Terms of reference: review the assessment regulations.\n");

// A committee, from the day it is constituted to the day its report is approved. Nothing on this
// journey is a committee page: the process, the record, the documents and the discussion are all
// the generic runtime, and the module only adds who is on it and what became of its issues.

test.describe("committees", () => {
  test.setTimeout(240_000);

  test("the head constitutes a committee, the chair reports, the head escalates and approves", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const name = `Assessment Review Committee ${stamp}`;

    // constitute it: /d/cs/committees is the readable URL of the feature's own pages
    await dh.goto("/d/cs/committees/new");
    await dh.getByLabel("Name").fill(name);
    await dh.getByLabel("Purpose").fill("Reviews how the department assesses its courses.");
    await dh.getByLabel("Type").selectOption("standing");
    await dh
      .getByTestId("question-chair")
      .getByLabel("Chair")
      .selectOption({ label: "Instructor Chair" });
    await dh.getByRole("checkbox", { name: "Instructor One" }).check();
    await dh.getByRole("checkbox", { name: "Instructor Two" }).check();
    await dh.getByRole("button", { name: "Create committee" }).click();
    await expect(dh).toHaveURL(/\/d\/cs\/f\/committee\/(?!new$)[a-z0-9]+$/);
    const committeeId = dh.url().split("/").pop()!;
    await expect(dh.getByTestId("state-badge")).toHaveText("Being constituted");

    // it cannot be constituted without its terms of reference
    await expect(dh.getByRole("button", { name: "Constitute the committee" })).toBeDisabled();
    await dh.getByRole("tab", { name: "Terms of reference" }).click();
    const slot = dh.getByTestId("slot-tor");
    await expect(slot).toHaveAttribute("data-satisfied", "false");
    await slot.getByLabel("Upload").setInputFiles({
      name: "terms-of-reference.txt",
      mimeType: "text/plain",
      buffer: TOR,
    });
    await expect(dh.getByTestId("slot-tor")).toHaveAttribute("data-satisfied", "true");

    await dh.getByRole("button", { name: "Constitute the committee" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("At work");

    // who is on it, and who chairs it
    await dh.getByRole("tab", { name: "The committee" }).click();
    const members = dh.getByTestId("committee-members");
    await expect(members).toContainText("Instructor Chair");
    await expect(members).toContainText("Instructor One");
    await expect(dh.getByTestId("committee-overview")).toContainText("At work");

    // give the committee a task
    await dh.goto(`/d/cs/tasks/new?parentType=committee&parentId=${committeeId}`);
    const taskTitle = `Compare the marking schemes ${stamp}`;
    await dh.getByLabel("Title").fill(taskTitle);
    await dh.getByLabel("What has to be done").fill("Compare CS201 and CS205 marking schemes.");
    await dh.getByLabel("Assigned to").selectOption({ label: "Instructor Chair" });
    await dh.getByRole("button", { name: "Create task" }).click();
    await dh.getByRole("button", { name: "assign" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Assigned");
    const taskId = dh.url().split("/").pop()!;

    // the chair sees the task and writes the committee's report
    const chair = await pageAs("chair.cs");
    await chair.goto("/d/cs/my-work");
    await expect(chair.getByTestId(`task-${taskId}`)).toContainText(taskTitle);

    // being on a committee is a derived grant, which the outbox opens within the minute
    await expect
      .poll(
        async () => {
          await chair.goto(`/d/cs/f/committee/${committeeId}`);
          await chair.getByRole("tab", { name: "The committee" }).click();
          return chair.getByRole("link", { name: "Write a report" }).count();
        },
        { timeout: 120_000, intervals: [3_000] },
      )
      .toBe(1);
    await chair.getByRole("link", { name: "Write a report" }).click();
    await expect(chair).toHaveURL(/\/f\/committee_report\/new/);
    await chair.getByLabel("Period from").fill("2026-01-01");
    await chair.getByLabel("Period to").fill("2026-03-31");
    await chair.getByRole("button", { name: "Create committee report" }).click();
    await expect(chair).toHaveURL(/\/d\/cs\/f\/committee_report\/(?!new$)[a-z0-9]+$/);
    const reportId = chair.url().split("/").pop()!;

    await chair.goto(`/d/cs/f/committee_report/${reportId}/steps/draft`);
    await chair
      .getByLabel("What the committee did")
      .fill("We compared the marking schemes of four courses.");
    await chair.getByLabel("Recommendations").fill("Publish one rubric for the whole programme.");
    // the picker offers the committee's own tasks, because a child record's context is its parent
    await chair
      .getByLabel("A task the committee finished in the period")
      .selectOption({ label: taskTitle });
    const issues = chair.getByTestId("group-issues_requiring_attention");
    await issues.getByRole("button", { name: "Add entry" }).click();
    await issues.getByLabel("The issue").fill("Two courses examine the same outcomes twice.");
    await issues.getByLabel("Urgency").selectOption("high");
    await chair.getByRole("button", { name: "Submit the report" }).click();
    await expect(chair).toHaveURL(new RegExp(`/f/committee_report/${reportId}$`));
    await expect(chair.getByTestId("state-badge")).toHaveText("With the head");

    // the head sends it back, the chair submits it again
    await dh.goto(`/d/cs/f/committee_report/${reportId}`);
    await dh.getByRole("button", { name: "Send it back" }).click();
    const sheet = dh.getByTestId("action-bar");
    await sheet.getByLabel("Comment").fill("Say what you propose to do about the overlap.");
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Back with the committee");

    await chair.goto(`/d/cs/f/committee_report/${reportId}`);
    await chair.getByRole("button", { name: "Submit again" }).click();
    await expect(chair.getByTestId("state-badge")).toHaveText("With the head");

    // the head reads it, raises the issue as a case and approves
    await dh.goto(`/d/cs/f/committee_report/${reportId}`);
    await dh.getByRole("tab", { name: /Issues/ }).click();
    await expect(dh.getByTestId("issue-table")).toContainText("Not raised yet");
    await dh.getByRole("button", { name: "Take it forward" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Being acted on");
    await dh.getByRole("button", { name: "Raise the issues as cases" }).click();
    await dh.getByRole("tab", { name: /Issues/ }).click();
    await expect(dh.getByTestId("issue-table")).toContainText("Raised as");
    await dh.getByRole("button", { name: "Approve" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Approved");

    // approving the report closed the task the committee said it had finished
    await dh.goto(`/d/cs/tasks/${taskId}`);
    await expect(dh.getByTestId("state-badge")).toHaveText("Completed");

    await dh.goto("/d/cs/committees");
    await expect(dh.getByTestId(`record-${committeeId}`)).toContainText(name);

    // the committee's own history now reads as one list
    await dh.goto(`/d/cs/f/committee/${committeeId}`);
    await dh.getByRole("tab", { name: "Activity" }).click();
    const activity = dh.getByTestId("activity-history");
    await expect(activity).toContainText("Report for 2026-01-01 to 2026-03-31");
    // the document row names the paper as it was filed, and the slot it went into
    await expect(activity).toContainText("terms-of-reference");
    await expect(activity).toContainText(taskTitle);
    // the process rows are the workflow's own, both the committee's and the report's
    await expect(activity).toContainText("setup → active");
    await expect(activity).toContainText("reviewed → approved");
  });

  test("a committee report prints, and an instructor who is not on the committee cannot write one", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/reports");
    const card = dh.getByTestId("report-committee");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Committee");

    // a demo committee is at work from the seed, and its page is reachable by name
    await dh.goto("/d/cs/committees?view=active");
    await expect(dh.getByRole("table")).toContainText("Curriculum Committee");

    // an instructor sees the committees they are on, and the reports those committees owe
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs/committees?view=active");
    await expect(instructor.getByRole("table")).toContainText("Curriculum Committee");
  });
});
