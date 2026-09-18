import { randomBytes } from "node:crypto";

// Factories write through the real service API (never raw inserts) except where a test
// needs a corrupt state. Every factory takes departmentId first and returns ids.
// Later phases add person(), staff(), student(), userWithRole(), committee(), ...

export function uniqueSuffix(): string {
  return randomBytes(3).toString("hex");
}
