import "dotenv/config";
import { startWorkerBoss } from "./boss";
import { registerHandlers } from "./registry";
import { registerSchedules } from "./schedules";
import { installShutdown } from "./shutdown";
import { recordHeartbeat, touchHeartbeatFile } from "./handlers/worker-heartbeat";
import { QUEUES } from "@/platform/scheduler/queues";
import { bootstrap } from "@/lib/bootstrap";

async function main() {
  bootstrap();
  const boss = await startWorkerBoss();
  console.log(
    `[worker] pg-boss started on schema "${process.env.PGBOSS_SCHEMA ?? "pgboss"}"; queues: ${QUEUES.map((q) => q.name).join(", ")}`,
  );
  await registerHandlers(boss);
  await registerSchedules(boss);

  touchHeartbeatFile();
  await recordHeartbeat().catch((error) => console.error("[worker] heartbeat write failed", error));
  const timer = setInterval(() => touchHeartbeatFile(), 30_000);
  timer.unref();

  installShutdown(boss, [async () => clearInterval(timer)]);
  console.log("[worker] ready");
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
