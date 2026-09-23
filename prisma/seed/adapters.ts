import type { PrismaClient } from "../../src/generated/prisma/client";
import { registerBuiltinAdapters } from "../../src/platform/feature/adapters/builtin";
import { syncRegistrations } from "../../src/platform/feature/adapters/registry";
import { registerModules } from "../../src/modules";

// The adapter list the admin page shows and publish checks against. It mirrors what the code
// registered at boot, so a key that no longer exists disappears from the catalogue on the next
// deployment instead of failing at publish time.
export async function seedAdapters(db: PrismaClient): Promise<number> {
  registerBuiltinAdapters();
  registerModules();
  return syncRegistrations(db);
}
