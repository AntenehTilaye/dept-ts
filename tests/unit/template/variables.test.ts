import { describe, expect, it } from "vitest";
import { mergeVariables } from "@/platform/template/variables";

describe("variable precedence", () => {
  it("subject beats person beats department beats calendar; extra beats all", () => {
    const merged = mergeVariables({
      calendar: { name: "calendar", term_name: "Sem I" },
      department: { name: "department", department_name: "CS" },
      person: { name: "person", recipient_name: "Ann" },
      subject: { name: "subject", course_code: "CS201" },
      extra: { course_code: "OVERRIDE" },
    });
    expect(merged).toEqual({
      name: "subject",
      term_name: "Sem I",
      department_name: "CS",
      recipient_name: "Ann",
      course_code: "OVERRIDE",
    });
    expect(mergeVariables({})).toEqual({});
  });
});
