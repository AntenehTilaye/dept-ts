import { FileQuestionIcon } from "lucide-react";
import { adminPageContext } from "@/lib/auth/page";
import { withTenantBypass } from "@/lib/db/tenant";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { JsonField } from "@/components/forms/JsonField";
import { EmptyState } from "@/components/patterns/EmptyState";
import { ListLayout } from "@/components/patterns/ListLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createFormForm } from "./actions";

export const dynamic = "force-dynamic";

const KINDS = [
  "survey",
  "evaluation",
  "preference",
  "add_drop",
  "elective",
  "issue",
  "committee_report",
  "portfolio_narrative",
  "cqi_narrative",
  "quarterly_narrative",
  "activity_progress",
  "appointment_request",
  "generic",
] as const;

const SAMPLE = `[
  {
    "key": "clarity",
    "type": "likert",
    "label": "The course was clearly structured",
    "aggregation": "mean",
    "constraints": { "required": true, "min": 1, "max": 5 }
  },
  {
    "key": "comment",
    "type": "long_text",
    "label": "Anything else?",
    "constraints": { "required": false }
  }
]`;

export default async function FormsPage() {
  const ctx = await adminPageContext();
  // form_definition is a SHARED table: department-scoped forms stay invisible without a bypass.
  const rows = await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    "list form definitions",
    (tx) =>
      tx.formDefinition.findMany({
        orderBy: [{ key: "asc" }, { version: "desc" }],
        include: { _count: { select: { questions: true, submissions: true } } },
      }),
  );
  // a key exists once per scope: the faculty form and a department override are separate lines.
  const byScope = new Map<string, typeof rows>();
  for (const r of rows) {
    const scope = [r.key, r.departmentId ?? ""].join("@");
    byScope.set(scope, [...(byScope.get(scope) ?? []), r]);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Forms"
        description="Versioned question sets. Campaigns, standalone submissions and feature steps all run on these."
      />
      <ListLayout
        aside={
          <Card>
            <CardHeader>
              <CardTitle>New form</CardTitle>
              <CardDescription>
                Questions are a JSON array of fields; the feature wizard edits the same shape
                visually.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={createFormForm}
                submitLabel="Create and publish"
                successMessage="Form created."
                className="grid gap-4"
              >
                <Field name="key" label="Key" required placeholder="course_feedback" />
                <Field name="title" label="Title" required />
                <SelectField name="kind" label="Kind" required defaultValue="survey">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </SelectField>
                <Field name="description" label="Description" />
                <JsonField
                  name="fields"
                  label="Questions (JSON)"
                  rows={12}
                  required
                  initialValue={SAMPLE}
                />
              </ActionForm>
            </CardContent>
          </Card>
        }
      >
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                icon={<FileQuestionIcon />}
                title="No forms yet"
                hint="Seeded system forms appear here; add your own with the panel on the right."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Versions</TableHead>
                    <TableHead>Questions</TableHead>
                    <TableHead>Responses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(byScope.entries()).map(([scope, versions]) => {
                    const current = versions.find((v) => v.status === "published") ?? versions[0]!;
                    return (
                      <TableRow key={scope} data-testid={`form-${current.key}`}>
                        <TableCell className="font-mono">
                          <a className="underline" href={`/admin/forms/${current.id}`}>
                            {current.key}
                          </a>
                        </TableCell>
                        <TableCell>{current.title}</TableCell>
                        <TableCell>{current.kind}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {current.departmentId ?? "faculty"}
                        </TableCell>
                        <TableCell className="flex flex-wrap gap-1">
                          {versions.map((v) => (
                            <Badge
                              key={v.id}
                              variant={v.status === "published" ? "default" : "secondary"}
                            >
                              v{v.version} {v.status}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell className="tabular-nums">{current._count.questions}</TableCell>
                        <TableCell className="tabular-nums">
                          {versions.reduce((n, v) => n + v._count.submissions, 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </ListLayout>
    </div>
  );
}
