import { dbOf, pageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { navFor } from "@/lib/nav";
import { unreadCount } from "@/platform/scheduler/inbox";
import { AppShell } from "@/components/shell/AppShell";

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

  const inbox = ctx.personId ? await unreadCount(dbOf(ctx), ctx.personId) : null;
  return (
    <AppShell
      deptSlug={dept}
      departmentName={ctx.departmentName}
      userName={ctx.user.name}
      userEmail={ctx.user.email}
      isAdmin={ctx.isAdmin}
      nav={await navFor(ctx)}
      inbox={inbox}
      departments={departments}
    >
      {props.children}
    </AppShell>
  );
}
