import { describe, expect, it } from "vitest";
import { kindSpec, resolveMapping } from "@/platform/import";
import { registerAssessmentKinds } from "@/modules/assessment/templates";

// A mark sheet arrives spelled the way the marker's own workbook spells it. The columns of the kind
// are what a header is matched against, and a profile somebody saved is a deliberate answer that
// beats every guess — which is the whole point of saving one.

registerAssessmentKinds();

const columnsOf = (kind: string) => kindSpec(kind).columns;

describe("working out which column is which", () => {
  it("finds the student number however the office spelled it", () => {
    for (const header of ["Student number", "ID No.", "Reg No", "student_id", "STUDENTNO"]) {
      const result = resolveMapping([header, "Full name"], columnsOf("assessment"));
      expect(result.mappings.student_number, header).toBe(header);
      expect(result.missingRequired).toEqual([]);
    }
  });

  it("matches a component column by the component's own key or its name", () => {
    const componentColumns = [
      { field: "component:quiz", label: "Quiz (10)", aliases: ["quiz", "Quiz"] },
      { field: "component:mid", label: "Mid-semester (30)", aliases: ["mid", "Mid-semester"] },
      { field: "component:final", label: "Final (60)", aliases: ["final", "Final"] },
    ];
    const result = resolveMapping(
      ["ID No.", "Student Name", "Quiz", "Mid", "Final"],
      [...columnsOf("assessment"), ...componentColumns],
    );
    expect(result.mappings["component:quiz"]).toBe("Quiz");
    expect(result.mappings["component:mid"]).toBe("Mid");
    expect(result.mappings["component:final"]).toBe("Final");
    expect(result.unmapped).toEqual([]);
  });

  it("lets a saved profile beat the guess when two headers could both fit", () => {
    const headers = ["Mark", "Marks"];
    const columns = [
      { field: "component:quiz", label: "Quiz", aliases: ["mark", "marks"] },
    ];
    const guessed = resolveMapping(headers, columns);
    expect(guessed.mappings["component:quiz"]).toBe("Mark");

    const withProfile = resolveMapping(headers, columns, {
      mappings: { "component:quiz": "Marks" },
    });
    expect(withProfile.mappings["component:quiz"]).toBe("Marks");
  });

  it("says which required column is missing rather than guessing at it", () => {
    const result = resolveMapping(["Full name", "Quiz"], columnsOf("attendance"));
    expect(result.missingRequired.sort()).toEqual([
      "sessions_attended",
      "sessions_held",
      "student_number",
    ]);
  });

  it("reports a header nothing claimed, so somebody can map it or ignore it", () => {
    const result = resolveMapping(
      ["Student number", "Full name", "Remarks"],
      columnsOf("assessment"),
    );
    expect(result.unmapped).toEqual(["Remarks"]);
  });

  it("knows what each of the three kinds is about", () => {
    expect(kindSpec("assessment").contextType).toBe("section_offering");
    expect(kindSpec("attendance").contextType).toBe("section_offering");
    expect(kindSpec("students").contextType).toBe("term");
    // the mark columns are not fixed: they are the section's own components
    expect(kindSpec("assessment").contextColumns).toBeTypeOf("function");
    expect(kindSpec("attendance").contextColumns).toBeUndefined();
  });
});
