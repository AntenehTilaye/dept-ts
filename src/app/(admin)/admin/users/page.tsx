import { prismaRoot } from "@/lib/db/prisma";
import { ORG_ROLE_KEYS, parseMemberRoles } from "@/lib/auth/access";
import { ActionForm } from "@/components/forms/ActionForm";
import { Badge } from "@/components/ui/badge";
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
import { createUserForm, setBanForm, setMembershipForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function UsersPage(props: PageProps<"/admin/users">) {
  const { edit } = await props.searchParams;
  const [users, departments] = await Promise.all([
    prismaRoot.user.findMany({
      include: { members: { include: { organization: { include: { department: true } } } } },
      orderBy: { email: "asc" },
    }),
    prismaRoot.department.findMany({ orderBy: { code: "asc" } }),
  ]);
  const editing = typeof edit === "string" ? users.find((u) => u.id === edit) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Accounts are created here; each user receives a set-password mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Memberships</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`user-${u.email}`}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {u.role === "admin" ? <Badge>admin</Badge> : null}
                    {u.members.map((m) => (
                      <Badge key={m.id} variant="secondary">
                        {m.organization.department?.code ?? m.organization.slug}:{" "}
                        {parseMemberRoles(m.role).join(", ") || "none"}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {u.banned ? (
                      <Badge variant="destructive">disabled</Badge>
                    ) : (
                      <Badge variant="outline">active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <a className="text-sm underline" href={`/admin/users?edit=${u.id}`}>
                      Edit
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>New user</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createUserForm}
              submitLabel="Create user"
              successMessage="User created and invited by mail."
              className="flex flex-col gap-3"
            >
              <div className="grid gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="departmentId">Department</Label>
                <Select id="departmentId" name="departmentId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </Select>
              </div>
              <fieldset className="grid gap-1">
                <legend className="text-sm font-medium">Roles</legend>
                {ORG_ROLE_KEYS.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="roles" value={r} /> {r}
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          </CardContent>
        </Card>

        {editing ? (
          <Card>
            <CardHeader>
              <CardTitle>Edit {editing.email}</CardTitle>
              <CardDescription>
                Set membership roles per department; an empty selection removes the membership.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {departments.map((d) => {
                const member = editing.members.find((m) => m.organizationId === d.id);
                const current = new Set(parseMemberRoles(member?.role));
                return (
                  <ActionForm
                    key={d.id}
                    action={setMembershipForm}
                    submitLabel={`Save ${d.code}`}
                    successMessage="Membership saved."
                    className="flex flex-col gap-2"
                    resetOnSuccess={false}
                  >
                    <input type="hidden" name="userId" value={editing.id} />
                    <input type="hidden" name="departmentId" value={d.id} />
                    <p className="text-sm font-medium">{d.name}</p>
                    {ORG_ROLE_KEYS.map((r) => (
                      <label key={r} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="roles"
                          value={r}
                          defaultChecked={current.has(r)}
                        />{" "}
                        {r}
                      </label>
                    ))}
                  </ActionForm>
                );
              })}
              <ActionForm
                action={setBanForm}
                submitLabel={editing.banned ? "Enable account" : "Disable account"}
                successMessage="Account status updated."
                className="flex flex-col gap-2"
                resetOnSuccess={false}
              >
                <input type="hidden" name="userId" value={editing.id} />
                <input type="hidden" name="banned" value={editing.banned ? "0" : "1"} />
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
