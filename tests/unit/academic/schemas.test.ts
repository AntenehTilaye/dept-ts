import { describe, expect, it } from "vitest";
import {
  academicYearSchema,
  courseSchema,
  periodSchema,
  programSchema,
  resourceSchema,
  sectionSchema,
  teachingSchema,
  termSchema,
  offeringSchema,
} from "@/platform/academic/schemas";
import { AudienceSpecSchema } from "@/platform/people/audience";
import { formToObject } from "@/lib/actions/form";
import { fromJson, toJson } from "@/lib/db/json";

describe("academic input schemas", () => {
  it("coerce form strings into dates and numbers", () => {
    expect(
      academicYearSchema.parse({ code: "2026/27", startDate: "2026-09-14", endDate: "2027-07-14" })
        .startDate,
    ).toBeInstanceOf(Date);
    expect(
      academicYearSchema.safeParse({ code: "2026", startDate: "2026-09-14", endDate: "2027-07-14" })
        .success,
    ).toBe(false);
    expect(
      termSchema.parse({
        academicYearId: "y",
        ordinal: "summer",
        name: "S",
        startDate: "2027-06-01",
        endDate: "2027-07-01",
      }).ordinal,
    ).toBe("summer");
    expect(
      periodSchema
        .parse({
          termId: "t",
          kind: "add_drop",
          label: "x",
          startAt: "2026-09-14T08:00",
          endAt: "2026-09-28T17:00",
        })
        .endAt.getTime(),
    ).toBeGreaterThan(0);
    expect(
      programSchema.parse({ code: "BSC", name: "Name", degreeLevel: "BSc", durationYears: "4" })
        .durationYears,
    ).toBe(4);
    expect(
      courseSchema.parse({ code: "CS1", title: "Title", creditHours: "3.5", courseType: "core" })
        .creditHours,
    ).toBe(3.5);
    expect(
      sectionSchema.parse({ programId: "p", academicYearId: "y", yearLevel: "2", code: "A" })
        .yearLevel,
    ).toBe(2);
    expect(
      offeringSchema.parse({ courseId: "c", termId: "t" }).coordinatorPersonId,
    ).toBeUndefined();
    expect(
      teachingSchema.parse({
        sectionOfferingId: "s",
        personId: "p",
        role: "lab",
        sharePercent: "50",
      }).sharePercent,
    ).toBe(50);
    expect(
      resourceSchema.parse({ code: "R1", name: "Room", kind: "classroom", capacity: "40" })
        .capacity,
    ).toBe(40);
    expect(AudienceSpecSchema.parse({ roles: ["instructor"], yearLevels: [2] }).yearLevels).toEqual(
      [2],
    );
  });
});

describe("form and json helpers", () => {
  it("formToObject maps repeated keys to arrays and blanks to undefined", () => {
    const fd = new FormData();
    fd.set("a", "1");
    fd.set("b", "");
    fd.append("roles", "x");
    fd.append("roles", "y");
    fd.append("keys", "k");
    expect(formToObject(fd, { arrays: ["keys"] })).toEqual({
      a: "1",
      b: undefined,
      roles: ["x", "y"],
      keys: ["k"],
    });
  });

  it("json helpers are identity casts", () => {
    const v = { a: 1 };
    expect(toJson(v)).toBe(v);
    expect(fromJson<{ a: number }>(v).a).toBe(1);
  });
});
