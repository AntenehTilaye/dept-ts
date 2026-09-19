import { expect, test } from "./fixtures/auth";
import { waitForMail } from "./fixtures/mailpit";

test.describe("inbox, templates and reminders", () => {
  test.setTimeout(120_000);

  test("the seeded notifications show in the inbox and the badge; the head acknowledges one and declines the other", async ({
    pageAs,
  }) => {
    const page = await pageAs("dh.cs");
    await page.goto("/d/cs");
    await expect(page.getByTestId("inbox-badge")).toBeVisible();
    await page.getByTestId("inbox-link").click();
    await expect(page).toHaveURL(/\/d\/cs\/inbox/);
    const policy = page.getByTestId("notification-demo").filter({ hasText: "assessment policy" });
    await policy.getByRole("button", { name: "Acknowledge" }).click();
    await expect(policy.getByText("acknowledged")).toBeVisible();
    const duty = page.getByTestId("notification-demo").filter({ hasText: "Invigilation duty" });
    await duty.getByLabel("Reason").fill("Conference travel");
    await duty.getByRole("button", { name: "Decline" }).click();
    await expect(duty.getByText("declined")).toBeVisible();
    await expect(duty.getByText("Reason: Conference travel")).toBeVisible();
    await page.goto("/d/cs/inbox?filter=ack");
    await expect(page.getByText("Nothing here.")).toBeVisible();
  });

  test("the administrator edits deadline_reminder, previews, activates, and a fired reminder mail carries the new wording", async ({
    pageAs,
  }) => {
    const admin = await pageAs("admin");
    await admin.goto("/admin/templates");
    await admin.getByTestId("template-deadline_reminder").getByRole("link").click();
    await expect(admin.getByTestId("template-preview")).toContainText("Reminder");
    const stamp = `Friendly nudge ${Date.now().toString().slice(-4)}`;
    await admin
      .getByLabel("Email subject")
      .fill(`[{{department_code}}] ${stamp}: {{subject_label}}`);
    await admin.getByRole("button", { name: "Save new version" }).click();
    const versionForm = admin.locator("form", {
      has: admin.getByRole("button", { name: "Save new version" }),
    });
    await expect(versionForm.getByRole("alert")).toContainText("Version saved.");
    await admin.reload();
    // v2 on a fresh database; a retry after a failed attempt sees a later version
    await expect(admin.getByText(/v[2-9] active/)).toBeVisible();
    await expect(admin.getByTestId("template-preview")).toContainText(stamp);

    // the reminders page shows the seeded schedules and the dry run for 14 days
    await admin.goto("/admin/reminders?days=14");
    await expect(admin.getByTestId("schedule-default_7_3_1_0_overdue")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Dry run" })).toBeVisible();
    await admin.goto("/admin/jobs");
    await expect(admin.getByTestId("worker-heartbeat")).toContainText("alive");

    // a test reminder fired from the admin page reaches the head's mailbox with the new wording
    await admin.goto("/admin/reminders?days=14&department=dep_cs");
    const fire = admin.locator("form", {
      has: admin.getByRole("button", { name: "Fire a test reminder now" }),
    });
    await fire.getByRole("button", { name: "Fire a test reminder now" }).click();
    await expect(fire.getByRole("alert")).toContainText("Test reminder scheduled");
    const mail = await waitForMail({
      to: "dh.cs@deptts.local",
      subjectIncludes: stamp,
      timeoutMs: 60_000,
    });
    expect(mail.subject).toContain("Computer Science");
    expect(mail.text).toContain("Hello Dr. Hanna Bekele");
    await admin.reload();
    await expect(admin.getByTestId("dry-run-row").first()).toBeVisible();
  });
});
