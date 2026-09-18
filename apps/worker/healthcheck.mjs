// Exits 1 when the heartbeat file is older than 90 s (compose healthcheck).
import { statSync } from "node:fs";

const file = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
try {
  const ageMs = Date.now() - statSync(file).mtimeMs;
  process.exit(ageMs < 90_000 ? 0 : 1);
} catch {
  process.exit(1);
}
