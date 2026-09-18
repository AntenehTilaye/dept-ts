import { prismaRoot } from "@/lib/db/prisma";
import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createDepartmentForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  const departments = await prismaRoot.department.findMany({
    include: { organization: { include: { _count: { select: { members: true } } } } },
    orderBy: { code: "asc" },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.code}</TableCell>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>/d/{d.organization.slug}</TableCell>
                  <TableCell>{d.organization._count.members}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New department</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createDepartmentForm}
            submitLabel="Create department"
            successMessage="Department created."
            className="flex flex-col gap-3"
          >
            <div className="grid gap-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" placeholder="ME" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Mechanical Engineering" required />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
