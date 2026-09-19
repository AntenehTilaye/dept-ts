import { expect, test } from "./fixtures/auth";

test.describe("audit and workflows", () => {
  test("the head renames a person and the administrator sees the before/after row with the actor", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/people?q=Instructor%20Two");
    await dh.getByTestId("person-instructor2.cs@deptts.local").getByRole("link").click();
    const stamp = Date.now().toString().slice(-4);
    const edit = dh.getByTestId("edit-person");
    await edit.getByLabel("Full name").fill(`Instructor Two ${stamp}`);
    await edit.getByRole("button", { name: "Save person" }).click();
    await expect(edit.getByRole("alert")).toContainText("Person saved.");
    // the action response carries the refreshed tree; under a parallel run it can take a while
    await expect(dh.getByRole("heading", { name: `Instructor Two ${stamp}` })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dh.getByTestId("audit-panel")).toContainText(`Instructor Two ${stamp}`);

    const admin = await pageAs("admin");
    await admin.goto("/admin/audit?subjectType=person&action=update");
    const row = admin.getByTestId("audit-update-person").first();
    await expect(row).toContainText("dh.cs@deptts.local");
    await expect(row).toContainText(`Instructor Two ${stamp}`);
    await expect(row).toContainText("fullName");
  });

  test("tenant bypass rows appear for faculty pages and the workflow list explains the empty state", async ({
    pageAs,
  }) => {
    const admin = await pageAs("admin");
    await admin.goto("/admin/permissions?scope=dep_cs&role=deputy_head");
    await admin.goto("/admin/audit?action=tenant_bypass");
    await expect(admin.getByTestId("audit-tenant_bypass-department").first()).toContainText(
      "admin@deptts.local",
    );
    await admin.goto("/admin/workflows");
    await expect(admin.getByTestId("workflows-empty")).toContainText("feature is published");
  });
});
