import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { adminPageContext } from "@/lib/auth/page";
import { ROLES, DEFAULT_MANAGE_EXCLUDED } from "@/platform/identity/permissions-matrix";
import { ActionForm } from "@/components/forms/ActionForm";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { saveManageExclusionsForm, saveRoleLevelsForm } from "./actions";

export const dynamic = "force-dynamic";

const LEVELS = [
  "full",
  "manage",
  "review",
  "own",
  "assigned",
  "participate",
  "limited",
  "view",
  "submit",
  "none",
] as const;

export default async function PermissionsPage(props: PageProps<"/admin/permissions">) {
  const ctx = await adminPageContext();
  const params = await props.searchParams;
  const scope = typeof params.scope === "string" ? params.scope : "faculty";
  const roleKey = typeof params.role === "string" ? params.role : "deputy_head";
  const departments = await prismaRoot.department.findMany({ orderBy: { code: "asc" } });
  const permissions = await prismaRoot.permission.findMany({
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });
  const role = await prismaRoot.role.findFirst({ where: { key: roleKey, departmentId: null } });

  const rows = role
    ? await withTenantBypass(
        { isAdmin: true, user: { id: ctx.user.id } },
        "permission matrix view",
        (tx) =>
          tx.rolePermission.findMany({
            where: {
              roleId: role.id,
              OR: [
                { departmentId: null },
                { departmentId: scope === "faculty" ? undefined : scope },
              ],
            },
          }),
      )
    : [];
  const faculty = new Map(
    rows.filter((r) => r.departmentId === null).map((r) => [r.permissionKey, r.level]),
  );
  const override = new Map(
    rows.filter((r) => r.departmentId !== null).map((r) => [r.permissionKey, r.level]),
  );

  const exclusionSetting = await prismaRoot.systemSetting.findFirst({
    where:
      scope === "faculty"
        ? { key: "rbac.manageExcludedPermissions", scope: "global" }
        : { key: "rbac.manageExcludedPermissions", scope: "department", scopeId: scope },
  });
  const excluded = new Set(
    Array.isArray(exclusionSetting?.valueJson)
      ? (exclusionSetting!.valueJson as string[])
      : DEFAULT_MANAGE_EXCLUDED,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles and permissions"
        description="Which role may do what, faculty-wide or per department. Changes are audited."
      />
      <div className="flex flex-col gap-6">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label htmlFor="scope" className="text-sm font-medium">
              Scope
            </label>
            <NativeSelect id="scope" name="scope" defaultValue={scope} className="w-64">
              <option value="faculty">Faculty defaults</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code}) override
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <label htmlFor="role" className="text-sm font-medium">
              Role
            </label>
            <NativeSelect id="role" name="role" defaultValue={roleKey} className="w-56">
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>
              {ROLES.find((r) => r.key === roleKey)?.name ?? roleKey} ·{" "}
              {scope === "faculty" ? "faculty defaults" : "department override"}
            </CardTitle>
            <CardDescription>
              {scope === "faculty"
                ? "Levels every department inherits unless it overrides them."
                : "Choose inherit to fall back to the faculty default for that key."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={saveRoleLevelsForm}
              submitLabel="Save levels"
              successMessage="Levels saved."
              className="flex flex-col gap-3"
              resetOnSuccess={false}
            >
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="roleKey" value={roleKey} />
              <div className="grid gap-2 md:grid-cols-2">
                {permissions.map((p) => {
                  const current = scope === "faculty" ? faculty.get(p.key) : override.get(p.key);
                  return (
                    <label
                      key={p.key}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                    >
                      <span title={p.description}>
                        {p.key}
                        {scope !== "faculty" && !override.has(p.key) && faculty.has(p.key) ? (
                          <span className="text-muted-foreground">
                            {" "}
                            (default {faculty.get(p.key)})
                          </span>
                        ) : null}
                      </span>
                      <NativeSelect
                        name={`level:${p.key}`}
                        defaultValue={current ?? (scope === "faculty" ? "none" : "inherit")}
                        className="w-36"
                      >
                        {scope !== "faculty" ? <option value="inherit">inherit</option> : null}
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  );
                })}
              </div>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Excluded from manage</CardTitle>
            <CardDescription>
              Keys a manage-level role (the deputy head by default) does not receive even though the
              head does.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={saveManageExclusionsForm}
              submitLabel="Save exclusions"
              successMessage="Exclusions saved."
              className="flex flex-col gap-3"
              resetOnSuccess={false}
            >
              <input type="hidden" name="scope" value={scope} />
              <div className="grid gap-1 md:grid-cols-3">
                {permissions.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="keys"
                      value={p.key}
                      defaultChecked={excluded.has(p.key)}
                    />{" "}
                    {p.key}
                  </label>
                ))}
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
