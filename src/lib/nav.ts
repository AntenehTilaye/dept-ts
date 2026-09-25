import type { Route } from "next";
import type { DeptCtx } from "./auth/require";
import { actorOf, canDo } from "./auth/require";
import { getDb } from "./db/scoped";
import type { Db } from "./db/types";
import { getNav } from "@/platform/feature";
import type { NavItem } from "@/components/shell/Sidebar";

// Department navigation gated by permissions. The feature runtime appends its entries later.
interface NavSpec {
  path: string;
  label: string;
  group?: string;
  permission?: string;
  icon?: string;
}

const NAV: NavSpec[] = [
  { path: "", label: "Overview" },
  { path: "/my-work", label: "My work", group: "Me", icon: "my-work" },
  { path: "/inbox", label: "Inbox", group: "Me" },
  { path: "/upcoming", label: "Upcoming", group: "Me" },
  { path: "/availability", label: "My availability", group: "Me", icon: "availability" },
  {
    path: "/settings/notifications",
    label: "Notification settings",
    group: "Me",
    icon: "settings",
  },
  // scoped inside the page: department-wide for task.view, own assignments otherwise
  { path: "/tasks", label: "Tasks", group: "Work" },
  { path: "/people", label: "People", group: "Registry", permission: "staff.view" },
  { path: "/sections", label: "Sections", group: "Registry", permission: "academic.manage" },
  { path: "/calendar", label: "Calendar", group: "Registry", permission: "academic.manage" },
  { path: "/programs", label: "Programs", group: "Registry", permission: "academic.manage" },
  { path: "/courses", label: "Courses", group: "Registry", permission: "academic.manage" },
  { path: "/offerings", label: "Offerings", group: "Registry", permission: "academic.manage" },
  { path: "/resources", label: "Resources", group: "Registry", permission: "academic.manage" },
  { path: "/documents", label: "Documents", group: "Library", permission: "document.read" },
  { path: "/reports", label: "Reports", group: "Library", icon: "reports", permission: "task.view" },
];

/** Sidebar headings for the groups a feature definition may place itself in. */
const FEATURE_GROUPS: Record<string, string> = {
  operations: "Work",
  academic: "Registry",
  people: "Registry",
  communication: "Me",
  planning: "Planning",
  resources: "Registry",
  admin: "Administration",
};

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

  // published features add themselves: a process an administrator composes appears here without
  // a deployment, in the group and order its definition names
  const entries = await getNav(getDb(ctx.departmentId) as unknown as Db, ctx.departmentId, actorOf(ctx), {
    deptSlug: ctx.deptSlug,
  });
  for (const entry of entries)
    items.push({
      href: entry.href as Route,
      label: entry.label,
      group: FEATURE_GROUPS[entry.group] ?? "Work",
    });

  return items;
}
