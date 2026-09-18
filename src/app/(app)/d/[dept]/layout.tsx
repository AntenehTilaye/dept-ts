import type { Route } from "next";
import { pageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { AppShell } from "@/components/shell/AppShell";
import type { NavItem } from "@/components/shell/Sidebar";

// Static navigation until the feature runtime provides getNav(actor, dept).
function staticNav(deptSlug: string): NavItem[] {
  return [{ href: `/d/${deptSlug}` as Route, label: "Overview" }];
}

export default async function DepartmentLayout(props: LayoutProps<"/d/[dept]">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const memberships = await prismaRoot.member.findMany({
    where: { userId: ctx.user.id },
    include: { organization: { include: { department: true } } },
  });
  const departments = (
    ctx.isAdmin
      ? await prismaRoot.department.findMany({
          include: { organization: true },
          orderBy: { code: "asc" },
        })
      : memberships.filter((m) => m.organization.department).map((m) => m.organization.department!)
  ).map((d) => ({ slug: d.code.toLowerCase(), code: d.code, name: d.name }));

  return (
    <AppShell
      deptSlug={dept}
      departmentName={ctx.departmentName}
      userName={ctx.user.name}
      userEmail={ctx.user.email}
      isAdmin={ctx.isAdmin}
      nav={staticNav(dept)}
      departments={departments}
    >
      {props.children}
    </AppShell>
  );
}
