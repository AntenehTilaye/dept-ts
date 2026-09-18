import type { Db } from "../../lib/db/types";
import { isRegistered, variables as subjectVariables } from "../subject-registry";

// Variables for a render: subject (registry) > person > department > calendar on collisions.

export interface VariableSources {
  subject?: Record<string, unknown>;
  person?: Record<string, unknown>;
  department?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** Pure merge with the documented precedence (extra is the caller's explicit override, highest). */
export function mergeVariables(sources: VariableSources): Record<string, unknown> {
  return {
    ...(sources.calendar ?? {}),
    ...(sources.department ?? {}),
    ...(sources.person ?? {}),
    ...(sources.subject ?? {}),
    ...(sources.extra ?? {}),
  };
}

export interface VariablesForInput {
  subject?: { subjectType: string; subjectId: string } | null;
  personId?: string | null;
  departmentId: string;
  extra?: Record<string, unknown>;
}

export async function variablesFor(
  db: Db,
  input: VariablesForInput,
): Promise<Record<string, unknown>> {
  const [subject, person, department, term] = await Promise.all([
    input.subject && isRegistered(input.subject.subjectType)
      ? subjectVariables(db, input.subject)
      : Promise.resolve({}),
    input.personId
      ? db.person.findUnique({
          where: { id: input.personId },
          select: { fullName: true, email: true },
        })
      : Promise.resolve(null),
    db.department.findUnique({
      where: { id: input.departmentId },
      select: { name: true, code: true, facultyName: true },
    }),
    db.term.findFirst({
      where: { departmentId: input.departmentId, status: "current" },
      include: { academicYear: { select: { code: true } } },
    }),
  ]);
  return mergeVariables({
    subject,
    person: person
      ? {
          recipient_name: person.fullName,
          recipient_email: person.email ?? "",
          person_name: person.fullName,
        }
      : {},
    department: department
      ? {
          department_name: department.name,
          department_code: department.code,
          faculty_name: department.facultyName ?? "",
        }
      : {},
    calendar: term
      ? {
          term_name: term.name,
          academic_year: term.academicYear.code,
          today: new Date().toISOString().slice(0, 10),
        }
      : { today: new Date().toISOString().slice(0, 10) },
    extra: input.extra,
  });
}
