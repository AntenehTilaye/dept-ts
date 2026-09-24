import { expect, test } from "./fixtures/auth";

const TXT = Buffer.from("The CS201 examination paper.\n");

// The task journey, unchanged since P7 — but there is no task module any more: a task is a
// record of the `task` feature, created, shown and moved by the generic feature runtime.

test.describe("task skeleton", () => {
  test.setTimeout(150_000);

  test("the head assigns a task with a deliverable; the instructor acknowledges, uploads and submits; the head approves", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const title = `Draft the CS201 rubric ${stamp}`;

    // create the task with a required deliverable, due in two days. /d/cs/tasks/new is the
    // readable URL of the feature's own create page.
    await dh.goto("/d/cs/tasks/new");
    await dh.getByLabel("Title").fill(title);
    await dh.getByLabel("What has to be done").fill("Draft the marking rubric and upload it here.");
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    await dh.getByLabel("Due").fill(due);
    await dh.getByLabel("Assigned to").selectOption({ label: "Instructor One" });
    const deliverables = dh.getByTestId("group-deliverables");
    await deliverables.getByRole("button", { name: "Add entry" }).click();
    await deliverables.getByLabel("Key").fill("rubric");
    await deliverables.getByLabel("Label").fill("Marking rubric");
    await deliverables.getByLabel("Required").check();
    await dh.getByRole("button", { name: "Create task" }).click();
    // the "new" page redirects to the record; exclude it so the id is never "new"
    await expect(dh).toHaveURL(/\/d\/cs\/f\/task\/(?!new$)[a-z0-9]+$/);
    const recordId = dh.url().split("/").pop()!;
    // a record starts as a draft its creator can still fix; assigning it is what tells the
    // assignee about it
    await expect(dh.getByTestId("state-badge")).toHaveText("Draft");
    await dh.getByRole("button", { name: "assign" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Assigned");
    await expect(dh.getByTestId("due-badge")).toBeVisible();

    // the instructor finds it in My work and in the inbox, and acknowledges it
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs/my-work");
    await expect(instructor.getByTestId(`task-${recordId}`)).toContainText(title);
    await instructor.goto("/d/cs/inbox");
    const item = instructor.getByTestId("notification-feature_record").filter({ hasText: title });
    await item.getByRole("button", { name: "Acknowledge" }).click();
    await expect(item.getByText("acknowledged")).toBeVisible();

    // the acknowledgement started the task (outbox cron dispatches within a minute)
    await expect
      .poll(
        async () => {
          await instructor.goto(`/d/cs/tasks/${recordId}`);
          return instructor.getByTestId("state-badge").textContent();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe("In progress");

    // submit is blocked until the required slot holds a file
    await expect(instructor.getByRole("button", { name: "submit" })).toBeDisabled();
    await instructor.getByRole("tab", { name: "Deliverables" }).click();
    const slot = instructor.getByTestId("slot-rubric");
    await expect(slot).toHaveAttribute("data-satisfied", "false");
    await slot.getByLabel("Upload").setInputFiles({
      name: "rubric.txt",
      mimeType: "text/plain",
      buffer: TXT,
    });
    await expect(instructor.getByText("rubric.txt uploaded")).toBeVisible();
    await expect(instructor.getByTestId("slot-rubric")).toHaveAttribute("data-satisfied", "true");

    await instructor.getByRole("button", { name: "submit" }).click();
    await expect(instructor.getByTestId("state-badge")).toHaveText("Submitted");

    // the head reviews and approves
    await dh.goto(`/d/cs/tasks/${recordId}`);
    await dh.getByRole("button", { name: "review" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Under review");
    await dh.getByRole("button", { name: "approve" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Completed");

    // history shows every transition, acknowledgements show who and when
    await dh.getByRole("tab", { name: "History" }).click();
    const history = dh.getByTestId("audit-panel");
    for (const step of ["assigned", "in_progress", "submitted", "under_review", "completed"]) {
      await expect(history).toContainText(step);
    }
    await dh.getByRole("tab", { name: "Acknowledgements" }).click();
    await expect(dh.getByTestId("acknowledgements")).toContainText("Instructor One");
    await expect(dh.getByTestId("acknowledgements")).toContainText("acknowledged");

    // the completed task leaves the open lists and shows up under "Done"
    await instructor.goto("/d/cs/my-work");
    await expect(instructor.getByTestId(`task-${recordId}`)).toHaveCount(0);
    await dh.goto("/d/cs/tasks?view=done");
    await expect(dh.getByTestId(`record-${recordId}`)).toBeVisible();
  });

  test("the seeded department-wide task reaches every instructor's my-work", async ({ pageAs }) => {
    for (const key of ["instructor1.cs", "chair.cs"]) {
      const page = await pageAs(key);
      await page.goto("/d/cs/my-work");
      await expect(
        page.getByRole("link", { name: "Confirm your office hours for Semester I" }),
      ).toBeVisible();
    }
  });
});
