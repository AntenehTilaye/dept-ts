import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures/auth";
import { waitForMail } from "./fixtures/mailpit";

/** selectOption only takes exact labels; this picks the first option whose text matches. */
async function selectMatching(select: Locator, pattern: RegExp) {
  const value = await select.locator("option").evaluateAll((opts, src) => {
    const re = new RegExp(src);
    const hit = (opts as HTMLOptionElement[]).find((o) => re.test(o.textContent ?? ""));
    return hit?.value ?? null;
  }, pattern.source);
  if (!value) throw new Error(`no option matching ${pattern}`);
  await select.selectOption(value);
}

test.describe("registry", () => {
  test.setTimeout(120_000);

  test("the head builds a year, term, period, program, course with predecessor and an offering with two sections", async ({
    pageAs,
  }) => {
    const page = await pageAs("dh.cs");
    const stamp = Date.now().toString().slice(-5);

    // calendar: year + term + add/drop period
    await page.goto("/d/cs/calendar");
    await expect(page.getByTestId("year-2026/27")).toBeVisible();
    const yearForm = page.locator("form", { has: page.getByRole("button", { name: "Add year" }) });
    await yearForm.getByLabel("Code").fill("2028/29");
    await yearForm.getByLabel("Starts").fill("2028-09-11");
    await yearForm.getByLabel("Ends").fill("2029-07-13");
    await yearForm.getByRole("button", { name: "Add year" }).click();
    await expect(page.getByTestId("year-2028/29")).toBeVisible();

    const termForm = page.locator("form", { has: page.getByRole("button", { name: "Add term" }) });
    await termForm.getByLabel("Academic year").selectOption({ label: "2028/29" });
    await termForm.getByLabel("Name").fill("Semester I");
    await termForm.getByLabel("Starts").fill("2028-09-11");
    await termForm.getByLabel("Ends").fill("2029-01-31");
    await termForm.getByRole("button", { name: "Add term" }).click();
    await expect(page.getByTestId("year-2028/29").getByTestId("term-Semester I")).toBeVisible();

    const periodForm = page.locator("form", {
      has: page.getByRole("button", { name: "Add period" }),
    });
    await periodForm.getByLabel("Term").selectOption({ label: "2028/29 · Semester I" });
    await periodForm.getByLabel("Kind").selectOption("add_drop");
    await periodForm.getByLabel("Label").fill("Add/Drop 2028");
    await periodForm.getByLabel("Starts").fill("2028-09-11T08:00");
    await periodForm.getByLabel("Ends").fill("2028-09-25T17:00");
    await periodForm.getByRole("button", { name: "Add period" }).click();
    await expect(page.getByTestId("year-2028/29")).toContainText("Add/Drop 2028");

    // program
    await page.goto("/d/cs/programs");
    await page.getByLabel("Code").fill(`MSC${stamp}`);
    await page.getByLabel("Name").fill("MSc in Data Science");
    await page.getByLabel("Degree level").fill("MSc");
    await page.getByLabel("Duration (years)").fill("2");
    await page.getByRole("button", { name: "Add program" }).click();
    await expect(page.getByTestId(`program-MSC${stamp}`)).toBeVisible();

    // course with predecessor CS201
    await page.goto("/d/cs/courses");
    await expect(page.getByTestId("course-CS201")).toContainText("CS200");
    await page.getByLabel("Code").fill(`CS9${stamp}`);
    await page.getByLabel("Title").fill("Data Structures III");
    await page.getByLabel("Credit hours").fill("4");
    await selectMatching(page.getByLabel("Predecessor"), /CS201/);
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByTestId(`course-CS9${stamp}`)).toContainText("CS201");

    // offering with two sections and two instructors
    await page.goto("/d/cs/offerings");
    const offerForm = page.locator("form", {
      has: page.getByRole("button", { name: "Create offering" }),
    });
    await selectMatching(offerForm.getByLabel("Course"), new RegExp(`CS9${stamp}`));
    await offerForm.getByLabel("Coordinator").selectOption({ label: "Instructor One" });
    await offerForm.getByRole("button", { name: "Create offering" }).click();
    await expect(offerForm.getByRole("alert")).toContainText("Offering created.");
    await page.goto("/d/cs/offerings");
    await page.getByTestId(`offering-CS9${stamp}`).getByRole("link").click();
    await expect(page.getByRole("heading", { name: /Data Structures III/ })).toBeVisible();
    for (const code of ["CS-Y2-A", "CS-Y2-B"]) {
      const add = page.locator("form", { has: page.getByRole("button", { name: "Add section" }) });
      await selectMatching(add.getByLabel("Section", { exact: true }), new RegExp(`^${code} `));
      await add.getByRole("button", { name: "Add section" }).click();
      await expect(page.getByTestId(`section-offering-${code}`)).toBeVisible();
    }
    for (const [code, name] of [
      ["CS-Y2-A", "Instructor Two"],
      ["CS-Y2-B", "Instructor Three"],
    ] as const) {
      const card = page.getByTestId(`section-offering-${code}`);
      await card.getByLabel("Instructor").selectOption({ label: name });
      await card.getByRole("button", { name: "Assign" }).click();
      await expect(card.getByTestId("teaching-list")).toContainText(name);
    }
    await expect(page.getByTestId("section-offering-CS-Y2-A")).toContainText("10 enrolled");
  });

  test("the head finds an instructor by partial name and sees their teaching", async ({
    pageAs,
  }) => {
    const page = await pageAs("dh.cs");
    await page.goto("/d/cs/people?q=inst");
    const row = page.getByTestId("person-instructor1.cs@deptts.local");
    await expect(row).toBeVisible();
    await row.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Instructor One" })).toBeVisible();
    await expect(page.getByTestId("staff-profile")).toContainText("CS-003");
    await expect(page.getByTestId("teaching")).toContainText("CS201 CS-Y2-A");
    await expect(page.getByTestId("groups")).toContainText("Curriculum Committee");
    await expect(page.getByTestId("profile-items")).toContainText("MSc Computer Science");
  });

  test("assigning a section representative sends the invite mail", async ({ pageAs }) => {
    const page = await pageAs("dh.cs");
    await page.goto("/d/cs/sections");
    const card = page.getByTestId("section-CS-Y2-B");
    await expect(card).toBeVisible();
    await card.getByLabel("Student").selectOption({ label: "Student 02" });
    await card.getByRole("button", { name: "Assign representative" }).click();
    await expect(card.getByTestId("representatives")).toContainText("Student 02");
    const mail = await waitForMail({
      to: "student02.cs@deptts.local",
      subjectIncludes: "Set your DeptTS password",
    });
    expect(mail.links.some((l) => l.includes("/api/auth/reset-password/"))).toBe(true);
  });

  test("the EE head does not see CS people and instructors cannot open the registry", async ({
    pageAs,
  }) => {
    const ee = await pageAs("dh.ee");
    await ee.goto("/d/ee/people?q=inst");
    await expect(ee.getByText("No one matches.")).toBeVisible();
    await expect(ee.getByTestId("person-instructor1.cs@deptts.local")).toHaveCount(0);
    const instructor = await pageAs("instructor1.cs");
    expect((await instructor.goto("/d/cs/calendar"))?.status()).toBe(404);
    await instructor.goto("/d/cs");
    await expect(instructor.getByRole("link", { name: "People" })).toBeVisible();
    await expect(instructor.getByRole("link", { name: "Calendar" })).toHaveCount(0);
  });
});
