import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import { can } from "../identity/can";
import { dbPolicyStore } from "../identity/policy-store";
import type { Actor } from "../identity/can";
import { readProjection } from "./projections/registry";

// What a dashboard is made of. A widget knows what it needs and who may see it; the layout says
// where it goes. Everything a widget shows comes from a projection or from a query a page would
// have run anyway, so a dashboard is never the slowest page in the application.

export interface WidgetStat {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "warning" | "danger";
}

export interface WidgetRow {
  label: string;
  value: string;
  href?: string;
  meta?: string;
}

export interface Widget {
  key: string;
  title: string;
  /** Headline numbers. */
  stats?: WidgetStat[];
  /** A short list — five or six rows, never a table. */
  rows?: WidgetRow[];
  empty?: string;
  href?: string;
}

export interface WidgetContext {
  db: Db;
  actor: Actor;
  departmentId: string;
  deptSlug: string;
}

export interface WidgetDef {
  key: string;
  /** Who may see it at all; a widget nobody may see is never built. */
  permission?: string;
  build: (ctx: WidgetContext) => Promise<Widget | null>;
}

// a registry the page and the bootstrap must share: the bundler may hand a server component its
// own copy of a module, which is what globalSingleton exists to prevent
const widgets = globalSingleton("dashboard-widgets", () => new Map<string, WidgetDef>());

export function registerWidget(definition: WidgetDef): void {
  widgets.set(definition.key, definition);
}

export function listWidgets(): WidgetDef[] {
  return Array.from(widgets.values());
}

/** Builds the widgets of a layout, skipping the ones this person may not see. */
export async function buildWidgets(ctx: WidgetContext, keys: string[]): Promise<Widget[]> {
  const out: Widget[] = [];
  for (const key of keys) {
    const definition = widgets.get(key);
    if (!definition) continue;
    if (definition.permission) {
      const decision = await can(dbPolicyStore, ctx.actor, definition.permission, undefined, {
        verb: "read",
      });
      if (!decision.allowed) continue;
    }
    const widget = await definition.build(ctx);
    if (widget) out.push(widget);
  }
  return out;
}

export { readProjection };
