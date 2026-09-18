import { test as setup, expect } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./fixtures/users";

// Logs in every seeded user once and stores the session for the chromium project.
setup("authenticate seeded users", async ({ browser }) => {
  for (const user of E2E_USERS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await context.storageState({ path: storageStatePath(user.key) });
    await context.close();
  }
});
