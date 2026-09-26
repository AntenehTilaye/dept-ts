import { mkdirSync } from "node:fs";
import { buildFixtures } from "../fixtures/build-fixtures";
import { resetE2eDatabase } from "../setup/reset-e2e";

// Runs once before the Playwright projects: fresh seeded e2e database and an empty Mailpit.
export default async function globalSetup() {
  mkdirSync("tests/e2e/.auth", { recursive: true });
  // the spreadsheets the import journeys upload are built, not committed, so the suite builds
  // them itself rather than depending on somebody having remembered to
  await buildFixtures();
  // Mailpit is emptied first: the demo seed opens a campaign and mails its invitations, and a
  // purge after the seed would delete exactly the messages the campaign specs wait for.
  const mailpit = process.env.MAILPIT_URL;
  if (mailpit) {
    const res = await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Mailpit purge failed: ${res.status}`);
  }
  await resetE2eDatabase();
}
