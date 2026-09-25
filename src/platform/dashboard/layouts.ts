import { globalSingleton } from "../../lib/singleton";
import { actorRoleKeys } from "../workflow/actors";
import { buildWidgets, type Widget, type WidgetContext } from "./widgets";

// Which widgets a person sees, and in what order. A layout is per role because that is how
// people actually differ here: a head opens the page to see the department, an instructor to
// see their own week. A module adds widgets and may extend a layout; it never forks the page.

export interface LayoutDef {
  role: string;
  widgets: string[];
}

const layouts = globalSingleton("dashboard-layouts", () => new Map<string, LayoutDef>());

export function registerLayout(layout: LayoutDef): void {
  layouts.set(layout.role, layout);
}

export function layoutFor(roles: Iterable<string>): string[] {
  for (const role of roles) {
    const layout = layouts.get(role);
    if (layout) return layout.widgets;
  }
  return layouts.get("default")?.widgets ?? [];
}

/** The dashboard of one person: their layout's widgets, minus the ones they may not see. */
export async function getDashboard(ctx: WidgetContext): Promise<Widget[]> {
  const roles = await actorRoleKeys(ctx.db, ctx.actor);
  // the order of this list is the order roles are preferred in, most specific first
  const preferred = [
    "department_head",
    "deputy_head",
    "committee_chair",
    "instructor",
    "lab_staff",
    "student_rep",
    "student",
    "default",
  ].filter((role) => role === "default" || roles.has(role));
  return buildWidgets(ctx, layoutFor(preferred));
}
