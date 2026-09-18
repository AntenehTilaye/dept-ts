import { getDb } from "./db/scoped";
import { setBypassAuditor } from "./db/tenant";
import type { Db } from "./db/types";
import { installGrantSubscribers } from "@/platform/audit/subscribers";
import { record } from "@/platform/audit/record";
import { setSubjectResolver } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import { registerAcademicSubjects } from "@/platform/academic/subject";
import { registerPeopleSubjects } from "@/platform/people/subject";
import { isRegistered, resolverWith } from "@/platform/subject-registry";
import { setEnginePolicyStore } from "@/platform/workflow/engine";

// Process-wide registrations, loaded once by src/instrumentation.ts (web) and the worker entry
// point. Idempotent so hot reloads and tests may call it repeatedly.
let booted = false;

export function bootstrap(): void {
  if (booted || isRegistered("person")) {
    booted = true;
    return;
  }
  registerPeopleSubjects();
  registerAcademicSubjects();
  setSubjectResolver(resolverWith((departmentId) => getDb(departmentId) as unknown as Db));
  setEnginePolicyStore(dbPolicyStore);
  installGrantSubscribers();
  // every tenant bypass leaves an audit row (the reason names the caller)
  setBypassAuditor(async (tx, actor, reason) => {
    await record(tx, {
      action: "tenant_bypass",
      subjectType: "department",
      subjectId: "faculty",
      departmentId: null,
      actorUserId: "user" in actor ? actor.user.id : null,
      reason: "worker" in actor ? `${actor.jobName}: ${reason}` : reason,
    });
  });
  booted = true;
}
