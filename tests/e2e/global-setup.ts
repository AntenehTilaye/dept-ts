import { mkdirSync } from "node:fs";
import { resetE2eDatabase } from "../setup/reset-e2e";

// Runs once before the Playwright projects: fresh seeded e2e database and an empty Mailpit.
export default async function globalSetup() {
  mkdirSync("tests/e2e/.auth", { recursive: true });
  await resetE2eDatabase();
  const mailpit = process.env.MAILPIT_URL;
  if (mailpit) {
    const res = await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Mailpit purge failed: ${res.status}`);
  }
}
