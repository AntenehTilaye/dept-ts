import { expect, test } from "./fixtures/auth";

// The page everybody opens first. A head sees the department; an instructor sees their own week;
// both see only what their role allows, because a widget is gated like any other read.

test.describe("the dashboard", () => {
  test.setTimeout(120_000);

  test("the head sees the department, the instructor sees their own work", async ({ pageAs }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs");
    const dashboard = dh.getByTestId("dashboard");
    await expect(dashboard).toBeVisible();
    await expect(dh.getByTestId("widget-myWork")).toBeVisible();
    // who is carrying what, and what each process has open, are the head's widgets
    await expect(dh.getByTestId("widget-departmentLoad")).toBeVisible();
    await expect(dh.getByTestId("widget-pendingWork")).toBeVisible();

    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs");
    await expect(instructor.getByTestId("widget-myWork")).toBeVisible();
    await expect(instructor.getByTestId("widget-departmentLoad")).toHaveCount(0);
  });

  test("a tile leads to the list it counted", async ({ pageAs }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs");
    await dh.getByTestId("widget-myWork").getByRole("link", { name: "My work" }).click();
    await expect(dh).toHaveURL(/\/d\/cs\/my-work/);
    await expect(dh.getByRole("heading", { name: "My work", level: 1 })).toBeVisible();
  });

  test("the administrator can rebuild the derived data", async ({ pageAs }) => {
    const admin = await pageAs("admin");
    await admin.goto("/admin/jobs");
    const rebuilds = admin.getByTestId("rebuilds");
    await expect(rebuilds).toBeVisible();
    await rebuilds.getByRole("button", { name: "Rebuild the dashboards" }).click();
    // the action announces itself twice on purpose: a toast, and a live region for a reader
    await expect(admin.getByText("Queued; the worker rebuilds them.").first()).toBeVisible();
  });
});
