import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listYears, previewPeriodImpact } from "@/platform/academic/calendar";
import { periodKindSchema } from "@/platform/academic/schemas";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField, fmtDate, fmtDateTime } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createTermForm,
  createYearForm,
  deletePeriodForm,
  setCurrentTermForm,
  setPeriodForm,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function CalendarPage(props: PageProps<"/d/[dept]/calendar">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const years = await listYears(db, ctx.departmentId);
  const editPeriodId = typeof params.period === "string" ? params.period : null;
  const editing = editPeriodId
    ? years
        .flatMap((y) => y.terms)
        .flatMap((t) => t.periods)
        .find((p) => p.id === editPeriodId)
    : null;
  const impact = editing ? await previewPeriodImpact(db, editing.id) : [];
  const allTerms = years.flatMap((y) => y.terms.map((t) => ({ ...t, yearCode: y.code })));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Academic calendar</h1>
      {years.map((y) => (
        <Card key={y.id} data-testid={`year-${y.code}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {y.code}{" "}
              <Badge variant={y.status === "active" ? "default" : "secondary"}>{y.status}</Badge>
            </CardTitle>
            <CardDescription>
              {fmtDate(y.startDate)} to {fmtDate(y.endDate)} · quarters{" "}
              {(y.quarterBoundariesJson as Array<{ q: number; startDate: string; endDate: string }>)
                .map((q) => `Q${q.q} ${q.startDate}..${q.endDate}`)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {y.terms.map((t) => (
              <div key={t.id} className="rounded-md border p-3" data-testid={`term-${t.name}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {t.name}{" "}
                    <Badge variant={t.status === "current" ? "default" : "secondary"}>
                      {t.status}
                    </Badge>
                  </span>
                  {t.status !== "current" ? (
                    <ActionForm
                      action={setCurrentTermForm}
                      submitLabel="Make current"
                      successMessage="Current term set."
                      className="inline"
                    >
                      <input type="hidden" name="dept" value={dept} />
                      <input type="hidden" name="termId" value={t.id} />
                    </ActionForm>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(t.startDate)} to {fmtDate(t.endDate)}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {t.periods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono text-xs">{p.kind}</span> {p.label}:{" "}
                        {fmtDateTime(p.startAt)} to {fmtDateTime(p.endAt)}
                      </span>
                      <span className="flex gap-2">
                        <a
                          className="text-xs underline"
                          href={`/d/${dept}/calendar?period=${p.id}`}
                        >
                          edit
                        </a>
                        <ActionForm
                          action={deletePeriodForm}
                          submitLabel="×"
                          successMessage="Deleted."
                          className="inline"
                        >
                          <input type="hidden" name="dept" value={dept} />
                          <input type="hidden" name="periodId" value={p.id} />
                        </ActionForm>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit period: ${editing.label}` : "Add a period"}</CardTitle>
            <CardDescription>
              {editing
                ? impact.length
                  ? `${impact.length} scheduled item(s) anchor on this period and will move: ${impact.map((d) => d.label).join(", ")}`
                  : "Nothing anchors on this period yet."
                : "Typed windows drive campaigns, reminders and reports."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={setPeriodForm}
              submitLabel={editing ? "Save period" : "Add period"}
              successMessage="Period saved."
              className="grid gap-3"
              resetOnSuccess={!editing}
            >
              <input type="hidden" name="dept" value={dept} />
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <SelectField name="termId" label="Term" required defaultValue={editing?.termId}>
                {allTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.yearCode} · {t.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                name="kind"
                label="Kind"
                required
                defaultValue={editing?.kind ?? "add_drop"}
              >
                {periodKindSchema.options.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </SelectField>
              <Field name="label" label="Label" required defaultValue={editing?.label} />
              <Field
                name="startAt"
                label="Starts"
                type="datetime-local"
                required
                defaultValue={editing ? editing.startAt.toISOString().slice(0, 16) : undefined}
              />
              <Field
                name="endAt"
                label="Ends"
                type="datetime-local"
                required
                defaultValue={editing ? editing.endAt.toISOString().slice(0, 16) : undefined}
              />
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add a term</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createTermForm}
              submitLabel="Add term"
              successMessage="Term created."
              className="grid gap-3"
            >
              <input type="hidden" name="dept" value={dept} />
              <SelectField name="academicYearId" label="Academic year" required>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code}
                  </option>
                ))}
              </SelectField>
              <SelectField name="ordinal" label="Ordinal" required defaultValue="first">
                <option value="first">first</option>
                <option value="second">second</option>
                <option value="summer">summer</option>
              </SelectField>
              <Field name="name" label="Name" required placeholder="Semester I" />
              <Field name="startDate" label="Starts" type="date" required />
              <Field name="endDate" label="Ends" type="date" required />
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add an academic year</CardTitle>
            <CardDescription>
              Quarters are proposed as four equal parts; edit them later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createYearForm}
              submitLabel="Add year"
              successMessage="Year created."
              className="grid gap-3"
            >
              <input type="hidden" name="dept" value={dept} />
              <Field name="code" label="Code" required placeholder="2027/28" />
              <Field name="startDate" label="Starts" type="date" required />
              <Field name="endDate" label="Ends" type="date" required />
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
