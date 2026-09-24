import { expect, test } from "./fixtures/auth";

// The busy-time ledger from the one place a person meets it: their own availability page. The
// demo seed gives instructor1 a Monday 08:00–10:00 class, so the hours they offer on a Monday
// have to come back with that class already taken out of them.

test.describe("availability", () => {
  test.setTimeout(120_000);

  test("an instructor declares their hours and the ledger takes the class and the day away out of them", async ({
    pageAs,
  }) => {
    const page = await pageAs("instructor1.cs");
    await page.goto("/d/cs/availability");
    await expect(page.getByRole("heading", { name: "My availability", level: 1 })).toBeVisible();

    // the week they are in already shows what the department booked for them
    await expect(page.getByTestId("week-calendar")).toBeVisible();
    await expect(page.getByTestId("week-calendar").getByText("teaching").first()).toBeVisible();

    // Monday mornings, half-hourly, with a break before noon
    await page.getByRole("button", { name: "Add an opening" }).click();
    const window0 = page.getByTestId("window-0");
    await window0.getByLabel("Day").selectOption({ label: "Monday" });
    await window0.getByLabel("From").fill("09:00");
    await window0.getByLabel("To").fill("12:00");

    await page.getByRole("button", { name: "Add a break" }).click();
    const break0 = page.getByTestId("break-0");
    await break0.getByLabel("From").fill("11:00");
    await break0.getByLabel("To").fill("11:30");

    await page.getByLabel("Slot length").selectOption("30");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Your availability is saved.")).toBeVisible();

    // the class is 08:00–10:00, so the morning opens at 10:00; the break is not offered
    const slots = page.getByTestId("free-slots").getByRole("listitem");
    await expect(slots.filter({ hasText: "Mon 10:00–10:30" }).first()).toBeVisible();
    await expect(slots.filter({ hasText: "Mon 09:00–09:30" })).toHaveCount(0);
    await expect(slots.filter({ hasText: "Mon 11:00–11:30" })).toHaveCount(0);
    const mondaysBefore = await slots.filter({ hasText: "Mon " }).count();
    expect(mondaysBefore).toBeGreaterThan(0);

    // a day away covers the next Monday, and those slots go
    const nextMonday = mondayAfter(new Date());
    await page.getByRole("button", { name: "Add a day away" }).click();
    const away0 = page.getByTestId("away-0");
    await away0.getByLabel("From").fill(`${nextMonday}T00:00`);
    await away0.getByLabel("To").fill(`${nextMonday}T23:59`);
    await away0.getByLabel("Reason").fill("Conference");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Your availability is saved.")).toBeVisible();

    await expect
      .poll(async () => page.getByTestId("free-slots").getByRole("listitem").filter({ hasText: "Mon " }).count())
      .toBeLessThan(mondaysBefore);

    // the day away is busy time like any other: it is in the ledger, not only in the policy
    await page.reload();
    await expect(page.getByTestId("away-0").getByLabel("Reason")).toHaveValue("Conference");
  });
});

/** The next Monday after today, as yyyy-mm-dd. */
function mondayAfter(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  do {
    day.setUTCDate(day.getUTCDate() + 1);
  } while (day.getUTCDay() !== 1);
  return day.toISOString().slice(0, 10);
}
