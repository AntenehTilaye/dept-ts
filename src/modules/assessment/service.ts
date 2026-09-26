import type { Db } from "@/lib/db/types";
import { publish as emit } from "@/platform/audit/outbox";
import { declaredWeight, weightsAddUp, type ComponentDef } from "./results";

// The scheme: how a course is marked. An offering declares its components once, and a section that
// does something different declares an override that says which offering component each of its own
// stands for — that pointer is what lets the course-level figures be consolidated from sections
// that were not marked identically. Once the structure is locked, the components may not move,
// because marks already committed were entered against them.

export interface ComponentInput {
  key: string;
  name: string;
  maxMark: number;
  weightPercent: number;
  order?: number;
  isFinal?: boolean;
  offeringComponentId?: string | null;
  excludedFromConsolidation?: boolean;
}

export class SchemeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemeError";
  }
}

const num = (value: unknown): number => Number(value ?? 0);

function toDef(row: {
  key: string;
  name: string;
  maxMark: unknown;
  weightPercent: unknown;
  isFinal: boolean;
  excludedFromConsolidation: boolean;
}): ComponentDef {
  return {
    key: row.key,
    name: row.name,
    maxMark: num(row.maxMark),
    weightPercent: num(row.weightPercent),
    isFinal: row.isFinal,
    excludedFromConsolidation: row.excludedFromConsolidation,
  };
}

/** The offering's own scheme, creating the empty one the editor writes into. */
export async function schemeOfOffering(db: Db, departmentId: string, courseOfferingId: string) {
  const existing = await db.assessmentScheme.findFirst({
    where: { courseOfferingId, sectionOfferingId: null },
    include: { components: { orderBy: { order: "asc" } } },
  });
  if (existing) return existing;
  await db.assessmentScheme.create({
    data: { departmentId, courseOfferingId, sectionOfferingId: null },
  });
  return db.assessmentScheme.findFirstOrThrow({
    where: { courseOfferingId, sectionOfferingId: null },
    include: { components: { orderBy: { order: "asc" } } },
  });
}

/**
 * The components a section is marked against: its own override when it has one, otherwise the
 * offering's. A mark sheet's columns are these, which is why a validator asks for them by section.
 */
export async function componentsOfSection(db: Db, sectionOfferingId: string): Promise<ComponentDef[]> {
  if (!sectionOfferingId) return [];
  const own = await db.assessmentScheme.findFirst({
    where: { sectionOfferingId },
    include: { components: { orderBy: { order: "asc" } } },
  });
  if (own?.components.length) return own.components.map(toDef);
  const section = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    select: { courseOfferingId: true },
  });
  if (!section) return [];
  const offering = await db.assessmentScheme.findFirst({
    where: { courseOfferingId: section.courseOfferingId, sectionOfferingId: null },
    include: { components: { orderBy: { order: "asc" } } },
  });
  return (offering?.components ?? []).map(toDef);
}

/** Replaces a scheme's components wholesale; refused once the structure is locked. */
export async function setComponents(
  db: Db,
  departmentId: string,
  target: { courseOfferingId: string; sectionOfferingId?: string | null },
  components: ComponentInput[],
): Promise<{ components: number; declaredWeight: number }> {
  const offering = await db.courseOffering.findUniqueOrThrow({
    where: { id: target.courseOfferingId },
    select: { schemeStructureLockedAt: true },
  });
  if (offering.schemeStructureLockedAt)
    throw new SchemeError(
      "The assessment structure of this offering is locked; the components can no longer be changed.",
    );
  const keys = new Set(components.map((c) => c.key));
  if (keys.size !== components.length)
    throw new SchemeError("Two components have the same key.");
  if (components.some((c) => c.maxMark <= 0))
    throw new SchemeError("A component is marked out of nothing.");

  const scheme =
    (await db.assessmentScheme.findFirst({
      where: {
        courseOfferingId: target.courseOfferingId,
        sectionOfferingId: target.sectionOfferingId ?? null,
      },
    })) ??
    (await db.assessmentScheme.create({
      data: {
        departmentId,
        courseOfferingId: target.courseOfferingId,
        sectionOfferingId: target.sectionOfferingId ?? null,
      },
    }));

  // a component that is gone takes its marks with it: that is what "the structure changed" means,
  // and it is exactly what the lock exists to prevent once anything has been committed
  await db.assessmentComponent.deleteMany({
    where: { schemeId: scheme.id, key: { notIn: Array.from(keys) } },
  });
  for (const [index, component] of components.entries()) {
    const data = {
      departmentId,
      schemeId: scheme.id,
      name: component.name.trim(),
      maxMark: component.maxMark,
      weightPercent: component.weightPercent,
      order: component.order ?? index,
      isFinal: component.isFinal ?? false,
      offeringComponentId: component.offeringComponentId ?? null,
      excludedFromConsolidation: component.excludedFromConsolidation ?? false,
    };
    await db.assessmentComponent.upsert({
      where: { schemeId_key: { schemeId: scheme.id, key: component.key } },
      update: data,
      create: { ...data, key: component.key },
    });
  }

  const defs: ComponentDef[] = components.map((c) => ({
    key: c.key,
    name: c.name,
    maxMark: c.maxMark,
    weightPercent: c.weightPercent,
    isFinal: c.isFinal ?? false,
    excludedFromConsolidation: c.excludedFromConsolidation ?? false,
  }));
  await emit(
    db,
    "assessment.scheme.changed",
    { subjectType: "course_offering", subjectId: target.courseOfferingId },
    { sectionOfferingId: target.sectionOfferingId ?? null, components: components.length },
    { departmentId },
  );
  return { components: components.length, declaredWeight: declaredWeight(defs) };
}

/** Whether a section can be marked at all: it needs components that add up. */
export async function schemeIsMarkable(db: Db, sectionOfferingId: string): Promise<boolean> {
  const components = await componentsOfSection(db, sectionOfferingId);
  return components.length > 0 && weightsAddUp(components);
}

/**
 * Locks the structure of an offering's scheme. Called when the first marks are committed: from
 * then on a component may be renamed but not added, removed or re-weighted, because every mark
 * already stored was entered against the structure as it was.
 */
export async function lockSchemeStructure(
  db: Db,
  departmentId: string,
  courseOfferingId: string,
): Promise<boolean> {
  const offering = await db.courseOffering.findUniqueOrThrow({
    where: { id: courseOfferingId },
    select: { schemeStructureLockedAt: true },
  });
  if (offering.schemeStructureLockedAt) return false;
  await db.courseOffering.update({
    where: { id: courseOfferingId },
    data: { schemeStructureLockedAt: new Date() },
  });
  await emit(
    db,
    "assessment.scheme.locked",
    { subjectType: "course_offering", subjectId: courseOfferingId },
    {},
    { departmentId },
  );
  return true;
}

/** Whether a section's marks may still be replaced: a portfolio that quoted them locks them. */
export async function sectionIsLocked(db: Db, sectionOfferingId: string): Promise<boolean> {
  const section = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    select: { assessmentLockedAt: true },
  });
  return !!section?.assessmentLockedAt;
}
