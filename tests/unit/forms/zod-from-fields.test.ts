import { describe, expect, it } from "vitest";
import type { FieldDef } from "@/platform/forms/field-schema";
import { isVisible, zodFromFields } from "@/platform/forms/zod-from-fields";

const req = { required: true } as const;

function field(over: Partial<FieldDef> & Pick<FieldDef, "key" | "type" | "label">): FieldDef {
  return { sourceBinding: "none", aggregation: "none", ...over };
}

describe("zodFromFields", () => {
  it("applies required, min/max and a regex to text and numbers", () => {
    const schema = zodFromFields([
      field({ key: "name", type: "short_text", label: "Name", constraints: req }),
      field({
        key: "code",
        type: "short_text",
        label: "Code",
        constraints: { required: true, regex: "[A-Z]{2}[0-9]{3}" },
      }),
      field({
        key: "score",
        type: "number",
        label: "Score",
        constraints: { required: true, min: 0, max: 10 },
      }),
    ]);
    expect(schema.safeParse({ name: "A", code: "CS201", score: 7 }).success).toBe(true);
    expect(schema.safeParse({ name: "", code: "CS201", score: 7 }).success).toBe(false);
    expect(schema.safeParse({ name: "A", code: "cs201", score: 7 }).success).toBe(false);
    expect(schema.safeParse({ name: "A", code: "XCS201", score: 7 }).success).toBe(false);
    expect(schema.safeParse({ name: "A", code: "CS201", score: 11 }).success).toBe(false);
    // numbers arrive as strings from a form post
    expect(schema.parse({ name: "A", code: "CS201", score: "7" }).score).toBe(7);
  });

  it("validates likert and scale as bounded numbers and choices against their options", () => {
    const schema = zodFromFields([
      field({
        key: "q1",
        type: "likert",
        label: "Clarity",
        constraints: { required: true, min: 1, max: 5 },
      }),
      field({
        key: "mode",
        type: "single_choice",
        label: "Mode",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        constraints: req,
      }),
      field({
        key: "topics",
        type: "multi_choice",
        label: "Topics",
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ],
        constraints: { required: false, maxItems: 1 },
      }),
    ]);
    expect(schema.safeParse({ q1: 5, mode: "a", topics: ["x"] }).success).toBe(true);
    expect(schema.safeParse({ q1: 6, mode: "a" }).success).toBe(false);
    expect(schema.safeParse({ q1: 3, mode: "c" }).success).toBe(false);
    expect(schema.safeParse({ q1: 3, mode: "a", topics: ["x", "y"] }).success).toBe(false);
    expect(schema.parse({ q1: 3, mode: "a" }).topics).toEqual([]);
  });

  it("enforces ranked-list uniqueness and maxRank", () => {
    const schema = zodFromFields([
      field({
        key: "prefs",
        type: "ranked_list",
        label: "Preferences",
        constraints: { required: true, maxRank: 3 },
      }),
    ]);
    expect(schema.safeParse({ prefs: { order: ["a", "b", "c"] } }).success).toBe(true);
    expect(schema.safeParse({ prefs: { order: ["a", "a"] } }).success).toBe(false);
    expect(schema.safeParse({ prefs: { order: ["a", "b", "c", "d"] } }).success).toBe(false);
    expect(schema.safeParse({ prefs: { order: [] } }).success).toBe(false);
  });

  it("validates repeating groups as arrays of their sub-fields", () => {
    const schema = zodFromFields([
      field({
        key: "publications",
        type: "repeating_group",
        label: "Publications",
        constraints: { required: false, minItems: 0, maxItems: 2 },
        fields: [
          field({ key: "title", type: "short_text", label: "Title", constraints: req }),
          field({ key: "year", type: "number", label: "Year", constraints: { required: false } }),
        ],
      }),
    ]);
    expect(schema.safeParse({ publications: [{ title: "A", year: 2026 }] }).success).toBe(true);
    expect(schema.safeParse({ publications: [{ year: 2026 }] }).success).toBe(false);
    expect(
      schema.safeParse({ publications: [{ title: "A" }, { title: "B" }, { title: "C" }] }).success,
    ).toBe(false);
    expect(schema.parse({}).publications).toEqual([]);
  });

  it("accepts a file list within maxFiles and a picker id", () => {
    const schema = zodFromFields([
      field({
        key: "evidence",
        type: "file",
        label: "Evidence",
        constraints: { required: true, maxFiles: 2, accept: ["pdf"] },
      }),
      field({ key: "who", type: "person_picker", label: "Who", constraints: req }),
    ]);
    expect(schema.safeParse({ evidence: ["doc1"], who: "p1" }).success).toBe(true);
    expect(schema.safeParse({ evidence: [], who: "p1" }).success).toBe(false);
    expect(schema.safeParse({ evidence: ["a", "b", "c"], who: "p1" }).success).toBe(false);
    expect(schema.safeParse({ evidence: ["a"], who: "" }).success).toBe(false);
  });

  it("requires a conditional field only when its condition holds", () => {
    const fields = [
      field({
        key: "declined",
        type: "boolean",
        label: "Declining?",
        constraints: { required: true },
      }),
      field({
        key: "reason",
        type: "long_text",
        label: "Reason",
        constraints: { required: true, visibleIf: { field: "declined", equals: [true] } },
      }),
    ];
    const schema = zodFromFields(fields);
    expect(schema.safeParse({ declined: false }).success).toBe(true);
    expect(schema.safeParse({ declined: true }).success).toBe(false);
    expect(schema.safeParse({ declined: true, reason: "on leave" }).success).toBe(true);
    expect(isVisible(fields[1]!, { declined: true })).toBe(true);
    expect(isVisible(fields[1]!, { declined: false })).toBe(false);
    expect(isVisible(fields[0]!, {})).toBe(true);
  });

  it("ignores section headers", () => {
    const schema = zodFromFields([
      field({ key: "part_a", type: "section_header", label: "Part A" }),
      field({ key: "note", type: "long_text", label: "Note" }),
    ]);
    const parsed = schema.parse({ note: "hi" });
    expect(parsed).toMatchObject({ note: "hi" });
    expect("part_a" in parsed).toBe(false);
  });
});
