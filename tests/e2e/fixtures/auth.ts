import { test as base, type Page } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./users";

type Fixtures = {
  /** Opens a new page authenticated as the seeded user with the given key. */
  pageAs: (key: string) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  pageAs: async ({ browser }, use) => {
    const contexts: Array<{ close(): Promise<void> }> = [];
    await use(async (key) => {
      if (!E2E_USERS.some((u) => u.key === key)) throw new Error(`unknown e2e user "${key}"`);
      const context = await browser.newContext({ storageState: storageStatePath(key) });
      contexts.push(context);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },
});

export { expect } from "@playwright/test";
