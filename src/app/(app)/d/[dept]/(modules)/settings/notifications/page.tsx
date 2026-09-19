import { pageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { NotificationCategory } from "@/generated/prisma/enums";
import { ActionForm } from "@/components/forms/ActionForm";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { savePreferencesForm } from "./actions";

export const dynamic = "force-dynamic";

const LABELS: Partial<Record<NotificationCategory, string>> = {
  assignment: "Assignments to me",
  deadline_approaching: "Deadline reminders",
  deadline_missed: "Overdue notices",
  committee_task: "Committee tasks",
  portfolio_reminder: "Portfolio reminders",
  evaluation_invitation: "Evaluation invitations",
  appointment: "Appointments",
  meeting: "Meetings",
  invigilation: "Invigilation duties",
  lab_assignment: "Lab assignments",
  preference_request: "Preference requests",
  campaign: "Campaign openings",
  announcement: "Announcements",
  mention: "Mentions",
  workflow: "Workflow steps",
  report_ready: "Reports ready",
  system_alert: "System alerts",
};

export default async function NotificationSettingsPage(
  props: PageProps<"/d/[dept]/settings/notifications">,
) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const prefs = await prismaRoot.channelPreference.findMany({
    where: { userId: ctx.user.id, channel: "email" },
  });
  const off = new Set(prefs.filter((p) => !p.enabled).map((p) => p.category));
  const categories = Object.values(NotificationCategory);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notification settings"
        description="In-app notifications always reach your inbox. Choose which categories also arrive by email."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>Changes apply to notifications sent after you save.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={savePreferencesForm}
            submitLabel="Save"
            successMessage="Preferences saved."
            className="grid gap-4"
            resetOnSuccess={false}
          >
            <input type="hidden" name="dept" value={dept} />
            <ul className="divide-y rounded-md border">
              {categories.map((c) => (
                <li key={c} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <Label htmlFor={`email-${c}`} className="flex-col items-start gap-0.5">
                    <span>{LABELS[c] ?? c}</span>
                    <span className="font-mono text-xs font-normal text-muted-foreground">{c}</span>
                  </Label>
                  <Switch id={`email-${c}`} name="emailOn" value={c} defaultChecked={!off.has(c)} />
                </li>
              ))}
            </ul>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
