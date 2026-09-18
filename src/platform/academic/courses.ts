import type { CourseType } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";

export interface ProgramInput {
  code: string;
  name: string;
  degreeLevel: string;
  durationYears: number;
  gradeScaleKey?: string;
}

export async function upsertProgram(
  db: Db,
  departmentId: string,
  input: ProgramInput & { id?: string },
) {
  const data = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    degreeLevel: input.degreeLevel,
    durationYears: input.durationYears,
    gradeScaleKey: input.gradeScaleKey ?? "default",
  };
  if (input.id) return db.program.update({ where: { id: input.id }, data });
  return db.program.create({ data: { departmentId, ...data } });
}

export async function listPrograms(db: Db, departmentId: string) {
  return db.program.findMany({ where: { departmentId }, orderBy: { code: "asc" } });
}

export interface CourseInput {
  code: string;
  title: string;
  creditHours: number;
  courseType: CourseType;
  programId?: string | null;
  predecessorCourseId?: string | null;
}

export async function upsertCourse(
  db: Db,
  departmentId: string,
  input: CourseInput & { id?: string; status?: "active" | "retired" },
) {
  if (input.id && input.predecessorCourseId === input.id)
    throw new Error("A course cannot be its own predecessor");
  const data = {
    code: input.code.trim().toUpperCase(),
    title: input.title.trim(),
    creditHours: input.creditHours,
    courseType: input.courseType,
    programId: input.programId ?? null,
    predecessorCourseId: input.predecessorCourseId ?? null,
    ...(input.status ? { status: input.status } : {}),
  };
  if (input.id) return db.course.update({ where: { id: input.id }, data });
  return db.course.create({ data: { departmentId, ...data } });
}

export async function listCourses(
  db: Db,
  departmentId: string,
  opts: { includeRetired?: boolean } = {},
) {
  return db.course.findMany({
    where: { departmentId, ...(opts.includeRetired ? {} : { status: "active" }) },
    include: {
      program: { select: { code: true } },
      predecessor: { select: { id: true, code: true } },
    },
    orderBy: { code: "asc" },
  });
}

/** Walks predecessor_course_id from a course back through its history (oldest last). */
export async function courseLineage(db: Db, courseId: string) {
  const chain: Array<{
    id: string;
    code: string;
    title: string;
    predecessorCourseId: string | null;
  }> = [];
  const seen = new Set<string>();
  let cursor: string | null = courseId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const course: {
      id: string;
      code: string;
      title: string;
      predecessorCourseId: string | null;
    } | null = await db.course.findUnique({
      where: { id: cursor },
      select: { id: true, code: true, title: true, predecessorCourseId: true },
    });
    if (!course) break;
    chain.push(course);
    cursor = course.predecessorCourseId;
  }
  return chain;
}

/** Offerings of a course and of its predecessors, newest term first. */
export async function listOfferingsOfCourse(db: Db, courseId: string, includeLineage = true) {
  const ids = includeLineage ? (await courseLineage(db, courseId)).map((c) => c.id) : [courseId];
  return db.courseOffering.findMany({
    where: { courseId: { in: ids } },
    include: { course: { select: { code: true } }, term: { include: { academicYear: true } } },
    orderBy: { term: { startDate: "desc" } },
  });
}
