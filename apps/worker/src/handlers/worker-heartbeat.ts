import { utimesSync, writeFileSync, existsSync } from "node:fs";
import { prismaRoot } from "@/lib/db/prisma";
import type { WorkerHandler } from "./types";

export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
export const HEARTBEAT_SETTING_KEY = "worker.lastHeartbeat";

export function touchHeartbeatFile(file: string = HEARTBEAT_FILE): void {
  if (!existsSync(file)) writeFileSync(file, "");
  const now = new Date();
  utimesSync(file, now, now);
}

/** Records the heartbeat in SystemSetting (GLOBAL table) so /admin/jobs can show it. */
export async function recordHeartbeat(db = prismaRoot, at: Date = new Date()): Promise<void> {
  await db.systemSetting.upsert({
    where: { key_scope_scopeId: { key: HEARTBEAT_SETTING_KEY, scope: "global", scopeId: "" } },
    update: { valueJson: at.toISOString(), updatedBy: "worker" },
    create: {
      key: HEARTBEAT_SETTING_KEY,
      scope: "global",
      scopeId: "",
      valueJson: at.toISOString(),
      updatedBy: "worker",
    },
  });
}

const handler: WorkerHandler = {
  queue: "worker.heartbeat",
  async handle() {
    touchHeartbeatFile();
    await recordHeartbeat();
  },
};

export default handler;
