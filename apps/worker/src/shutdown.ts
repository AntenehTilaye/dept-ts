import type { PgBoss } from "pg-boss";
import { prismaRoot } from "@/lib/db/prisma";

export function installShutdown(boss: PgBoss, extra: Array<() => Promise<void>> = []): void {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, stopping`);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      for (const fn of extra) await fn();
      await prismaRoot.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error("[worker] shutdown failed", error);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
