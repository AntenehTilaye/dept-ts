import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import type { Option, SourceBinding } from "./field-schema";

// Source bindings turn a question into a live picker: its options come from the department's
// own data instead of a hand-typed list. Every resolver is department-scoped — the caller's
// client is a department transaction, so RLS already constrains what it can see.

export interface BindingContext {
  db: Db;
  departmentId: string;
  /** Person filling the form (own_enrollments and similar). */
  personId?: string | null;
  /** The subject the form is attached to (members_of_parent, tasks_in_context, ...). */
  subject?: { subjectType: string; subjectId: string } | null;
  args?: Record<string, unknown>;
}

export type BindingResolver = (ctx: BindingContext) => Promise<Option[]>;

const resolvers = globalSingleton("form-bindings", () => new Map<string, BindingResolver>());

export function registerBinding(key: SourceBinding, fn: BindingResolver): void {
  resolvers.set(key, fn);
}

export function hasBinding(key: string): boolean {
  return key === "none" || resolvers.has(key);
}

/** Options of a bound question; an unbound question returns its stored options. */
export async function resolveBinding(key: SourceBinding, ctx: BindingContext): Promise<Option[]> {
  if (key === "none") return [];
  const fn = resolvers.get(key);
  if (!fn) throw new Error(`Unknown source binding "${key}"`);
  return fn(ctx);
}

function arg(ctx: BindingContext, name: string): string | undefined {
  const v = ctx.args?.[name];
  return typeof v === "string" ? v : undefined;
}

const state = globalSingleton("form-bindings-installed", () => ({ installed: false }));

export function installBindings(): void {
  if (state.installed) return;
  state.installed = true;

  registerBinding("offerings_in_term", async ({ db, args }) => {
    const termId = typeof args?.termId === "string" ? args.termId : undefined;
    const rows = await db.courseOffering.findMany({
      where: termId ? { termId } : {},
      include: { course: true },
      orderBy: { course: { code: "asc" } },
    });
    return rows.map((o) => ({ value: o.id, label: `${o.course.code} ${o.course.title}` }));
  });

  registerBinding("courses_in_program", async (ctx) => {
    const programId = arg(ctx, "programId");
    const rows = await ctx.db.course.findMany({
      where: { status: "active", ...(programId ? { programId } : {}) },
      orderBy: { code: "asc" },
    });
    return rows.map((c) => ({ value: c.id, label: `${c.code} ${c.title}` }));
  });

  registerBinding("electives_in_campaign", async (ctx) => {
    const campaignId = arg(ctx, "campaignId");
    if (!campaignId) return [];
    const rows = await ctx.db.campaignSubject.findMany({
      where: { campaignId },
      orderBy: { label: "asc" },
    });
    return rows.map((s) => ({ value: s.id, label: s.label }));
  });

  registerBinding("own_enrollments", async ({ db, personId }) => {
    if (!personId) return [];
    const student = await db.student.findUnique({ where: { personId } });
    if (!student) return [];
    const rows = await db.enrollment.findMany({
      where: { studentId: student.personId },
      include: { sectionOffering: { include: { courseOffering: { include: { course: true } } } } },
    });
    return rows.map((e) => ({
      value: e.sectionOfferingId,
      label: `${e.sectionOffering.courseOffering.course.code} ${e.sectionOffering.sectionCode}`,
    }));
  });

  registerBinding("staff_in_department", async ({ db }) => {
    const rows = await db.staffProfile.findMany({
      include: { person: true },
      orderBy: { person: { fullName: "asc" } },
    });
    return rows.map((s) => ({ value: s.personId, label: s.person.fullName }));
  });

  registerBinding("tasks_in_context", async ({ db, subject }) => {
    if (!subject) return [];
    const rows = await db.task.findMany({
      where: { contextType: subject.subjectType as never, contextId: subject.subjectId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((t) => ({ value: t.id, label: t.title }));
  });

  registerBinding("members_of_parent", async ({ db, subject }) => {
    if (!subject) return [];
    const groupId =
      subject.subjectType === "group"
        ? subject.subjectId
        : ((
            await db.group.findFirst({
              where: {
                contextType: subject.subjectType as never,
                contextId: subject.subjectId,
              },
              select: { id: true },
            })
          )?.id ?? null);
    if (!groupId) return [];
    const rows = await db.groupMembership.findMany({
      where: { groupId, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
      include: { person: true },
      orderBy: { person: { fullName: "asc" } },
    });
    return rows.map((m) => ({ value: m.personId, label: m.person.fullName }));
  });

  // filled by the CQI phase; an unseeded context simply offers nothing
  registerBinding("prior_cqi_items", async () => []);

  registerBinding("resources_of_kind", async (ctx) => {
    const kind = arg(ctx, "kind");
    const rows = await ctx.db.resource.findMany({
      where: { status: "available", ...(kind ? { kind: kind as never } : {}) },
      orderBy: { code: "asc" },
    });
    return rows.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }));
  });

  // records of a published feature: what a record_picker offers
  registerBinding("records_of_feature", async (ctx) => {
    const featureKey = arg(ctx, "featureKey");
    if (!featureKey) return [];
    const definition = await ctx.db.featureDefinition.findFirst({
      where: { key: featureKey, OR: [{ departmentId: ctx.departmentId }, { departmentId: null }] },
      // a department's own definition wins over the faculty one of the same key
      orderBy: { departmentId: "desc" },
      select: { id: true },
    });
    if (!definition) return [];
    const presetKey = arg(ctx, "presetKey");
    const states = Array.isArray(ctx.args?.states) ? (ctx.args.states as string[]) : undefined;
    const rows = await ctx.db.featureRecord.findMany({
      where: {
        definitionId: definition.id,
        ...(presetKey ? { presetKey } : {}),
        ...(states?.length ? { currentStateKey: { in: states } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({ value: r.id, label: `${r.number} · ${r.title}` }));
  });

  registerBinding("participants_of_parent", async ({ db, subject }) => {
    if (!subject) return [];
    const rows = await db.groupMembership.findMany({
      where: {
        group: { contextType: subject.subjectType as never, contextId: subject.subjectId },
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      include: { person: true },
      orderBy: { person: { fullName: "asc" } },
    });
    return rows.map((m) => ({ value: m.personId, label: m.person.fullName }));
  });
}
