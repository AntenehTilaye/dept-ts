import { pageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { NotificationCategory } from "@/generated/prisma/enums";
import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { savePreferencesForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage(
  props: PageProps<"/d/[dept]/settings/notifications">,
) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const prefs = await prismaRoot.channelPreference.findMany({
    where: { userId: ctx.user.id, channel: "email" },
  });
  const off = new Set(prefs.filter((p) => !p.enabled).map((p) => p.category));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification settings</CardTitle>
        <CardDescription>
          In-app notifications always reach your inbox; untick the categories you do not want by
          email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={savePreferencesForm}
          submitLabel="Save"
          successMessage="Preferences saved."
          className="grid gap-3"
          resetOnSuccess={false}
        >
          <input type="hidden" name="dept" value={dept} />
          <div className="grid gap-1 md:grid-cols-2">
            {Object.values(NotificationCategory).map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="emailOff" value={c} defaultChecked={off.has(c)} /> No
                email for <span className="font-mono">{c}</span>
              </label>
            ))}
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
