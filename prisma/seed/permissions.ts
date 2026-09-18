import type { PrismaClient } from "../../src/generated/prisma/client";
import { MATRIX, PERMISSIONS, ROLES } from "../../src/platform/identity/permissions-matrix";

// Permission catalogue, faculty-wide roles and the default matrix (RolePermission rows with
// departmentId NULL). Department overrides are never touched. Idempotent.
export async function seedPermissions(db: PrismaClient) {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, action: p.action, description: p.description },
      create: {
        key: p.key,
        module: p.module,
        action: p.action,
        description: p.description,
        isSystem: true,
      },
    });
  }

  const roleIds = new Map<string, string>();
  for (const r of ROLES) {
    const existing = await db.role.findFirst({ where: { key: r.key, departmentId: null } });
    const row = existing
      ? await db.role.update({
          where: { id: existing.id },
          data: { name: r.name, description: r.description, isSystem: true },
        })
      : await db.role.create({
          data: {
            key: r.key,
            name: r.name,
            description: r.description,
            isSystem: true,
            departmentId: null,
          },
        });
    roleIds.set(r.key, row.id);
  }

  for (const m of MATRIX) {
    const roleId = roleIds.get(m.role);
    if (!roleId) continue; // `admin` is the global user.role, not a Role row
    const existing = await db.rolePermission.findFirst({
      where: { departmentId: null, roleId, permissionKey: m.key },
    });
    if (existing) {
      if (existing.level !== m.level)
        await db.rolePermission.update({ where: { id: existing.id }, data: { level: m.level } });
    } else {
      await db.rolePermission.create({
        data: { departmentId: null, roleId, permissionKey: m.key, level: m.level },
      });
    }
  }
  return roleIds;
}
