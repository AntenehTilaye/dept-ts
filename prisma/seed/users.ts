import type { PrismaClient } from "../../src/generated/prisma/client";
import { auth } from "../../src/lib/auth/auth";
import type { OrgRoleKey } from "../../src/lib/auth/access";
import { provisionUser } from "../../src/platform/identity/provision";

export const SEED_PASSWORD = "Passw0rd!dev";

export interface SeedUser {
  key: string;
  email: string;
  name: string;
  department?: "dep_cs" | "dep_ee";
  roles?: OrgRoleKey[];
  admin?: boolean;
}

// One user per role per department for development, tests and e2e (password above).
export const SEED_USERS: SeedUser[] = [
  { key: "admin", email: "admin@deptts.local", name: "System Administrator", admin: true },
  {
    key: "dh.cs",
    email: "dh.cs@deptts.local",
    name: "Dr. Hanna Bekele",
    department: "dep_cs",
    roles: ["department_head"],
  },
  {
    key: "dpt.cs",
    email: "dpt.cs@deptts.local",
    name: "Dr. Samuel Tadesse",
    department: "dep_cs",
    roles: ["deputy_head"],
  },
  {
    key: "instructor1.cs",
    email: "instructor1.cs@deptts.local",
    name: "Instructor One",
    department: "dep_cs",
    roles: ["instructor"],
  },
  {
    key: "instructor2.cs",
    email: "instructor2.cs@deptts.local",
    name: "Instructor Two",
    department: "dep_cs",
    roles: ["instructor"],
  },
  {
    key: "instructor3.cs",
    email: "instructor3.cs@deptts.local",
    name: "Instructor Three",
    department: "dep_cs",
    roles: ["instructor"],
  },
  {
    key: "chair.cs",
    email: "chair.cs@deptts.local",
    name: "Instructor Chair",
    department: "dep_cs",
    roles: ["instructor"],
  },
  {
    key: "rep.cs",
    email: "rep.cs@deptts.local",
    name: "Rep Student",
    department: "dep_cs",
    roles: ["student_rep"],
  },
  {
    key: "dh.ee",
    email: "dh.ee@deptts.local",
    name: "Dr. Elias Worku",
    department: "dep_ee",
    roles: ["department_head"],
  },
];

// Users are created through better-auth (password hashing, admin plugin fields); the global
// administrator has no department membership.
export async function seedUsers(db: PrismaClient) {
  for (const u of SEED_USERS) {
    if (u.admin) {
      const existing = await db.user.findUnique({ where: { email: u.email } });
      if (!existing) {
        const res = await auth.api.createUser({
          body: { email: u.email, name: u.name, password: SEED_PASSWORD, role: "admin" },
        });
        await db.user.update({ where: { id: res.user.id }, data: { emailVerified: true } });
      }
      continue;
    }
    await provisionUser({
      email: u.email,
      name: u.name,
      departmentId: u.department!,
      roleKeys: u.roles!,
      password: SEED_PASSWORD,
      sendMail: false,
    });
  }
}
