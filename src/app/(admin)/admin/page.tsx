import Link from "next/link";
import { prismaRoot } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [users, departments, roles] = await Promise.all([
    prismaRoot.user.count(),
    prismaRoot.department.count(),
    prismaRoot.role.count({ where: { departmentId: null } }),
  ]);
  const tiles = [
    { href: "/admin/users", label: "Users", value: users },
    { href: "/admin/departments", label: "Departments", value: departments },
    { href: "/admin/permissions", label: "Faculty roles", value: roles },
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.href}>
          <CardHeader>
            <CardTitle>
              <Link href={t.href} className="underline">
                {t.label}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{t.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
