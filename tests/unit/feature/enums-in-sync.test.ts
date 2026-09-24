import { describe, expect, it } from "vitest";
import {
  PeriodKind,
  PermissionLevel as PrismaPermissionLevel,
  ScopeType,
  SubjectType,
  TaskKind as PrismaTaskKind,
} from "@/generated/prisma/enums";
import { ORG_ROLE_KEYS, ROLE_KEYS } from "@/lib/auth/access";
import {
  CalendarPeriodKind,
  NavGroup,
  NavRoleKey,
  PermissionLevel,
  RoleKey,
  ScopeLevel,
  scopeTypeOf,
  SubjectTypeKey,
  TaskKind,
} from "@/platform/feature/schema";

// A definition is authored against these enums and stored as JSON, so a value that the database
// no longer knows would only fail at publish time, on a definition an administrator already
// wrote. They are therefore derived from the generated enums, and this test is what keeps the
// derivation honest.

const sorted = (values: readonly string[]) => [...values].sort();

describe("feature enums stay in sync with the database", () => {
  it("mirrors SubjectType, PeriodKind, TaskKind and PermissionLevel", () => {
    expect(sorted(SubjectTypeKey.options)).toEqual(sorted(Object.values(SubjectType)));
    expect(sorted(CalendarPeriodKind.options)).toEqual(sorted(Object.values(PeriodKind)));
    expect(sorted(TaskKind.options)).toEqual(sorted(Object.values(PrismaTaskKind)));
    expect(sorted(PermissionLevel.options)).toEqual(sorted(Object.values(PrismaPermissionLevel)));
  });

  it("carries the subject types the feature runtime registers itself", () => {
    expect(SubjectTypeKey.options).toContain("feature_record");
    expect(SubjectTypeKey.options).toContain("feature_step_instance");
    expect(SubjectTypeKey.options).toContain("feature_definition");
  });

  it("offers navigation to the membership roles and the global administrator only", () => {
    expect(sorted(NavRoleKey.options)).toEqual(sorted([...ORG_ROLE_KEYS, "admin"]));
    // committee_chair is derived from a RoleGrant, so it can act but never owns a sidebar entry
    expect(NavRoleKey.options).not.toContain("committee_chair");
    expect(sorted(RoleKey.options)).toEqual(sorted(ROLE_KEYS));
    expect(RoleKey.options).toContain("committee_chair");
  });

  it("maps every scope level onto a ScopeType the column accepts", () => {
    for (const level of ScopeLevel.options)
      expect(Object.values(ScopeType)).toContain(scopeTypeOf(level));
  });

  it("keeps the navigation groups the sidebar renders", () => {
    expect(NavGroup.options).toEqual([
      "operations",
      "academic",
      "people",
      "communication",
      "planning",
      "resources",
      "admin",
    ]);
  });
});
