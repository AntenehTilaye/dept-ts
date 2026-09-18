import { prismaRoot } from "@/lib/db/prisma";
import { adminPageContext } from "@/lib/auth/page";
import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteSettingForm, saveSettingForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage(props: PageProps<"/admin/settings">) {
  await adminPageContext();
  const params = await props.searchParams;
  const scope = typeof params.scope === "string" ? params.scope : "global";
  const scopeId = typeof params.scopeId === "string" ? params.scopeId : "";
  const departments = await prismaRoot.department.findMany({ orderBy: { code: "asc" } });
  const where =
    scope === "global"
      ? { scope: "global" as const }
      : scope === "department"
        ? { scope: "department" as const, ...(scopeId ? { scopeId } : {}) }
        : { scope: "program" as const };
  const settings = await prismaRoot.systemSetting.findMany({
    where,
    orderBy: [{ scopeId: "asc" }, { key: "asc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="scope">Scope</Label>
          <Select id="scope" name="scope" defaultValue={scope} className="w-40">
            <option value="global">Global</option>
            <option value="department">Department</option>
            <option value="program">Program</option>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="scopeId">Department</Label>
          <Select id="scopeId" name="scopeId" defaultValue={scopeId} className="w-56">
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm">
          Show
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Settings · {scope}</CardTitle>
          <CardDescription>
            Department and program rows override the global value for the same key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Scope id</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.map((s) => (
                <TableRow key={`${s.key}:${s.scope}:${s.scopeId}`} data-testid="setting-row">
                  <TableCell className="font-mono text-xs">{s.key}</TableCell>
                  <TableCell className="font-mono text-xs">{s.scopeId || "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{JSON.stringify(s.valueJson)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </TableCell>
                  <TableCell>
                    <ActionForm
                      action={deleteSettingForm}
                      submitLabel="Delete"
                      successMessage="Deleted."
                      className="inline"
                    >
                      <input type="hidden" name="key" value={s.key} />
                      <input type="hidden" name="scope" value={s.scope} />
                      <input type="hidden" name="scopeId" value={s.scopeId} />
                    </ActionForm>
                  </TableCell>
                </TableRow>
              ))}
              {settings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No settings in this scope.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Set a value</CardTitle>
          <CardDescription>
            Values are JSON: 5, true, &quot;text&quot; or [&quot;a&quot;, &quot;b&quot;].
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={saveSettingForm}
            submitLabel="Save setting"
            successMessage="Setting saved."
            className="grid max-w-xl gap-3"
          >
            <div className="grid gap-1">
              <Label htmlFor="new-key">Key</Label>
              <Input id="new-key" name="key" placeholder="campaign.kThreshold" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="new-scope">Scope</Label>
                <Select id="new-scope" name="scope" defaultValue={scope}>
                  <option value="global">global</option>
                  <option value="department">department</option>
                  <option value="program">program</option>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="new-scopeId">Scope id</Label>
                <Input
                  id="new-scopeId"
                  name="scopeId"
                  defaultValue={scopeId}
                  placeholder="department or program id"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-value">Value (JSON)</Label>
              <Input id="new-value" name="valueJson" placeholder="5" required />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
