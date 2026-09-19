import { CheckCheckIcon, ExternalLinkIcon, InboxIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { inbox, unreadCount } from "@/platform/scheduler/inbox";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, fmtDateTime } from "@/components/forms/Field";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { acknowledgeForm, declineForm, markReadForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxPage(props: PageProps<"/d/[dept]/inbox">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const filter = typeof params.filter === "string" ? params.filter : "all";
  const [items, counts] = ctx.personId
    ? await Promise.all([
        inbox(db, ctx.personId, {
          unreadOnly: filter === "unread",
          ackRequiredOnly: filter === "ack",
          limit: 100,
        }),
        unreadCount(db, ctx.personId),
      ])
    : [[], { unread: 0, pendingAck: 0 }];
  const unreadIds = items.filter((i) => !i.readAt).map((i) => i.id);
  const href = (k: string) => `/d/${dept}/inbox?filter=${k}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox"
        description="Notifications, duties and announcements addressed to you. Acknowledging is how the department knows you have seen something."
        actions={
          <>
            <SegmentedLinks
              label="Filter"
              items={[
                { label: "All", href: href("all"), active: filter === "all" },
                {
                  label: "Unread",
                  href: href("unread"),
                  active: filter === "unread",
                  count: counts.unread,
                },
                {
                  label: "To acknowledge",
                  href: href("ack"),
                  active: filter === "ack",
                  count: counts.pendingAck,
                },
              ]}
            />
            {unreadIds.length ? (
              <ActionForm
                action={markReadForm}
                submitLabel="Mark all read"
                variant="outline"
                successMessage="Marked."
                className="inline"
              >
                <input type="hidden" name="dept" value={dept} />
                {unreadIds.map((id) => (
                  <input key={id} type="hidden" name="ids" value={id} />
                ))}
              </ActionForm>
            ) : null}
          </>
        }
      />
      {!ctx.personId ? (
        <EmptyState
          title="Your account is not linked to a person record"
          hint="Nothing can be addressed to you until an administrator links your account to a person in this department."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={filter === "ack" ? <CheckCheckIcon /> : <InboxIcon />}
          title="Nothing here."
          hint={
            filter === "unread"
              ? "You have read everything. New notifications show up here as they arrive."
              : filter === "ack"
                ? "Nothing is waiting for your acknowledgement."
                : "Reminders, task assignments and duty notices arrive here."
          }
        />
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Notifications">
          {items.map((n) => {
            const open = n.ackRequired && !n.acknowledgedAt && !n.declinedAt;
            return (
              <li key={n.id}>
                <Card
                  data-testid={`notification-${n.dedupeKey.split(":")[0]}`}
                  className={cn("gap-4 py-4", !n.readAt && "border-l-4 border-l-primary")}
                >
                  <CardHeader className="gap-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {n.title}
                      {!n.readAt ? <Badge>new</Badge> : null}
                      {n.acknowledgedAt ? <Badge variant="outline">acknowledged</Badge> : null}
                      {n.declinedAt ? <Badge variant="destructive">declined</Badge> : null}
                    </CardTitle>
                    <CardDescription>
                      <span className="font-mono text-xs">{n.category}</span> ·{" "}
                      {fmtDateTime(n.createdAt)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <p className="whitespace-pre-line">{n.body}</p>
                    {n.actionUrl ? (
                      <a
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                        href={n.actionUrl}
                      >
                        Open <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                    {n.declineReason ? (
                      <p className="text-muted-foreground">Reason: {n.declineReason}</p>
                    ) : null}
                    {open ? (
                      <div className="flex flex-wrap items-end gap-3 rounded-md bg-muted/50 p-3">
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
                            variant="outline"
                            successMessage="Declined."
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="dept" value={dept} />
                            <input type="hidden" name="id" value={n.id} />
                            <Field
                              name="reason"
                              label="Reason"
                              required
                              placeholder="Why you cannot"
                            />
                          </ActionForm>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
