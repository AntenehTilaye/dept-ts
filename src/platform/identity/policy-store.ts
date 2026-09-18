import { prismaRoot } from "../../lib/db/prisma";
import { withTenantTx } from "../../lib/db/tenant";
import type { Grant, PolicyStore } from "./can";
import type { PermissionLevelKey } from "./levels";
import { DEFAULT_MANAGE_EXCLUDED } from "./permissions-matrix";

// PolicyStore over PostgreSQL. Reads run inside a department transaction so RLS returns the
// department's own rows plus the faculty-wide (NULL departmentId) defaults; department rows
// override faculty rows for the same role key / permission key.

let keysCache: { at: number; keys: ReadonlySet<string> } | undefined;
const KEYS_TTL_MS = 60_000;

export function invalidatePermissionKeys(): void {
  keysCache = undefined;
}

export const dbPolicyStore: PolicyStore = {
  async rolePermissions(departmentId) {
    const rows = await withTenantTx(departmentId, (tx) =>
      tx.rolePermission.findMany({
        include: { role: { select: { key: true, departmentId: true } } },
      }),
    );
    const map = new Map<string, Map<string, PermissionLevelKey>>();
    // faculty rows first, department rows second so they win
    const ordered = [...rows].sort(
      (a, b) => Number(a.departmentId !== null) - Number(b.departmentId !== null),
    );
    for (const r of ordered) {
      let perKey = map.get(r.role.key);
      if (!perKey) {
        perKey = new Map();
        map.set(r.role.key, perKey);
      }
      perKey.set(r.permissionKey, r.level as PermissionLevelKey);
    }
    return map;
  },

  async activeGrants(userId, departmentId, now) {
    const rows = await withTenantTx(departmentId, (tx) =>
      tx.roleGrant.findMany({
        where: {
          userId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        include: { role: { select: { key: true } } },
      }),
    );
    return rows.map<Grant>((r) => ({
      roleKey: r.role.key,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
    }));
  },

  async manageExcluded(departmentId) {
    const rows = await prismaRoot.systemSetting.findMany({
      where: {
        key: "rbac.manageExcludedPermissions",
        OR: [
          { scope: "global", scopeId: "" },
          { scope: "department", scopeId: departmentId },
        ],
      },
    });
    const dept = rows.find((r) => r.scope === "department");
    const value = (dept ?? rows.find((r) => r.scope === "global"))?.valueJson;
    return new Set(Array.isArray(value) ? (value as string[]) : DEFAULT_MANAGE_EXCLUDED);
  },

  async registeredKeys() {
    if (keysCache && Date.now() - keysCache.at < KEYS_TTL_MS) return keysCache.keys;
    const rows = await prismaRoot.permission.findMany({ select: { key: true } });
    keysCache = { at: Date.now(), keys: new Set(rows.map((r) => r.key)) };
    return keysCache.keys;
  },
};
