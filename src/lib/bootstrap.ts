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
import { installSchedulerEffects } from "@/platform/scheduler/effects";
import { installSchedulerSubscribers } from "@/platform/scheduler/subscribers";
import { setPeriodDependentsResolver } from "@/platform/academic/calendar";
import { dependentsOfPeriod } from "@/platform/scheduler/reminders";
import { registerDocumentRetention, registerDocumentSubjects } from "@/platform/document";
import { installThreadSubscribers, registerThreadSubjects } from "@/platform/thread";
import { installWorkItemHooks, registerWorkItemSubjects } from "@/platform/workitem";
import { installBindings, registerFormSubjects } from "@/platform/forms";
import { installCampaignSubscribers, registerCampaignSubjects } from "@/platform/campaign";
import { installFeatureRuntime, registerFeatureSubjects } from "@/platform/feature";
import { installAvailabilityFeeds, registerAvailabilitySubjects } from "@/platform/availability";
import { installImportKinds, registerImportSubjects } from "@/platform/import";
import { installSystemReports, registerReportingSubjects } from "@/platform/reporting";
import { installSearchPermissions, installSearchSubscribers } from "@/platform/search";
import {
  installBuiltInProjections,
  installBuiltInWidgets,
  installDashboardSubscribers,
} from "@/platform/dashboard";
import { registerModules } from "@/modules";

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
  registerDocumentSubjects();
  registerThreadSubjects();
  registerWorkItemSubjects();
  registerFormSubjects();
  registerCampaignSubjects();
  registerFeatureSubjects();
  registerAvailabilitySubjects();
  registerImportSubjects();
  registerReportingSubjects();
  setSubjectResolver(resolverWith((departmentId) => getDb(departmentId) as unknown as Db));
  setEnginePolicyStore(dbPolicyStore);
  installGrantSubscribers();
  installSchedulerEffects();
  installSchedulerSubscribers();
  installThreadSubscribers();
  installWorkItemHooks();
  installBindings();
  installCampaignSubscribers();
  installFeatureRuntime();
  installAvailabilityFeeds();
  installImportKinds();
  installSystemReports();
  installSearchSubscribers();
  installSearchPermissions();
  // projections declare the events they need, so they are registered before the subscriber
  installBuiltInProjections();
  installBuiltInWidgets();
  installDashboardSubscribers();
  registerModules();
  registerDocumentRetention();
  setPeriodDependentsResolver(async (db, periodId) =>
    (await dependentsOfPeriod(db, periodId)).map((s) => ({
      kind: "reminder",
      id: s.id,
      label: `${s.subjectType} ${s.subjectId} (${s.scheduleKey})`,
    })),
  );
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
