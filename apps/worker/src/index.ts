import "dotenv/config";
import { startWorkerBoss } from "./boss";
import { registerHandlers } from "./registry";
import { registerSchedules } from "./schedules";
import { installShutdown } from "./shutdown";
import { closeBrowser } from "./pdf/browser";
import { recordHeartbeat, touchHeartbeatFile } from "./handlers/worker-heartbeat";
import { QUEUES } from "@/platform/scheduler/queues";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass } from "@/lib/db/tenant";
import { syncRegistrations } from "@/platform/feature";

async function main() {
  bootstrap();
  const boss = await startWorkerBoss();
  console.log(
    `[worker] pg-boss started on schema "${process.env.PGBOSS_SCHEMA ?? "pgboss"}"; queues: ${QUEUES.map((q) => q.name).join(", ")}`,
  );
  await registerHandlers(boss);
  await registerSchedules(boss);

  // both processes carry the same adapter registry; the worker is the one that is always up,
  // so it refreshes the table publish and the admin page read
  await withTenantBypass({ worker: true, jobName: "boot" }, "refresh adapters", (tx) =>
    syncRegistrations(tx),
  ).catch((error) => console.error("[worker] adapter sync failed", error));

  touchHeartbeatFile();
  await recordHeartbeat().catch((error) => console.error("[worker] heartbeat write failed", error));
  const timer = setInterval(() => touchHeartbeatFile(), 30_000);
  timer.unref();

  // the report renderer's Chromium outlives a job, so it is closed with the process
  installShutdown(boss, [async () => clearInterval(timer), closeBrowser]);
  console.log("[worker] ready");
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
