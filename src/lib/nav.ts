import type { Route } from "next";
import type { DeptCtx } from "./auth/require";
import { canDo } from "./auth/require";
import type { NavItem } from "@/components/shell/Sidebar";

// Department navigation gated by permissions. The feature runtime appends its entries later.
interface NavSpec {
  path: string;
  label: string;
  group?: string;
  permission?: string;
}

const NAV: NavSpec[] = [
  { path: "", label: "Overview" },
  { path: "/inbox", label: "Inbox" },
  { path: "/upcoming", label: "Upcoming" },
  { path: "/settings/notifications", label: "Notification settings" },
  { path: "/people", label: "People", group: "Registry", permission: "staff.view" },
  { path: "/sections", label: "Sections", group: "Registry", permission: "academic.manage" },
  { path: "/calendar", label: "Calendar", group: "Registry", permission: "academic.manage" },
  { path: "/programs", label: "Programs", group: "Registry", permission: "academic.manage" },
  { path: "/courses", label: "Courses", group: "Registry", permission: "academic.manage" },
  { path: "/offerings", label: "Offerings", group: "Registry", permission: "academic.manage" },
  { path: "/resources", label: "Resources", group: "Registry", permission: "academic.manage" },
];

export async function navFor(ctx: DeptCtx): Promise<NavItem[]> {
  const items: NavItem[] = [];
  for (const spec of NAV) {
    if (spec.permission && !(await canDo(ctx, spec.permission, undefined, "read")).allowed)
      continue;
    items.push({
      href: `/d/${ctx.deptSlug}${spec.path}` as Route,
      label: spec.label,
      group: spec.group,
    });
  }
  return items;
}
