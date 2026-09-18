import { pageContext } from "@/lib/auth/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DepartmentHome(props: PageProps<"/d/[dept]">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{ctx.departmentName}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {ctx.user.name}. The dashboard arrives with the reporting phase.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your roles in this department</CardTitle>
          <CardDescription>
            Membership roles plus any scoped grants (committee chair, section representative, ...).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2" data-testid="role-keys">
          {ctx.roleKeys.length ? (
            ctx.roleKeys.map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))
          ) : (
            <span className="text-sm">none</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
