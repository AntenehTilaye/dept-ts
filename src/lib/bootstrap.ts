import { getDb } from "./db/scoped";
import type { Db } from "./db/types";
import { setSubjectResolver } from "@/platform/identity/can";
import { registerAcademicSubjects } from "@/platform/academic/subject";
import { registerPeopleSubjects } from "@/platform/people/subject";
import { isRegistered, resolverWith } from "@/platform/subject-registry";

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
  booted = true;
}
