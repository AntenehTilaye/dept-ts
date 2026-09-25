import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures/auth";

// The staged import as somebody walks it: upload the spreadsheet, read it, look at what is
// wrong with which line, fix the lines, commit — and only then does the department change.

const FIXTURES = join(process.cwd(), "tests/fixtures/files");

test.describe("importing a spreadsheet", () => {
  test.setTimeout(180_000);

  test("the head uploads a roster with mistakes in it, fixes the rows and commits", async ({
    pageAs,
  }) => {
    const dh = await pageAs("dh.cs");
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

    // an import is a record like any other; /d/cs/imports is its readable URL
    await dh.goto("/d/cs/imports/new?preset=roster");
    await dh.getByLabel("File", { exact: true }).fill(`roster-${stamp}.xlsx`);
    await dh.getByRole("button", { name: "Create import" }).click();
    await expect(dh).toHaveURL(/\/d\/cs\/f\/import_batch\/(?!new$)[a-z0-9]+$/);
    await expect(dh.getByTestId("state-badge")).toHaveText("Uploaded");

    // the file goes into the source slot
    await dh.getByRole("tab", { name: "The file" }).click();
    const slot = dh.getByTestId("slot-source");
    await expect(slot).toHaveAttribute("data-satisfied", "false");
    await slot.getByLabel("Upload").setInputFiles({
      name: "roster-errors.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await readFile(join(FIXTURES, "roster-errors.xlsx")),
    });
    await expect(dh.getByTestId("slot-source")).toHaveAttribute("data-satisfied", "true");
    await expect(dh.getByText("roster-errors.xlsx uploaded")).toBeVisible();

    // reading it and checking it are the two moves of the process
    await dh.getByRole("button", { name: "Read the file" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Columns");
    await dh.getByRole("tab", { name: "Columns" }).click();
    // the headers of this file are spelled differently, and were matched anyway
    await expect(dh.getByTestId("map-student_number").getByRole("combobox")).toHaveValue("ID No");

    await dh.getByRole("button", { name: "Check the rows" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Preview");

    // every row, with its problems beside it
    await dh.getByRole("tab", { name: /Rows/ }).click();
    const preview = dh.getByTestId("import-preview");
    await expect(preview.getByText("appears more than once", { exact: false }).first()).toBeVisible();
    await expect(preview.getByText("is not an email address").first()).toBeVisible();
    await expect(dh.getByRole("button", { name: "Commit" })).toBeDisabled();

    // fixing the lines is done here, not in the spreadsheet
    const second = dh.getByTestId("import-row-2");
    await second.getByRole("button", { name: "Edit" }).click();
    await second.getByLabel("ID No").fill(`UGR/2${stamp.slice(-3)}/16`);
    await second.getByRole("button", { name: "Save" }).click();
    await expect(dh.getByText("Row 2 corrected", { exact: false })).toBeVisible();

    const third = dh.getByTestId("import-row-3");
    await third.getByRole("button", { name: "Edit" }).click();
    await third.getByLabel("E-Mail").fill("elias@student.local");
    await third.getByLabel("Section Code").fill("CS-Y2-A");
    await third.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        await dh.reload();
        await dh.getByRole("tab", { name: /Rows/ }).click();
        return dh.getByTestId("import-preview").locator('[data-state="error"]').count();
      }, { timeout: 30_000 })
      .toBe(0);

    // and now it may be written
    dh.on("dialog", (dialog) => dialog.accept());
    await dh.getByRole("button", { name: "Commit" }).click();
    await expect(dh.getByTestId("state-badge")).toHaveText("Committed");

    // the students are in the department, in the section the file named
    await dh.goto("/d/cs/sections");
    await expect(dh.getByText("CS-Y2-A").first()).toBeVisible();
  });
});
