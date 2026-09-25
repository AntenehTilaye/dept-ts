import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  csvOf,
  ROSTER_ERRORS,
  ROSTER_VALID,
  TIMETABLE_OVERLAP,
  TIMETABLE_VALID,
  workbookOf,
} from "./workbooks";

// Writes the import fixtures to disk so the Playwright run has real files to upload:
//   docker compose --profile test run --rm test npx tsx tests/fixtures/build-fixtures.ts
// Nothing binary is committed; the content lives in workbooks.ts where it can be read.

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "files");

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const files: [string, Buffer | string][] = [
    ["roster-valid.xlsx", await workbookOf([ROSTER_VALID])],
    ["roster-errors.xlsx", await workbookOf([ROSTER_ERRORS])],
    ["roster.csv", csvOf(ROSTER_VALID)],
    ["timetable-valid.xlsx", await workbookOf([TIMETABLE_VALID])],
    ["timetable-overlap.csv", csvOf(TIMETABLE_OVERLAP)],
  ];
  for (const [name, content] of files) {
    await writeFile(join(out, name), content);
    console.log(`fixtures: wrote ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
