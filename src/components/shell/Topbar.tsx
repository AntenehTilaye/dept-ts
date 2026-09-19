import { BellIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "./CommandPalette";
import { DepartmentSwitcher } from "./DepartmentSwitcher";
import { MobileNav, type NavItem } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

export function Topbar({
  rootHref,
  title,
  subtitle,
  nav,
  userName,
  userEmail,
  isAdmin,
  departments,
  currentSlug,
  inbox,
  inboxHref,
  children,
}: {
  rootHref: string;
  title: string;
  subtitle: string;
  nav: NavItem[];
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  departments?: Array<{ slug: string; code: string; name: string }>;
  currentSlug?: string;
  inbox?: { unread: number; pendingAck: number } | null;
  inboxHref?: string;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur md:px-6">
      <MobileNav rootHref={rootHref} title={title} subtitle={subtitle} items={nav} />
      {departments && currentSlug ? (
        <DepartmentSwitcher current={currentSlug} departments={departments} />
      ) : (
        <span className="text-sm font-medium">{subtitle}</span>
      )}
      <div className="flex-1" />
      {children}
      <CommandPalette items={nav} />
      {inbox && inboxHref ? (
        <a
          href={inboxHref}
          className="relative inline-flex size-9 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Inbox, ${inbox.unread} unread`}
          data-testid="inbox-link"
        >
          <BellIcon className="size-4" aria-hidden="true" />
          {inbox.unread > 0 ? (
            <Badge
              className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none"
              data-testid="inbox-badge"
            >
              {inbox.unread}
            </Badge>
          ) : null}
          {inbox.pendingAck > 0 ? (
            <span className="sr-only">{inbox.pendingAck} awaiting acknowledgement</span>
          ) : null}
        </a>
      ) : null}
      <ThemeToggle />
      <UserMenu userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
    </header>
  );
}
