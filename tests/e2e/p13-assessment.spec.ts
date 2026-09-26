import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures/auth";

// Marking a section, as the person marking it does it: the scheme is set out, the template comes
// down with the right columns on it, the filled-in sheet goes back up, the problems are shown
// against the lines that have them, the fixable ones are fixed and the marks are committed. The
// figures that follow are computed by the worker, so the page waits for them rather than assuming.

const FIXTURES = join(process.cwd(), "tests/fixtures/files");

test.describe("marking a section", () => {
  test.setTimeout(240_000);

  test("the head sets the scheme, the instructor uploads marks, fixes the bad rows and commits", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");

    // the sheet's students are all in CS-Y2-A, so that is the section this marks
    await dh.goto("/d/cs/assessment");
    const sections = dh.getByTestId("markable-sections");
    await expect(sections).toContainText("CS201");
    await sections
      .getByRole("row")
      .filter({ hasText: "CS201" })
      .filter({ hasText: "CS-Y2-A" })
      .first()
      .getByRole("link")
      .click();
    await expect(dh).toHaveURL(/\/d\/cs\/assessment\/[a-z0-9]+$/);
    const sectionUrl = dh.url();

    // the scheme is what a mark sheet's columns are, so it comes first
    const editor = dh.getByTestId("scheme-editor");
    await expect(editor).toBeVisible();
    await expect(dh.getByTestId("scheme-weight")).toHaveText("100% of 100");

    // the instructor of the section takes it from here
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto(sectionUrl);
    await expect(instructor.getByTestId("mark-sheet-upload")).toBeVisible();

    // the template already has one column per component
    const template = await instructor.request.get(
      `${new URL(sectionUrl).pathname}/template?kind=assessment&format=csv`,
    );
    expect(template.ok()).toBe(true);
    const header = (await template.text()).split("\n")[0]!;
    expect(header).toContain("Student number");
    expect(header).toContain("Quiz");
    expect(header).toContain("Final");

    // the filled-in sheet goes back up, and the import it starts is an ordinary import record
    await instructor
      .getByTestId("mark-sheet-upload")
      .getByLabel("The file")
      .setInputFiles({
        name: "assessment-errors.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: await readFile(join(FIXTURES, "assessment-errors.xlsx")),
      });
    await expect(instructor).toHaveURL(/\/d\/cs\/imports\/[a-z0-9]+$/, { timeout: 60_000 });
    const importUrl = instructor.url();
    await expect(instructor.getByTestId("state-badge")).toHaveText("Columns");

    // the headers are spelled the marker's way and were matched anyway
    await instructor.getByRole("tab", { name: "Columns" }).click();
    await expect(
      instructor.getByTestId("map-student_number").getByRole("combobox"),
    ).toHaveValue("ID No.");

    await instructor.getByRole("button", { name: "Check the rows" }).click();
    await expect(instructor.getByTestId("state-badge")).toHaveText("Preview");

    // every problem against the line that has it
    await instructor.getByRole("tab", { name: /Rows/ }).click();
    const preview = instructor.getByTestId("import-preview");
    await expect(preview.getByText("appears more than once", { exact: false }).first()).toBeVisible();
    await expect(preview.getByText("is not a mark", { exact: false }).first()).toBeVisible();
    await expect(preview.getByText("outside 0", { exact: false }).first()).toBeVisible();
    await expect(preview.getByText("not enrolled in this section", { exact: false }).first()).toBeVisible();
    await expect(instructor.getByRole("button", { name: "Commit" })).toBeDisabled();

    // a mark that is not a number is corrected here rather than in the spreadsheet
    const third = instructor.getByTestId("import-row-3");
    await third.getByRole("button", { name: "Edit" }).click();
    const quiz = third.getByLabel("Quiz", { exact: true });
    await expect(quiz).toBeVisible();
    await quiz.fill("6");
    await third.getByRole("button", { name: "Save" }).click();
    await expect(third).not.toHaveAttribute("data-state", "error", { timeout: 30_000 });

    // what cannot be fixed — a line repeated, a student who is not in this section — is left out,
    // and the commit stays refused until no row is in error
    // each removal has the file checked again, which can change what is wrong with the rest, so
    // this keeps going until nothing is in error rather than assuming one pass is enough
    for (let pass = 0; pass < 3; pass += 1) {
      const bad = instructor.getByTestId("import-preview").locator('tr[data-state="error"]');
      if ((await bad.count()) === 0) break;
      for (const rowNo of [1, 2, 3, 4, 5]) {
        const row = instructor.getByTestId(`import-row-${rowNo}`);
        const leaveOut = row.getByRole("button", { name: "Leave out" });
        if (!(await leaveOut.count())) continue;
        await leaveOut.click();
        // the row itself says when the server has taken it out, so nothing guesses at a delay
        await expect(row).not.toHaveAttribute("data-state", "error", { timeout: 30_000 });
      }
    }
    await expect(
      instructor.getByTestId("import-preview").locator('[data-state="error"]'),
    ).toHaveCount(0, { timeout: 30_000 });

    instructor.on("dialog", (dialog) => dialog.accept());
    await instructor.getByRole("button", { name: "Commit" }).click();
    await expect(instructor.getByTestId("state-badge")).toHaveText("Committed");

    // the section now holds the marks, and the figures follow once the worker has run
    await expect
      .poll(
        async () => {
          await instructor.goto(sectionUrl);
          return instructor.getByTestId("results-table").count();
        },
        { timeout: 120_000, intervals: [3_000] },
      )
      .toBe(1);
    const results = instructor.getByTestId("results-table");
    // whoever was on the sheet and in the section now has a total and a grade
    await expect(results.getByRole("row")).not.toHaveCount(1);
    await expect(instructor.getByTestId("section-figures")).toBeVisible();

    // the sheet is in the history, and a second one would replace it
    await expect(instructor.getByTestId("batch-history")).toContainText("committed");
    void importUrl;
  });

  test("a course's performance is a report the head can take away", async ({ pageAs }) => {
    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/reports");
    const card = dh.getByTestId("report-course_performance");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Course performance");
  });

  test("an instructor sees only the sections they teach", async ({ pageAs }) => {
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs/assessment");
    const sections = instructor.getByTestId("markable-sections");
    await expect(sections).toBeVisible();
    // the demo gives instructor1 two sections of their own courses and not the rest
    const rows = await sections.getByRole("row").count();
    expect(rows).toBeGreaterThan(1);

    const dh = await pageAs("dh.cs");
    await dh.goto("/d/cs/assessment");
    const all = await dh.getByTestId("markable-sections").getByRole("row").count();
    expect(all).toBeGreaterThan(rows);
  });
});
