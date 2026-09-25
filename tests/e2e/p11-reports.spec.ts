import { expect, test } from "./fixtures/auth";

// Reports from the reader's side: pick one, choose a format, get a file. The formats that need
// the worker say so and land in the list when they are ready.

test.describe("reports", () => {
  test.setTimeout(150_000);

  test("the head generates the department activity report as a page and as a PDF", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/reports");
    await expect(dh.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

    const activity = dh.getByTestId("report-department_activity");
    await expect(activity).toBeVisible();

    // html is rendered in the request, so the file is there at once
    const download = dh.waitForEvent("download");
    await activity.getByRole("button", { name: "HTML" }).click();
    await expect(dh.getByText("Ready.")).toBeVisible();
    expect((await download).suggestedFilename()).toContain("department-activity");

    // a PDF needs a browser, so the worker renders it and the run says where it stands
    await activity.getByRole("button", { name: "PDF" }).click();
    await expect(dh.getByText("Being prepared", { exact: false })).toBeVisible();
    await expect
      .poll(
        async () => {
          await dh.reload();
          const rows = dh.locator('[data-testid^="run-"][data-status="done"]');
          return rows.count();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(dh.getByRole("link", { name: "Download" }).first()).toBeVisible();
  });

  test("a report somebody may not run is not offered to them", async ({ pageAs }) => {
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs/reports");
    // these reports are about the whole department, and an instructor's task permission is
    // their own assignments: they are offered none of them, and told so
    await expect(instructor.getByTestId("report-audit_extract")).toHaveCount(0);
    await expect(instructor.getByTestId("report-department_activity")).toHaveCount(0);
    await expect(instructor.getByText("No reports for your role")).toBeVisible();
  });
});
