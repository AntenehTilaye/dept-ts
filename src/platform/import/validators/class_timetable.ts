import { text } from "../mapping";
import { error, type RowVerdict, type ValidatorContext } from "./registry";

// A timetable says when and where a section is taught. Everything it names has to exist — the
// course offering, the section, the room, the instructor — and the file has to agree with
// itself: two rows that put the same room or the same instructor in two places at once are
// caught here, before the ledger has to refuse them.

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function validateClassTimetable(
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const termId = ctx.context?.subjectType === "term" ? ctx.context.subjectId : null;

  const [offerings, resources, staff] = await Promise.all([
    ctx.tx.sectionOffering.findMany({
      where: termId ? { courseOffering: { termId } } : {},
      select: {
        id: true,
        section: { select: { code: true } },
        courseOffering: { select: { termId: true, course: { select: { code: true } } } },
      },
    }),
    ctx.tx.resource.findMany({ select: { id: true, code: true } }),
    ctx.tx.person.findMany({
      where: { type: "staff" },
      select: { id: true, email: true, fullName: true },
    }),
  ]);

  const offeringByKey = new Map(
    offerings.map((o) => [
      key(o.courseOffering.course.code, o.section.code),
      { id: o.id, termId: o.courseOffering.termId },
    ]),
  );
  const resourceByCode = new Map(resources.map((r) => [r.code.toLowerCase(), r.id]));
  const staffByEmail = new Map(
    staff.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]),
  );
  const staffByName = new Map(staff.map((s) => [s.fullName.toLowerCase(), s.id]));

  // rows are compared with each other, so the parsed shape is worked out first
  const parsed = rows.map((row) => ({
    courseCode: text(row.course_code),
    sectionCode: text(row.section_code),
    weekday: Number(text(row.weekday)),
    startTime: normaliseTime(text(row.start_time)),
    endTime: normaliseTime(text(row.end_time)),
    roomCode: text(row.room_code),
    instructor: text(row.instructor_email),
    weekPattern: (text(row.week_pattern) || "all").toLowerCase(),
  }));

  return parsed.map((row, index) => {
    const verdict: RowVerdict = { errors: [], warnings: [] };

    if (!row.courseCode)
      verdict.errors.push(error("required", "The course is missing", "course_code"));
    if (!row.sectionCode)
      verdict.errors.push(error("required", "The section is missing", "section_code"));
    const offering =
      row.courseCode && row.sectionCode
        ? offeringByKey.get(key(row.courseCode, row.sectionCode))
        : undefined;
    if (row.courseCode && row.sectionCode && !offering)
      verdict.errors.push(
        error("unknown", `${row.courseCode} is not offered to ${row.sectionCode} this term`, "course_code"),
      );

    if (!Number.isInteger(row.weekday) || row.weekday < 1 || row.weekday > 7)
      verdict.errors.push(error("range", "The weekday is 1 (Monday) to 7 (Sunday)", "weekday"));
    if (!TIME.test(row.startTime))
      verdict.errors.push(error("format", `"${row.startTime}" is not a time (HH:MM)`, "start_time"));
    if (!TIME.test(row.endTime))
      verdict.errors.push(error("format", `"${row.endTime}" is not a time (HH:MM)`, "end_time"));
    if (TIME.test(row.startTime) && TIME.test(row.endTime) && row.endTime <= row.startTime)
      verdict.errors.push(error("range", "The slot ends before it starts", "end_time"));
    if (!["all", "odd", "even"].includes(row.weekPattern))
      verdict.errors.push(
        error("range", `"${row.weekPattern}" is not all, odd or even`, "week_pattern"),
      );

    const resourceId = row.roomCode ? resourceByCode.get(row.roomCode.toLowerCase()) : null;
    if (row.roomCode && !resourceId)
      verdict.errors.push(error("unknown", `No room has the code ${row.roomCode}`, "room_code"));

    const personId = row.instructor
      ? (staffByEmail.get(row.instructor.toLowerCase()) ??
        staffByName.get(row.instructor.toLowerCase()) ??
        null)
      : null;
    if (row.instructor && !personId)
      verdict.errors.push(
        error("unknown", `No member of staff matches "${row.instructor}"`, "instructor_email"),
      );

    // the file against itself: the same room or the same person in two places at once
    for (const [otherIndex, other] of parsed.entries()) {
      if (otherIndex >= index) continue;
      if (other.weekday !== row.weekday) continue;
      if (!overlapping(row, other)) continue;
      const sameRoom = row.roomCode && other.roomCode && sameCode(row.roomCode, other.roomCode);
      const samePerson =
        row.instructor && other.instructor && sameCode(row.instructor, other.instructor);
      if (sameRoom)
        verdict.errors.push(
          error("overlap", `Row ${otherIndex + 1} already books ${row.roomCode} then`, "room_code"),
        );
      if (samePerson)
        verdict.errors.push(
          error("overlap", `Row ${otherIndex + 1} already books ${row.instructor} then`, "instructor_email"),
        );
    }

    if (!verdict.errors.length && offering) {
      verdict.normalized = {
        section_offering_id: offering.id,
        term_id: offering.termId,
        weekday: row.weekday,
        start_time: row.startTime,
        end_time: row.endTime,
        resource_id: resourceId,
        person_id: personId,
        week_pattern: row.weekPattern,
      };
    }
    return verdict;
  });
}

function key(courseCode: string, sectionCode: string): string {
  return `${courseCode.toLowerCase()}|${sectionCode.toLowerCase()}`;
}

function sameCode(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function overlapping(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

/** "9:00" and "09:00" are the same time; anything else is left alone for the format check. */
function normaliseTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : value;
}
