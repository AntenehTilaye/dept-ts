import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUES, queueSpec } from "@/platform/scheduler/queues";
import {
  HEARTBEAT_SETTING_KEY,
  recordHeartbeat,
  touchHeartbeatFile,
} from "../../../apps/worker/src/handlers/worker-heartbeat";
import { appDb } from "../../setup/db";
import { awaitJob, startTestBoss } from "../../setup/boss";

let boss: PgBoss;

beforeAll(async () => {
  boss = await startTestBoss();
});

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe("worker heartbeat", () => {
  it("creates every queue of the shared catalogue at boot", async () => {
    for (const q of QUEUES) {
      const queue = await boss.getQueue(q.name);
      expect(queue, q.name).not.toBeNull();
      expect(queue?.policy).toBe(q.policy);
    }
  });

  it("resolves queue specs from the catalogue and rejects unknown queues", () => {
    expect(queueSpec("worker.heartbeat")).toMatchObject({ policy: "short", cron: "* * * * *" });
    expect(() => queueSpec("not.a.queue")).toThrow(/Unknown queue "not.a.queue"/);
  });

  it("handles a heartbeat job once and records it in SystemSetting", async () => {
    const before = new Date();
    const id = await boss.send("worker.heartbeat", {});
    expect(id).toBeTruthy();
    const job = await awaitJob(boss, "worker.heartbeat", id!);
    expect(job.state).toBe("completed");
    const setting = await appDb.systemSetting.findUnique({
      where: { key_scope_scopeId: { key: HEARTBEAT_SETTING_KEY, scope: "global", scopeId: "" } },
    });
    expect(setting).not.toBeNull();
    expect(new Date(setting!.valueJson as string).getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
  });

  it("touches the heartbeat file and upserts idempotently", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hb-")), "heartbeat");
    touchHeartbeatFile(file);
    const first = statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    touchHeartbeatFile(file);
    expect(statSync(file).mtimeMs).toBeGreaterThanOrEqual(first);
    await recordHeartbeat(appDb, new Date("2026-01-01T00:00:00Z"));
    await recordHeartbeat(appDb, new Date("2026-01-01T00:01:00Z"));
    const rows = await appDb.systemSetting.findMany({ where: { key: HEARTBEAT_SETTING_KEY } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valueJson).toBe("2026-01-01T00:01:00.000Z");
  });
});
