import { error, text, type RowIssue, type RowVerdict, type ValidatorContext } from "@/platform/import";
import { componentsOfSection } from "./service";

// What "wrong" means for a sheet of marks. Every rule here answers a question somebody actually
// asks of a mark sheet — is this a student of mine, did anybody appear twice, is that a number, is
// it within the maximum, is the whole class here — and each answer carries a code, so the preview
// can say which line is wrong and why without the reader guessing.

const NAME_SPLIT = /[^a-z]+/;

/** A name that disagrees with the record we hold is a warning: the number is the identity. */
function sameName(a: string, b: string): boolean {
  const parts = (value: string) =>
    new Set(value.toLowerCase().split(NAME_SPLIT).filter((p) => p.length > 1));
  const left = parts(a);
  const right = parts(b);
  if (!left.size || !right.size) return true;
  let shared = 0;
  for (const part of left) if (right.has(part)) shared += 1;
  return shared >= Math.min(left.size, right.size);
}

function numberOf(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The students the section is supposed to be reporting on. */
async function rosterOf(ctx: ValidatorContext): Promise<
  Map<string, { studentId: string; fullName: string }>
> {
  const sectionOfferingId = ctx.context?.subjectId ?? null;
  if (!sectionOfferingId || ctx.context?.subjectType !== "section_offering") return new Map();
  const rows = await ctx.tx.enrollment.findMany({
    where: { sectionOfferingId, status: { in: ["enrolled", "added"] } },
    include: { student: { include: { person: { select: { fullName: true } } } } },
  });
  return new Map(
    rows.map((row) => [
      row.student.studentNumber,
      { studentId: row.studentId, fullName: row.student.person?.fullName ?? "" },
    ]),
  );
}

/**
 * A sheet of marks: one row per student, one column per component of the section's scheme.
 * The columns are not known until the scheme is, which is why the mapping is resolved against
 * `columnsFor` and the normalised row carries `marks` keyed by component.
 */
export async function validateAssessment(
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const components = await componentsOfSection(ctx.tx, ctx.context?.subjectId ?? "");
  const roster = await rosterOf(ctx);

  const seen = new Map<string, number>();
  for (const row of rows) {
    const number = text(row.student_number);
    if (number) seen.set(number, (seen.get(number) ?? 0) + 1);
  }
  const present = new Set<string>();

  const verdicts = rows.map((row): RowVerdict => {
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const studentNumber = text(row.student_number);
    const fullName = text(row.full_name);

    if (!studentNumber)
      errors.push(error("UNKNOWN_STUDENT", "The student number is missing", "student_number"));
    else if ((seen.get(studentNumber) ?? 0) > 1)
      errors.push(
        error(
          "DUPLICATE_STUDENT",
          `${studentNumber} appears more than once in this file`,
          "student_number",
        ),
      );

    const enrolled = studentNumber ? roster.get(studentNumber) : undefined;
    if (studentNumber && roster.size && !enrolled)
      errors.push(
        error(
          "UNKNOWN_STUDENT",
          `${studentNumber} is not enrolled in this section`,
          "student_number",
        ),
      );
    if (enrolled) present.add(studentNumber);
    if (enrolled && fullName && !sameName(enrolled.fullName, fullName))
      warnings.push({
        code: "NAME_MISMATCH",
        field: "full_name",
        message: `The roster has "${enrolled.fullName}" for ${studentNumber}`,
      });

    const marks: Record<string, number | null> = {};
    for (const component of components) {
      const field = `component:${component.key}`;
      const raw = text(row[field]);
      if (!raw) {
        // an empty cell is "did not sit it", which is a fact the committer stores; the final is
        // the one component whose absence is worth saying out loud
        marks[component.key] = null;
        if (component.isFinal)
          warnings.push({
            code: "MISSING_COMPONENT",
            field,
            message: `No mark for ${component.name}`,
          });
        continue;
      }
      const value = numberOf(raw);
      if (value === null) {
        errors.push(error("NON_NUMERIC", `"${raw}" is not a mark`, field));
        continue;
      }
      if (value < 0 || value > component.maxMark)
        errors.push(
          error("OUT_OF_RANGE", `${value} is outside 0–${component.maxMark}`, field),
        );
      marks[component.key] = value;
    }

    if (!components.length)
      errors.push(
        error("MISSING_COMPONENT", "This section has no assessment scheme yet", "student_number"),
      );

    const declaredTotal = numberOf(row.total);
    if (declaredTotal !== null) {
      const summed = Object.values(marks).reduce<number>((sum, m) => sum + (m ?? 0), 0);
      if (Math.abs(summed - declaredTotal) > 0.5)
        errors.push(
          error(
            "TOTAL_MISMATCH",
            `The row totals ${summed} but says ${declaredTotal}`,
            "total",
          ),
        );
    }

    return {
      errors,
      warnings,
      ...(errors.length
        ? {}
        : {
            normalized: {
              student_number: studentNumber,
              student_id: enrolled?.studentId ?? null,
              marks,
            },
          }),
    };
  });

  // a student on the roster whose row never arrived is a problem with the file as a whole; it is
  // reported on the first row so the reader sees it where they are already looking
  const absent = Array.from(roster.keys()).filter((number) => !present.has(number));
  if (absent.length && verdicts[0])
    verdicts[0].warnings.push({
      code: "ROSTER_STUDENT_MISSING",
      message: `${absent.length} student(s) on the roster have no row: ${absent.slice(0, 5).join(", ")}${
        absent.length > 5 ? "…" : ""
      }`,
    });

  return verdicts;
}

/** How many sessions each student attended out of how many were held. */
export async function validateAttendance(
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const roster = await rosterOf(ctx);
  const seen = new Map<string, number>();
  for (const row of rows) {
    const number = text(row.student_number);
    if (number) seen.set(number, (seen.get(number) ?? 0) + 1);
  }

  return rows.map((row): RowVerdict => {
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const studentNumber = text(row.student_number);
    const held = numberOf(row.sessions_held);
    const attended = numberOf(row.sessions_attended);

    if (!studentNumber)
      errors.push(error("UNKNOWN_STUDENT", "The student number is missing", "student_number"));
    else if ((seen.get(studentNumber) ?? 0) > 1)
      errors.push(
        error("DUPLICATE_STUDENT", `${studentNumber} appears more than once`, "student_number"),
      );

    const enrolled = studentNumber ? roster.get(studentNumber) : undefined;
    if (studentNumber && roster.size && !enrolled)
      errors.push(
        error("UNKNOWN_STUDENT", `${studentNumber} is not enrolled in this section`, "student_number"),
      );

    if (held === null)
      errors.push(error("NON_NUMERIC", "Sessions held is missing", "sessions_held"));
    if (attended === null)
      errors.push(error("NON_NUMERIC", "Sessions attended is missing", "sessions_attended"));
    if (held !== null && attended !== null) {
      if (held < 0 || attended < 0)
        errors.push(error("OUT_OF_RANGE", "A count cannot be negative", "sessions_attended"));
      else if (attended > held)
        errors.push(
          error(
            "ATTENDANCE_OVER_HELD",
            `${attended} sessions attended of ${held} held`,
            "sessions_attended",
          ),
        );
    }

    return {
      errors,
      warnings,
      ...(errors.length
        ? {}
        : {
            normalized: {
              student_number: studentNumber,
              student_id: enrolled?.studentId ?? null,
              sessions_held: held,
              sessions_attended: attended,
            },
          }),
    };
  });
}

/** New students of a programme, by student number — the intake list a registrar sends. */
export async function validateStudents(
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const numbers = rows.map((r) => text(r.student_number)).filter(Boolean);
  const [programs, existing] = await Promise.all([
    ctx.tx.program.findMany({ select: { id: true, code: true } }),
    ctx.tx.student.findMany({
      where: { studentNumber: { in: numbers } },
      select: { studentNumber: true, person: { select: { fullName: true } } },
    }),
  ]);
  const programByCode = new Map(programs.map((p) => [p.code.toLowerCase(), p]));
  const known = new Map(existing.map((s) => [s.studentNumber, s.person?.fullName ?? ""]));

  const seen = new Map<string, number>();
  for (const number of numbers) seen.set(number, (seen.get(number) ?? 0) + 1);

  return rows.map((row): RowVerdict => {
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const studentNumber = text(row.student_number);
    const fullName = text(row.full_name);
    const programCode = text(row.program_code);
    const admissionYear = numberOf(row.admission_year);

    if (!studentNumber)
      errors.push(error("UNKNOWN_STUDENT", "The student number is missing", "student_number"));
    else if ((seen.get(studentNumber) ?? 0) > 1)
      errors.push(
        error("DUPLICATE_STUDENT", `${studentNumber} appears more than once`, "student_number"),
      );
    if (!fullName) errors.push(error("NON_NUMERIC", "The full name is missing", "full_name"));

    const program = programCode ? programByCode.get(programCode.toLowerCase()) : undefined;
    if (!program)
      errors.push(
        error("MISSING_COMPONENT", `No programme has the code "${programCode}"`, "program_code"),
      );
    if (admissionYear === null || admissionYear < 1990 || admissionYear > 2100)
      errors.push(error("OUT_OF_RANGE", "The admission year is not a year", "admission_year"));

    const already = known.get(studentNumber);
    if (already && fullName && !sameName(already, fullName))
      warnings.push({
        code: "NAME_MISMATCH",
        field: "full_name",
        message: `We already hold "${already}" for ${studentNumber}`,
      });

    return {
      errors,
      warnings,
      ...(errors.length
        ? {}
        : {
            normalized: {
              student_number: studentNumber,
              full_name: fullName,
              email: text(row.email) || null,
              program_id: program!.id,
              admission_year: admissionYear,
            },
          }),
    };
  });
}
