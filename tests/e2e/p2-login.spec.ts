import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "./fixtures/users";
import { waitForMail } from "./fixtures/mailpit";

test.describe("sign-in", () => {
  test("anonymous visitors of a department page are sent to login and back after signing in", async ({
    page,
  }) => {
    await page.goto("/d/cs");
    await expect(page).toHaveURL(/\/login\?next=%2Fd%2Fcs/);
    await page.getByLabel("Email").fill("dh.cs@deptts.local");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/d\/cs$/);
    await expect(page.getByRole("heading", { name: "Computer Science" })).toBeVisible();
    await expect(page.getByTestId("role-keys")).toContainText("department_head");
  });

  test("a wrong password shows an error and stays on the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("dh.cs@deptts.local");
    await page.getByLabel("Password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a new user set by the administrator receives a set-password mail and can sign in", async ({
    browser,
    page,
  }) => {
    // administrator creates the account
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@deptts.local");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/select-department/);
    await page.goto("/admin/users");
    const email = `e2e.newbie.${Date.now()}@deptts.local`;
    await page.getByLabel("Full name").fill("E2E Newbie");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Department", { exact: true }).selectOption("dep_cs");
    await page.getByRole("checkbox", { name: "instructor" }).check();
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByTestId(`user-${email}`)).toBeVisible();

    // the mail carries the set-password link
    const mail = await waitForMail({ to: email, subjectIncludes: "Set your DeptTS password" });
    // better-auth mails /api/auth/reset-password/<token>?callbackURL=/set-password, which
    // redirects to /set-password?token=<token>
    const link = mail.links.find((l) => l.includes("/api/auth/reset-password/"));
    expect(link).toBeTruthy();

    // the new user sets a password in a fresh browser context
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await fresh.goto(link!);
    await expect(fresh).toHaveURL(/\/set-password\?token=/);
    await fresh.getByLabel("Choose a password").fill("Brand-new-pass-1");
    await fresh.getByLabel("Confirm password").fill("Brand-new-pass-1");
    await fresh.getByRole("button", { name: "Set password" }).click();
    await expect(fresh).toHaveURL(/\/login/);
    await fresh.getByLabel("Email").fill(email);
    await fresh.getByLabel("Password").fill("Brand-new-pass-1");
    await fresh.getByRole("button", { name: /sign in/i }).click();
    await expect(fresh).toHaveURL(/\/d\/cs$/);
    await expect(fresh.getByTestId("role-keys")).toContainText("instructor");
    await context.close();
  });
});
