import { expect, test } from "./fixtures/auth";

test.describe("department selection", () => {
  test("a single-department member skips the picker", async ({ pageAs }) => {
    const page = await pageAs("dh.ee");
    await page.goto("/select-department");
    await expect(page).toHaveURL(/\/d\/ee$/);
    await expect(page.getByRole("heading", { name: "Electrical Engineering" })).toBeVisible();
  });

  test("an administrator sees every department and the administration link", async ({ pageAs }) => {
    const page = await pageAs("admin");
    await page.goto("/select-department");
    await expect(page.getByRole("heading", { name: "Choose a department" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open CS" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open EE" })).toBeVisible();
    await page.getByRole("button", { name: "Open EE" }).click();
    await expect(page).toHaveURL(/\/d\/ee$/);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Permissions" })).toBeVisible();
  });

  test("members cannot open another department or the administration area", async ({ pageAs }) => {
    const page = await pageAs("instructor1.cs");
    const other = await page.goto("/d/ee");
    expect(other?.status()).toBe(404);
    const admin = await page.goto("/admin");
    expect(admin?.status()).toBe(404);
    await page.goto("/d/cs");
    await expect(page.getByTestId("role-keys")).toContainText("instructor");
  });

  test("signing out clears the session", async ({ pageAs }) => {
    const page = await pageAs("rep.cs");
    await page.goto("/d/cs");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/d/cs");
    await expect(page).toHaveURL(/\/login/);
  });
});
