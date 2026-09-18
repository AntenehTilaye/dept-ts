import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { truncateAll } from "./truncate";
import { requireEnv } from "./urls";
import { SEED_USERS } from "../../prisma/seed/users";

// Playwright global setup: truncate the e2e database and re-run the full seed (SEED_DEMO=1).
export async function resetE2eDatabase(): Promise<void> {
  const url = requireEnv("DATABASE_URL_MIGRATE");
  const schema = new URL(url).searchParams.get("schema") ?? "public";
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 2 }, { schema }),
  });
  try {
    await truncateAll(db, schema);
    // accounts created by earlier runs (invited representatives, admin-created users) must not
    // survive, or "new user" flows find an existing account and skip the invite
    await db.user.deleteMany({ where: { email: { notIn: SEED_USERS.map((u) => u.email) } } });
  } finally {
    await db.$disconnect();
  }
  execFileSync("npx", ["prisma", "db", "seed"], {
    env: { ...process.env, SEED_DEMO: "1" },
    stdio: "inherit",
  });
}
