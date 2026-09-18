import { reconcileAll } from "@/platform/identity/reconcile";
import type { WorkerHandler } from "./types";

/** Nightly repair of derived grants. */
const handler: WorkerHandler = {
  queue: "grant.reconcile",
  async handle() {
    const summary = await reconcileAll();
    console.log(
      `[grants] reconciled ${summary.map((s) => `${s.departmentId}:${s.members}/${s.orphaned}`).join(" ")}`,
    );
  },
};

export default handler;
