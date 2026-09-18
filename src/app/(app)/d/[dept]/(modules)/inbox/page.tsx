import { dbOf, pageContext } from "@/lib/auth/page";
import { inbox } from "@/platform/scheduler/inbox";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, fmtDateTime } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acknowledgeForm, declineForm, markReadForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxPage(props: PageProps<"/d/[dept]/inbox">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const filter = typeof params.filter === "string" ? params.filter : "all";
  const items = ctx.personId
    ? await inbox(dbOf(ctx), ctx.personId, {
        unreadOnly: filter === "unread",
        ackRequiredOnly: filter === "ack",
        limit: 100,
      })
    : [];
  const unreadIds = items.filter((i) => !i.readAt).map((i) => i.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <nav className="flex gap-2 text-sm">
          {[
            ["all", "All"],
            ["unread", "Unread"],
            ["ack", "To acknowledge"],
          ].map(([k, label]) => (
            <a
              key={k}
              href={`/d/${dept}/inbox?filter=${k}`}
              className={`rounded-md border px-2 py-1 ${filter === k ? "bg-accent" : ""}`}
            >
              {label}
            </a>
          ))}
          {unreadIds.length ? (
            <ActionForm
              action={markReadForm}
              submitLabel="Mark all read"
              successMessage="Marked."
              className="inline"
            >
              <input type="hidden" name="dept" value={dept} />
              {unreadIds.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
            </ActionForm>
          ) : null}
        </nav>
      </div>
      {!ctx.personId ? (
        <p className="text-sm text-muted-foreground">
          Your account is not linked to a person record; nothing can be addressed to you yet.
        </p>
      ) : null}
      {items.map((n) => (
        <Card
          key={n.id}
          data-testid={`notification-${n.dedupeKey.split(":")[0]}`}
          className={n.readAt ? "opacity-80" : ""}
        >
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {n.title}
              <Badge variant="secondary">{n.category}</Badge>
              {!n.readAt ? <Badge>new</Badge> : null}
              {n.acknowledgedAt ? <Badge variant="outline">acknowledged</Badge> : null}
              {n.declinedAt ? <Badge variant="destructive">declined</Badge> : null}
            </CardTitle>
            <CardDescription>{fmtDateTime(n.createdAt)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-line">{n.body}</p>
            {n.actionUrl ? (
              <a className="underline" href={n.actionUrl}>
                Open
              </a>
            ) : null}
            {n.declineReason ? (
              <p className="text-muted-foreground">Reason: {n.declineReason}</p>
            ) : null}
            {n.ackRequired && !n.acknowledgedAt && !n.declinedAt ? (
              <div className="flex flex-wrap items-start gap-3">
                <ActionForm
                  action={acknowledgeForm}
                  submitLabel="Acknowledge"
                  successMessage="Acknowledged."
                  className="inline"
                >
                  <input type="hidden" name="dept" value={dept} />
                  <input type="hidden" name="id" value={n.id} />
                </ActionForm>
                {n.declinable ? (
                  <ActionForm
                    action={declineForm}
                    submitLabel="Decline"
                    successMessage="Declined."
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="dept" value={dept} />
                    <input type="hidden" name="id" value={n.id} />
                    <Field name="reason" label="Reason" required placeholder="Why you cannot" />
                  </ActionForm>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {ctx.personId && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : null}
    </div>
  );
}
