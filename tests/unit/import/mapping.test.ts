import { describe, expect, it } from "vitest";
import { applyMapping, normaliseHeader, resolveMapping } from "@/platform/import/mapping";
import { kindSpec } from "@/platform/import/templates";

// Working out which column is which. The same roster arrives spelled differently every term, so
// this is where "ID No", "student_number" and "Student Number" have to become one thing.

const roster = kindSpec("roster").columns;

describe("resolving a mapping", () => {
  it("matches headers ignoring case, spaces and punctuation", () => {
    expect(normaliseHeader(" Student No. ")).toBe("studentno");
    const { mappings, missingRequired } = resolveMapping(
      ["ID No", "STUDENT NAME", "e-mail"],
      roster,
    );
    expect(mappings).toMatchObject({
      student_number: "ID No",
      full_name: "STUDENT NAME",
      email: "e-mail",
    });
    expect(missingRequired).toEqual([]);
  });

  it("a saved profile beats every guess, and its own aliases are honoured", () => {
    const headers = ["Number", "Name", "Contact"];
    const guessed = resolveMapping(headers, roster);
    expect(guessed.mappings.student_number).toBeUndefined();

    const withProfile = resolveMapping(headers, roster, {
      mappings: { student_number: "Number" },
      headerAliases: { email: ["Contact"] },
    });
    expect(withProfile.mappings).toMatchObject({
      student_number: "Number",
      full_name: "Name",
      email: "Contact",
    });
    expect(withProfile.missingRequired).toEqual([]);
  });

  it("reports a required column nobody claimed, and the headers nobody wanted", () => {
    const result = resolveMapping(["Full name", "Nickname", "House"], roster);
    expect(result.missingRequired).toEqual(["student_number"]);
    expect(result.unmapped).toEqual(["Nickname", "House"]);
  });
});

describe("applying a mapping", () => {
  it("rekeys the rows to the fields a validator expects and fills the gaps with null", () => {
    const rows = [{ "ID No": "UGR/1/16", "STUDENT NAME": "Abebe Bekele", Extra: "ignored" }];
    const { mappings } = resolveMapping(["ID No", "STUDENT NAME", "Extra"], roster);
    expect(applyMapping(rows, mappings)).toEqual([
      { student_number: "UGR/1/16", full_name: "Abebe Bekele" },
    ]);
  });
});
