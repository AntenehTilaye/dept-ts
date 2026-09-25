/**
 * Rebuilds the dashboard projections (and optionally the search index) from the tables they
 * summarise, in this process rather than through the worker:
 *
 *   docker compose run --rm web npx tsx scripts/rebuild-projections.ts [--search] [--dept dep_cs]
 *
 * Both are derived data, so a rebuild costs time and never correctness. This is the door for an
 * operator with a shell; /admin/jobs is the door for an administrator with a browser.
 */
import "dotenv/config";
import { bootstrap } from "../src/lib/bootstrap";
import { prismaRoot } from "../src/lib/db/prisma";
import { stopBoss } from "../src/lib/db/boss";
import { withTenantTx } from "../src/lib/db/tenant";
import { rebuildProjections } from "../src/platform/dashboard";
import { rebuild as rebuildSearch } from "../src/platform/search";

async function main(): Promise<void> {
  bootstrap();
  const args = process.argv.slice(2);
  const withSearch = args.includes("--search");
  const only = args.includes("--dept") ? args[args.indexOf("--dept") + 1] : undefined;

  const departments = only
    ? [{ id: only }]
    : await prismaRoot.department.findMany({ select: { id: true } });

  for (const department of departments) {
    const summaries = await withTenantTx(department.id, (tx) =>
      rebuildProjections(tx, department.id),
    );
    console.log(
      `projections ${department.id}: ${summaries.map((s) => `${s.projectionKey}=${s.rows}`).join(", ")}`,
    );
    if (withSearch) {
      const result = await withTenantTx(department.id, (tx) => rebuildSearch(tx, department.id));
      console.log(`search ${department.id}: ${result.indexed} indexed, ${result.skipped} skipped`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopBoss();
    await prismaRoot.$disconnect();
  });
