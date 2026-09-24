import type { Route } from "next";
import type { ReactNode } from "react";
import { adminPageContext } from "@/lib/auth/page";
import { AppShell } from "@/components/shell/AppShell";
import type { NavItem } from "@/components/shell/Sidebar";

const NAV: NavItem[] = [
  { href: "/admin" as Route, label: "Overview", icon: "overview" },
  { href: "/admin/users" as Route, label: "Users", group: "Access" },
  { href: "/admin/departments" as Route, label: "Departments", group: "Access" },
  { href: "/admin/permissions" as Route, label: "Permissions", group: "Access" },
  { href: "/admin/settings" as Route, label: "Settings", group: "Configuration" },
  { href: "/admin/templates" as Route, label: "Templates", group: "Configuration" },
  { href: "/admin/forms" as Route, label: "Forms", group: "Configuration" },
  { href: "/admin/reminders" as Route, label: "Reminders", group: "Configuration" },
  { href: "/admin/features" as Route, label: "Features", group: "Configuration" },
  { href: "/admin/workflows" as Route, label: "Workflows", group: "Operations" },
  { href: "/admin/jobs" as Route, label: "Jobs", group: "Operations" },
  { href: "/admin/audit" as Route, label: "Audit", group: "Operations" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await adminPageContext();
  return (
    <AppShell
      rootHref="/admin"
      title="DeptTS"
      subtitle="Faculty administration"
      nav={NAV}
      userName={ctx.user.name}
      userEmail={ctx.user.email}
      isAdmin
    >
      {children}
    </AppShell>
  );
}
