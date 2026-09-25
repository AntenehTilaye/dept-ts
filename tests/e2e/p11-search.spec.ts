import { expect, test } from "./fixtures/auth";

// Search from the box somebody actually uses. The index is built by the seed and kept current by
// the outbox, so what the department holds is findable — and only by the people who may open it.

test.describe("search", () => {
  test.setTimeout(120_000);

  test("the head finds a course and a person, grouped by what they are", async ({ pageAs }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/search?q=CS201");
    await expect(dh.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();

    const results = dh.getByTestId("search-results");
    await expect(results).toBeVisible();
    await expect(results.getByRole("heading", { name: "Courses" })).toBeVisible();
    await expect(results.getByRole("link", { name: /CS201/ }).first()).toBeVisible();

    // a person is found by their name, and the box keeps what was typed
    await dh.getByLabel("What are you looking for?").fill("Instructor One");
    await dh.getByRole("button", { name: "Search" }).click();
    await expect(dh).toHaveURL(/q=Instructor\+One/);
    await expect(dh.getByTestId("hit-person").first()).toContainText("Instructor One");
  });

  test("the command palette suggests records while you type", async ({ pageAs }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs");
    await dh.getByRole("button", { name: "Open command palette" }).click();
    await dh.getByPlaceholder("Type a page name, a person, a course…").fill("CS201");
    await expect(dh.getByRole("option", { name: /CS201/ }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a search only shows what the reader may open", async ({ pageAs }) => {
    // the head's own task exists; the student representative may not see it
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/search?q=examination");
    const headHits = await dh.getByTestId("search-results").getByRole("listitem").count();
    expect(headHits).toBeGreaterThan(0);

    const rep = await pageAs("rep.cs");
    await rep.goto("/d/cs/search?q=examination");
    const repHits = await rep
      .getByTestId("search-results")
      .getByRole("listitem")
      .count()
      .catch(() => 0);
    expect(repHits).toBeLessThan(headHits);
  });
});
