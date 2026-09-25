import { text } from "../mapping";
import { error, type RowVerdict, type ValidatorContext } from "./registry";

// A roster says who is in a section. The student number is the identity — a name that disagrees
// with the record we already hold is worth a warning, never a refusal, because people's names
// are recorded differently in different systems and the number is the fact.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validateRoster(
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const numbers = rows.map((r) => text(r.student_number));
  const seen = new Map<string, number>();
  for (const number of numbers) if (number) seen.set(number, (seen.get(number) ?? 0) + 1);

  const [programs, sections, students] = await Promise.all([
    ctx.tx.program.findMany({ select: { id: true, code: true } }),
    ctx.tx.section.findMany({ select: { id: true, code: true, yearLevel: true } }),
    ctx.tx.student.findMany({
      where: { studentNumber: { in: numbers.filter(Boolean) } },
      select: { studentNumber: true, person: { select: { fullName: true } } },
    }),
  ]);
  const programByCode = new Map(programs.map((p) => [p.code.toLowerCase(), p]));
  const sectionByCode = new Map(sections.map((s) => [s.code.toLowerCase(), s]));
  const knownName = new Map(students.map((s) => [s.studentNumber, s.person?.fullName ?? ""]));

  return rows.map((row) => {
    const verdict: RowVerdict = { errors: [], warnings: [] };
    const studentNumber = text(row.student_number);
    const fullName = text(row.full_name);
    const email = text(row.email);
    const programCode = text(row.program_code);
    const sectionCode = text(row.section_code);

    if (!studentNumber)
      verdict.errors.push(error("required", "The student number is missing", "student_number"));
    else if ((seen.get(studentNumber) ?? 0) > 1)
      verdict.errors.push(
        error("duplicate", `The student number ${studentNumber} appears more than once in this file`, "student_number"),
      );
    if (!fullName) verdict.errors.push(error("required", "The full name is missing", "full_name"));
    if (email && !EMAIL.test(email))
      verdict.errors.push(error("format", `"${email}" is not an email address`, "email"));

    const program = programCode ? programByCode.get(programCode.toLowerCase()) : undefined;
    if (programCode && !program)
      verdict.errors.push(error("unknown", `No programme has the code ${programCode}`, "program_code"));

    const section = sectionCode ? sectionByCode.get(sectionCode.toLowerCase()) : undefined;
    if (sectionCode && !section)
      verdict.errors.push(error("unknown", `No section has the code ${sectionCode}`, "section_code"));

    const existing = knownName.get(studentNumber);
    if (existing && fullName && !sameName(existing, fullName))
      verdict.warnings.push({
        code: "name_mismatch",
        field: "full_name",
        message: `${studentNumber} is recorded as "${existing}"`,
      });

    if (!verdict.errors.length) {
      verdict.normalized = {
        student_number: studentNumber,
        full_name: fullName,
        email: email || null,
        program_id: program?.id ?? null,
        section_id: section?.id ?? null,
        year_level: Number(text(row.year_level)) || section?.yearLevel || null,
      };
    }
    return verdict;
  });
}

/** Names match when their words do, whatever their order, case or spacing. */
function sameName(a: string, b: string): boolean {
  const words = (name: string) =>
    name
      .toLowerCase()
      .split(/[^a-zሀ-፿]+/i)
      .filter(Boolean)
      .sort()
      .join(" ");
  return words(a) === words(b);
}
