import type { ReactNode } from "react";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface ShellProps {
  deptSlug: string;
  departmentName: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  nav: NavItem[];
  departments: Array<{ slug: string; code: string; name: string }>;
  children: ReactNode;
}

export function AppShell({
  children,
  nav,
  deptSlug,
  departmentName,
  userName,
  userEmail,
  isAdmin,
  departments,
}: ShellProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar deptSlug={deptSlug} departmentName={departmentName} items={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          deptSlug={deptSlug}
          userName={userName}
          userEmail={userEmail}
          isAdmin={isAdmin}
          departments={departments}
        />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
