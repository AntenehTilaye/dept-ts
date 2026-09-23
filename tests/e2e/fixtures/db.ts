import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Read-only access to the e2e database for the few ids a browser cannot discover yet (a
// campaign has no list page until the feature runtime arrives). Never used to write.
let client: PrismaClient | null = null;

export function e2eDb(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) throw new Error("DATABASE_URL_MIGRATE is not set");
    const schema = new URL(url).searchParams.get("schema") ?? "public";
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url, max: 2 }, { schema }),
    });
  }
  return client;
}
