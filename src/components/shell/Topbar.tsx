import { DepartmentSwitcher } from "./DepartmentSwitcher";
import { UserMenu } from "./UserMenu";

export function Topbar({
  deptSlug,
  userName,
  userEmail,
  isAdmin,
  departments,
  inbox,
}: {
  deptSlug: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  departments: Array<{ slug: string; code: string; name: string }>;
  inbox?: { unread: number; pendingAck: number } | null;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-card px-4 md:px-8">
      <DepartmentSwitcher current={deptSlug} departments={departments} />
      <div className="flex items-center gap-4">
        {inbox ? (
          <a
            href={`/d/${deptSlug}/inbox`}
            className="relative rounded-md border px-2 py-1 text-sm hover:bg-accent"
            data-testid="inbox-link"
          >
            Inbox
            {inbox.unread > 0 ? (
              <span
                className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                data-testid="inbox-badge"
              >
                {inbox.unread}
              </span>
            ) : null}
            {inbox.pendingAck > 0 ? (
              <span className="ml-1 text-xs text-destructive">
                {inbox.pendingAck} to acknowledge
              </span>
            ) : null}
          </a>
        ) : null}
        <UserMenu userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
      </div>
    </header>
  );
}
