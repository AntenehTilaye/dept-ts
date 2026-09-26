import type { PrismaClient } from "../../../src/generated/prisma/client";
import { upsertCourse } from "../../../src/platform/academic/courses";
import { ensureSectionOffering } from "../../../src/platform/academic/offerings";
import { provisionOffering } from "../../../src/modules/assessment/provision";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { runWithAudit } from "../../../src/platform/audit/context";
import { assignTeaching } from "../../../src/platform/academic/teaching";
import { enrollSectionMembers } from "../../../src/platform/academic/enrollment";
import { upsertTimetableSlots } from "../../../src/platform/academic/timetable";
import { upsertResource } from "../../../src/platform/academic/resources";
import { SEED_YEARS } from "../calendar";

// Demo courses, offerings, teaching, rosters, rooms and timetable for CS. CS201 replaces the
// retired CS200 (lineage), and the previous closed year holds a CS200 offering as CQI baseline.
export const DEMO_COURSES = [
  {
    code: "CS200",
    title: "Data Structures (legacy)",
    creditHours: 3,
    courseType: "core" as const,
    status: "retired" as const,
  },
  {
    code: "CS201",
    title: "Data Structures and Algorithms",
    creditHours: 4,
    courseType: "core" as const,
    predecessor: "CS200",
  },
  { code: "CS202", title: "Database Systems", creditHours: 3, courseType: "core" as const },
  { code: "CS203", title: "Computer Networks", creditHours: 3, courseType: "core" as const },
  { code: "CS301", title: "Machine Learning", creditHours: 3, courseType: "elective" as const },
  { code: "GE101", title: "Communication Skills", creditHours: 2, courseType: "common" as const },
];

