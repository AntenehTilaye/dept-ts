import type { ColumnSpec } from "@/platform/import";
import { registerKindSpec } from "@/platform/import";
import { componentsOfSection } from "./service";

// What each of the three sheets is supposed to contain. A mark sheet is the interesting one: its
// columns are the section's own assessment components, so they are not known until the section is —
// which is what `contextColumns` is for. The template somebody downloads therefore already has the
// right columns, and a file that comes back is mapped against the same list.

const STUDENT_COLUMNS: ColumnSpec[] = [
  {
    field: "student_number",
    label: "Student number",
    required: true,
    aliases: ["id no", "student id", "studentno", "reg no", "registration number"],
    example: "UGR/1234/16",
  },
  {
    field: "full_name",
    label: "Full name",
    aliases: ["name", "student name"],
    example: "Abebe Bekele",
  },
];

export function registerAssessmentKinds(): void {
  registerKindSpec({
    kind: "assessment",
    label: "Marks",
    contextType: "section_offering",
    guidance:
      "One row per student, one column per component. Leave a cell empty for a student who did not sit that component — an empty cell is not a zero.",
    columns: [
      ...STUDENT_COLUMNS,
      {
        field: "total",
        label: "Total",
        aliases: ["sum", "grand total"],
        hint: "Optional. When present it is checked against the components.",
      },
    ],
    contextColumns: async (db, context) => {
      if (context?.subjectType !== "section_offering") return [];
      const components = await componentsOfSection(db, context.subjectId);
      return components.map((component) => ({
        field: `component:${component.key}`,
        label: `${component.name} (${component.maxMark})`,
        aliases: [component.key, component.name],
        example: String(Math.round(Number(component.maxMark) * 0.7)),
      }));
    },
  });

  registerKindSpec({
    kind: "attendance",
    label: "Attendance",
    contextType: "section_offering",
    guidance:
      "One row per student: how many sessions were held for them and how many they attended. Attending more than were held is refused.",
    columns: [
      ...STUDENT_COLUMNS,
      {
        field: "sessions_held",
        label: "Sessions held",
        required: true,
        aliases: ["held", "total sessions"],
        example: "28",
      },
      {
        field: "sessions_attended",
        label: "Sessions attended",
        required: true,
        aliases: ["attended", "present"],
        example: "25",
      },
    ],
  });

  registerKindSpec({
    kind: "students",
    label: "Students",
    contextType: "term",
    guidance:
      "One row per student of an intake. The student number identifies them; a name that disagrees with a record we hold is a warning, not a refusal.",
    columns: [
      { ...STUDENT_COLUMNS[0]! },
      { ...STUDENT_COLUMNS[1]!, required: true },
      { field: "email", label: "Email", aliases: ["e-mail"], example: "abebe@student.local" },
      {
        field: "program_code",
        label: "Programme",
        required: true,
        aliases: ["program", "programme code"],
        example: "BSC-CS",
      },
      {
        field: "admission_year",
        label: "Admission year",
        required: true,
        aliases: ["intake", "year of admission"],
        example: "2024",
      },
    ],
  });
}
