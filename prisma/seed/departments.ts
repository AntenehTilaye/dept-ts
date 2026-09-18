import type { PrismaClient } from "../../src/generated/prisma/client";
import { departmentService } from "../../src/platform/people/departments";

export const SEED_DEPARTMENTS = [
  { id: "dep_cs", code: "CS", name: "Computer Science" },
  { id: "dep_ee", code: "EE", name: "Electrical Engineering" },
] as const;

// Departments are created through the service so each one is also a better-auth organization
// with the same id. Fixed ids keep tests and demo data addressable.
export async function seedDepartments(db: PrismaClient) {
  for (const d of SEED_DEPARTMENTS) {
    const existing = await db.department.findUnique({ where: { code: d.code } });
    if (!existing) await departmentService.create({ id: d.id, code: d.code, name: d.name }, db);
  }
}