export async function seedDemoCourses(
  db: PrismaClient,
  ctx: { program: { id: string }; sections: string[]; staffPersons: Map<string, string> },
) {
  const departmentId = "dep_cs";
  // an offering is a record of the `course_offering` feature, so the demo creates one the way a
  // department does — through the runtime, as the head
  const head = await db.person.findFirst({ where: { email: "dh.cs@deptts.local" } });
  const actor = {
    userId: head?.userId ?? "system",
    personId: head?.id ?? null,
    departmentId,
    isAdmin: false,
  };
  const offeringOf = async (input: {
    courseId: string;
    termId: string;
    coordinatorPersonId?: string;
    running?: boolean;
  }) =>
    runWithAudit(
      { departmentId, actorUserId: actor.userId, correlationId: "seed:demo-offering" },
      () =>
        withTenantTx(departmentId, (tx) =>
          provisionOffering(tx, departmentId, actor, {
            courseId: input.courseId,
            termId: input.termId,
            coordinatorPersonId: input.coordinatorPersonId ?? null,
            advanceTo: input.running === false ? "planned" : "running",
          }),
        ),
    );
  const courses = new Map<string, string>();
  for (const c of DEMO_COURSES) {
    let course = await db.course.findUnique({
      where: { departmentId_code: { departmentId, code: c.code } },
    });
    if (!course) {
      course = await upsertCourse(db, departmentId, {
        code: c.code,
        title: c.title,
        creditHours: c.creditHours,
        courseType: c.courseType,
        programId: c.courseType === "common" ? null : ctx.program.id,
        predecessorCourseId: c.predecessor ? courses.get(c.predecessor) : null,
        status: c.status,
      });
    }
    courses.set(c.code, course.id);
  }

  // rooms
  const room = await ensureResource(db, departmentId, {
    code: "R101",
    name: "Room 101",
    kind: "classroom",
    building: "Block A",
    capacity: 60,
  });
  const lab = await ensureResource(db, departmentId, {
    code: "LAB-A",
    name: "Computer Lab A",
    kind: "computer_lab",
    building: "Block C",
    capacity: 30,
    computerCount: 30,
    softwareList: ["VS Code", "PostgreSQL", "Python 3"],
    responsiblePersonId: ctx.staffPersons.get("instructor3.cs") ?? null,
  });

  // current term offerings
  const currentYear = await db.academicYear.findUniqueOrThrow({
    where: { departmentId_code: { departmentId, code: SEED_YEARS.current.code } },
  });
  const term = await db.term.findUniqueOrThrow({
    where: { academicYearId_ordinal: { academicYearId: currentYear.id, ordinal: "first" } },
  });
  const plan = [
    {
      code: "CS201",
      coordinator: "instructor1.cs",
      teachers: { A: "instructor1.cs", B: "instructor2.cs" },
    },
    {
      code: "CS202",
      coordinator: "instructor2.cs",
      teachers: { A: "instructor2.cs", B: "instructor3.cs" },
    },
    { code: "CS203", coordinator: "chair.cs", teachers: { A: "chair.cs", B: "chair.cs" } },
  ];
  const slots: Parameters<typeof upsertTimetableSlots>[3] = [];
  for (const [i, p] of plan.entries()) {
    const offering = await offeringOf({
      courseId: courses.get(p.code)!,
      termId: term.id,
      coordinatorPersonId: ctx.staffPersons.get(p.coordinator),
    });
    for (const [j, sectionId] of ctx.sections.entries()) {
      const so = await ensureSectionOffering(db, departmentId, {
        courseOfferingId: offering.id,
        sectionId,
      });
      const teacher = ctx.staffPersons.get(j === 0 ? p.teachers.A : p.teachers.B)!;
      const ta = await assignTeaching(db, departmentId, {
        sectionOfferingId: so.id,
        personId: teacher,
        role: "lecture",
        loadHours: 3,
        from: term.startDate,
      });
      await enrollSectionMembers(db, departmentId, so.id);
      slots.push({
        sectionOfferingId: so.id,
        teachingAssignmentId: ta.id,
        resourceId: i === 0 ? lab.id : room.id,
        weekday: i + 1 + j,
        startTime: `${String(8 + i * 2).padStart(2, "0")}:00`,
        endTime: `${String(10 + i * 2).padStart(2, "0")}:00`,
      });
    }
  }
  if ((await db.classTimetableSlot.count({ where: { termId: term.id } })) === 0) {
    await upsertTimetableSlots(db, departmentId, term.id, slots, { source: "import" });
  }

  // previous year baseline: CS200 in the closed year, taught by instructor1, section CS-Y2-A of that year
  const prevYear = await db.academicYear.findUniqueOrThrow({
    where: { departmentId_code: { departmentId, code: SEED_YEARS.previous.code } },
  });
  const prevTerm = await db.term.findUniqueOrThrow({
    where: { academicYearId_ordinal: { academicYearId: prevYear.id, ordinal: "first" } },
  });
  const prevOffering = await offeringOf({
    courseId: courses.get("CS200")!,
    termId: prevTerm.id,
    coordinatorPersonId: ctx.staffPersons.get("instructor1.cs"),
  });
  let prevSection = await db.section.findUnique({
    where: {
      programId_academicYearId_code: {
        programId: ctx.program.id,
        academicYearId: prevYear.id,
        code: "CS-Y2-A",
      },
    },
  });
  if (!prevSection) {
    const group = await db.group.create({
      data: { departmentId, kind: "section", name: "CS-Y2-A 2025/26" },
    });
    prevSection = await db.section.create({
      data: {
        departmentId,
        programId: ctx.program.id,
        academicYearId: prevYear.id,
        yearLevel: 2,
        code: "CS-Y2-A",
        groupId: group.id,
      },
    });
  }
  const prevSo = await ensureSectionOffering(db, departmentId, {
    courseOfferingId: prevOffering.id,
    sectionId: prevSection.id,
  });
  await assignTeaching(db, departmentId, {
    sectionOfferingId: prevSo.id,
    personId: ctx.staffPersons.get("instructor1.cs")!,
    role: "lecture",
    from: prevTerm.startDate,
  });
  return { courses, term, offerings: plan.map((p) => p.code) };
}

async function ensureResource(
  db: PrismaClient,
  departmentId: string,
  input: Parameters<typeof upsertResource>[2],
) {
  const existing = await db.resource.findUnique({
    where: { departmentId_code: { departmentId, code: input.code } },
  });
  return existing ?? upsertResource(db, departmentId, input);
}
