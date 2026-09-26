import type { PrismaClient } from "../../../src/generated/prisma/client";
import { createGroup } from "../../../src/platform/people/groups";
import { ensurePerson, attachToDepartment } from "../../../src/platform/people/persons";
import { upsertStaffProfile, upsertProfileItem } from "../../../src/platform/people/staff";
import { upsertStudent, setSectionMembership } from "../../../src/platform/people/students";
import { upsertProgram } from "../../../src/platform/academic/courses";
import { SEED_USERS } from "../users";
import { SEED_YEARS } from "../calendar";

// Demo people for CS: staff linked to the seeded users, a programme, sections of the current
// year with 20 students, and one committee group with a chair. Idempotent by email/code.
export const DEMO = {
  program: {
    code: "BSC-CS",
    name: "BSc in Computer Science",
    degreeLevel: "BSc",
    durationYears: 4,
  },
  sections: ["CS-Y2-A", "CS-Y2-B"],
  committeeName: "Curriculum Committee",
} as const;

export async function seedDemoPeople(db: PrismaClient) {
  const departmentId = "dep_cs";
  const users = await db.user.findMany({
    where: { email: { in: SEED_USERS.map((u) => u.email) } },
  });
  const userByEmail = new Map(users.map((u) => [u.email, u]));

  // staff: every seeded CS user except admin and the student rep
  const staffKeys = [
    "dh.cs",
    "dpt.cs",
    "instructor1.cs",
    "instructor2.cs",
    "instructor3.cs",
    "chair.cs",
  ];
  const staffPersons = new Map<string, string>();
  for (const [i, key] of staffKeys.entries()) {
    const su = SEED_USERS.find((u) => u.key === key)!;
    const user = userByEmail.get(su.email);
    const person = await ensurePerson(db, {
      fullName: su.name,
      email: su.email,
      type: "staff",
      userId: user?.id ?? null,
    });
    if (user && person.userId !== user.id)
      await db.person.update({ where: { id: person.id }, data: { userId: user.id } });
    await upsertStaffProfile(db, departmentId, person.id, {
      staffId: `CS-${String(i + 1).padStart(3, "0")}`,
      academicRank: i === 0 ? "Professor" : i === 1 ? "Associate Professor" : "Lecturer",
      employmentType: "full_time",
      specialization: ["Software Engineering", "Networks", "AI", "Databases", "HCI", "Security"][i],
      academicInterests: ["teaching", "research"],
      officeLocation: `Block B, Room ${200 + i}`,
      officeHoursText: "Tue/Thu 14:00-16:00",
      joinedAt: new Date("2020-09-01T00:00:00Z"),
    });
    staffPersons.set(key, person.id);
  }
  const first = staffPersons.get("instructor1.cs")!;
  if ((await db.profileItem.count({ where: { personId: first } })) === 0) {
    await upsertProfileItem(db, departmentId, first, {
      kind: "qualification",
      title: "MSc Computer Science",
      institutionOrVenue: "AAU",
      dateTo: new Date("2018-07-01T00:00:00Z"),
    });
    await upsertProfileItem(db, departmentId, first, {
      kind: "publication",
      title: "A study of adaptive timetabling",
      institutionOrVenue: "ICSE Workshops",
      dateFrom: new Date("2024-05-01T00:00:00Z"),
    });
  }

  // EE head as a person in EE
  const dhEe = SEED_USERS.find((u) => u.key === "dh.ee")!;
  const eePerson = await ensurePerson(db, {
    fullName: dhEe.name,
    email: dhEe.email,
    type: "staff",
    userId: userByEmail.get(dhEe.email)?.id ?? null,
  });
  await upsertStaffProfile(db, "dep_ee", eePerson.id, {
    staffId: "EE-001",
    academicRank: "Professor",
  });

  // programme, sections, students
  let program = await db.program.findUnique({
    where: { departmentId_code: { departmentId, code: DEMO.program.code } },
  });
  if (!program) program = await upsertProgram(db, departmentId, DEMO.program);
  const year = await db.academicYear.findUniqueOrThrow({
    where: { departmentId_code: { departmentId, code: SEED_YEARS.current.code } },
  });
  const sections: string[] = [];
  for (const code of DEMO.sections) {
    let section = await db.section.findUnique({
      where: {
        programId_academicYearId_code: { programId: program.id, academicYearId: year.id, code },
      },
    });
    if (!section) {
      const group = await createGroup(db, departmentId, { kind: "section", name: code });
      section = await db.section.create({
        data: {
          departmentId,
          programId: program.id,
          academicYearId: year.id,
          yearLevel: 2,
          code,
          capacity: 40,
          groupId: group.id,
        },
      });
      await db.group.update({
        where: { id: group.id },
        data: { contextType: "section", contextId: section.id },
      });
    }
    sections.push(section.id);
  }
  const rep = SEED_USERS.find((u) => u.key === "rep.cs")!;
  for (let i = 1; i <= 20; i++) {
    const isRep = i === 1;
    const email = isRep ? rep.email : `student${String(i).padStart(2, "0")}.cs@deptts.local`;
    const person = await ensurePerson(db, {
      fullName: isRep ? rep.name : `Student ${String(i).padStart(2, "0")}`,
      email,
      type: "student",
      userId: isRep ? (userByEmail.get(rep.email)?.id ?? null) : null,
    });
    await upsertStudent(db, departmentId, person.id, {
      studentNumber: `CS/${2000 + i}/24`,
      programId: program.id,
      admissionYear: 2024,
    });
    await setSectionMembership(db, departmentId, {
      studentId: person.id,
      sectionId: sections[(i - 1) % 2]!,
      academicYearId: year.id,
      from: year.startDate,
      source: "import",
    });
  }

  // the committees themselves are created by demo/committees.ts, through the `committee`
  // feature: a committee group with no committee behind it is not a thing this platform has
  for (const id of staffPersons.values()) await attachToDepartment(db, departmentId, id);
  return { program, sections, staffPersons };
}
