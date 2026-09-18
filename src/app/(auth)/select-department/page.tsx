import { redirect } from "next/navigation";
import { requireContext, UnauthenticatedError } from "@/lib/auth/require";
import { prismaRoot } from "@/lib/db/prisma";
import { parseMemberRoles } from "@/lib/auth/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectDepartmentAction, signOutAction } from "./actions";

export const metadata = { title: "Select department" };
export const dynamic = "force-dynamic";

export default async function SelectDepartmentPage() {
  let ctx;
  try {
    ctx = await requireContext();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login?next=/select-department");
    throw error;
  }

  const memberships = await prismaRoot.member.findMany({
    where: { userId: ctx.user.id },
    include: { organization: { include: { department: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  const options = memberships
    .filter((m) => m.organization.department)
    .map((m) => ({
      slug: m.organization.slug,
      name: m.organization.department!.name,
      code: m.organization.department!.code,
      roles: parseMemberRoles(m.role),
    }));

  if (options.length === 1 && !ctx.isAdmin) redirect(`/d/${options[0]!.slug}`);

  const all = ctx.isAdmin
    ? await prismaRoot.department.findMany({
        include: { organization: true },
        orderBy: { code: "asc" },
      })
    : [];
  const extra = all
    .filter((d) => !options.some((o) => o.slug === d.organization.slug))
    .map((d) => ({ slug: d.organization.slug, name: d.name, code: d.code, roles: [] as string[] }));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Choose a department</h2>
        <form action={signOutAction}>
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
      <p className="text-sm text-muted-foreground">Signed in as {ctx.user.email}.</p>
      {options.length === 0 && extra.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No department yet</CardTitle>
            <CardDescription>
              Your account is not a member of any department. Ask an administrator to add you.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {[...options, ...extra].map((o) => (
        <Card key={o.slug}>
          <CardHeader>
            <CardTitle>
              {o.name} <span className="text-muted-foreground">({o.code})</span>
            </CardTitle>
            <CardDescription>
              {o.roles.length ? o.roles.join(", ") : "administrator access"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={selectDepartmentAction}>
              <input type="hidden" name="slug" value={o.slug} />
              <Button type="submit">Open {o.code}</Button>
            </form>
          </CardContent>
        </Card>
      ))}
      {ctx.isAdmin ? (
        <Button asChild variant="outline">
          <a href="/admin">Administration</a>
        </Button>
      ) : null}
    </section>
  );
}
