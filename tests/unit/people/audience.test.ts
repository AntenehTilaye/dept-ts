import { describe, expect, it } from "vitest";
import {
  combineAudience,
  isEmptySpec,
  resolveAudienceIds,
  type AudienceLoader,
} from "@/platform/people/audience";

// In-memory fixture: p1..p6 are department persons, p9 is a stranger.
const loader: AudienceLoader = {
  personsWithRoles: async (roles) => new Set(roles.includes("instructor") ? ["p1", "p2"] : []),
  membersOfGroups: async (ids) => new Set(ids.includes("g1") ? ["p2", "p3"] : []),
  studentsOfPrograms: async () => new Set(["p4", "p5"]),
  studentsOfYearLevels: async (levels) => new Set(levels.includes(2) ? ["p5"] : []),
  studentsOfSections: async (ids) => new Set(ids.includes("s1") ? ["p4", "p9"] : []),
  studentsOfSectionOfferings: async () => new Set(["p6"]),
  teachersOf: async (id) => new Set(id === "so1" ? ["p1"] : []),
  departmentPersons: async () => new Set(["p1", "p2", "p3", "p4", "p5", "p6"]),
};

describe("audience resolution", () => {
  it("unions criteria, removes exclusions and intersects with the department", async () => {
    expect(await resolveAudienceIds({ roles: ["instructor"], groups: ["g1"] }, loader)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(await resolveAudienceIds({ sections: ["s1"], persons: ["p6", "p9"] }, loader)).toEqual([
      "p4",
      "p6",
    ]);
    expect(
      await resolveAudienceIds(
        { roles: ["instructor"], teachingIn: "so1", excludePersons: ["p1"] },
        loader,
      ),
    ).toEqual(["p2"]);
    expect(
      await resolveAudienceIds(
        { programs: ["x"], yearLevels: [2], sectionOfferings: ["so1"] },
        loader,
      ),
    ).toEqual(["p4", "p5", "p6"]);
  });

  it("resolves an empty spec to nobody", async () => {
    expect(isEmptySpec({})).toBe(true);
    expect(isEmptySpec({ excludePersons: ["p1"] })).toBe(true);
    expect(await resolveAudienceIds({}, loader)).toEqual([]);
    expect(await resolveAudienceIds({ roles: [] }, loader)).toEqual([]);
  });

  it("combineAudience is a pure sorted set operation", () => {
    expect(
      combineAudience([new Set(["b", "a"]), new Set(["c"])], ["c"], new Set(["a", "b", "z"])),
    ).toEqual(["a", "b"]);
  });
});
