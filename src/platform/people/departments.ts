import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { prismaRoot } from "../../lib/db/prisma";

// Department = better-auth Organization with the same id. Both rows are written in one
// transaction on the global tables (the organization table is exactly what the organization
// plugin reads), which keeps the ids identical without a compensation step and avoids the
// creator-membership side effect of the plugin endpoint.

export interface CreateDepartmentInput {
  code: string;
  name: string;
  facultyName?: string;
  timezone?: string;
  /** Fixed id (tests and seeds); defaults to a random UUID. */
  id?: string;
}

export function departmentSlug(code: string): string {
  return code.trim().toLowerCase();
}

export const departmentService = {
  async create(input: CreateDepartmentInput, db: PrismaClient = prismaRoot) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(code))
      throw new Error("Department code must be 2-12 letters or digits");
    const id = input.id ?? randomUUID();
    return db.$transaction(async (tx) => {
      await tx.organization.create({
        data: {
          id,
          name: input.name,
          slug: departmentSlug(code),
          createdAt: new Date(),
          metadata: JSON.stringify({ code }),
        },
      });
      return tx.department.create({
        data: {
          id,
          organizationId: id,
          code,
          name: input.name,
          facultyName: input.facultyName,
          timezone: input.timezone,
        },
      });
    });
  },

  async bySlug(slug: string) {
    return prismaRoot.department.findFirst({
      where: { organization: { slug } },
      include: { organization: true },
    });
  },

  async list() {
    return prismaRoot.department.findMany({
      orderBy: { code: "asc" },
      include: { organization: { select: { slug: true } } },
    });
  },
};
