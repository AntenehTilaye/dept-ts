import { afterEach, describe, expect, it } from "vitest";
import {
  can,
  registerPermissionFallback,
  resolvePermissionKey,
  setSubjectResolver,
  type Actor,
  type Grant,
  type PolicyStore,
  type SubjectContext,
} from "@/platform/identity/can";
import type { PermissionLevelKey, Relationship } from "@/platform/identity/levels";

const DEPT = "dep_cs";

function store(opts: {
  matrix: Record<string, Record<string, PermissionLevelKey>>;
  grants: Grant[];
  excluded?: string[];
  keys?: string[];
}): PolicyStore {
  return {
    async rolePermissions() {
      return new Map(
        Object.entries(opts.matrix).map(([role, m]) => [role, new Map(Object.entries(m))]),
      );
    },
    async activeGrants() {
      return opts.grants;
    },
    async manageExcluded() {
      return new Set(opts.excluded ?? []);
    },
    async registeredKeys() {
      return new Set(
        opts.keys ?? [
          "task.view",
          "task.act",
          "task.manage",
          "portfolio.approve",
          "campaign.manage",
        ],
      );
    },
  };
}

function actor(over: Partial<Actor> = {}): Actor {
  return { userId: "u1", personId: "p1", departmentId: DEPT, isAdmin: false, ...over };
}

const dept = (roleKey: string): Grant => ({ roleKey, scopeType: "department", scopeId: DEPT });
const TASK = { subjectType: "task", subjectId: "t1" };

function resolver(context: SubjectContext, rels: Relationship[] = []) {
  setSubjectResolver({
    async contextOf() {
      return context;
    },
    async relationships() {
      return rels;
    },
  });
}

afterEach(() => resolver({}));

describe("can()", () => {
  it("grants a global administrator everything except respondent keys", async () => {
    const s = store({ matrix: {}, grants: [] });
    expect((await can(s, actor({ isAdmin: true }), "task.manage")).allowed).toBe(true);
    expect((await can(s, actor({ isAdmin: true }), "evaluation.participate")).allowed).toBe(false);
  });

  it("denies without an active grant", async () => {
    const d = await can(
      store({ matrix: { instructor: { "task.view": "view" } }, grants: [] }),
      actor(),
      "task.view",
    );
    expect(d).toMatchObject({ allowed: false, level: "none" });
    expect(d.reason).toMatch(/no active role/);
  });

  it("lets an explicit none win over any other grant", async () => {
    const s = store({
      matrix: { department_head: { "task.manage": "full" }, student: { "task.manage": "none" } },
      grants: [dept("department_head"), dept("student")],
    });
    expect((await can(s, actor(), "task.manage")).reason).toMatch(/explicit deny/);
  });

  it("applies full and view unconditionally and manage unless excluded", async () => {
    const s = store({
      matrix: { deputy_head: { "task.manage": "manage", "portfolio.approve": "manage" } },
      grants: [dept("deputy_head")],
      excluded: ["portfolio.approve"],
    });
    expect((await can(s, actor(), "task.manage")).allowed).toBe(true);
    const denied = await can(s, actor(), "portfolio.approve");
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/excluded from manage/);
  });

  it("requires a relationship for own/assigned/participate when the grant is department-wide", async () => {
    const s = store({
      matrix: { instructor: { "task.act": "assigned" } },
      grants: [dept("instructor")],
    });
    resolver({ departmentId: DEPT }, []);
    const missing = await can(s, actor(), "task.act", TASK);
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toMatch(/relationship is missing/);
    resolver({ departmentId: DEPT }, ["assignee"]);
    expect((await can(s, actor(), "task.act", TASK)).allowed).toBe(true);
    // without a subject there is nothing to relate to
    expect((await can(s, actor(), "task.act")).allowed).toBe(false);
  });

  it("applies a scoped grant only inside its context and treats assigned as satisfied there", async () => {
    const s = store({
      matrix: { committee_chair: { "task.manage": "assigned" } },
      grants: [{ roleKey: "committee_chair", scopeType: "committee", scopeId: "c1" }],
    });
    resolver({ departmentId: DEPT, committeeId: "c1" });
    expect((await can(s, actor(), "task.manage", TASK)).allowed).toBe(true);
    resolver({ departmentId: DEPT, committeeId: "c2" });
    expect((await can(s, actor(), "task.manage", TASK)).allowed).toBe(false);
    expect((await can(s, actor(), "task.manage")).allowed).toBe(false);
  });

  it("refuses subjects from another department", async () => {
    const s = store({
      matrix: { department_head: { "task.view": "full" } },
      grants: [dept("department_head")],
    });
    resolver({ departmentId: "dep_ee" });
    expect((await can(s, actor(), "task.view", TASK)).reason).toMatch(/another department/);
  });

  it("keeps the highest satisfied level and gates it by verb", async () => {
    const s = store({
      matrix: { instructor: { "task.view": "view" }, deputy_head: { "task.view": "manage" } },
      grants: [dept("instructor"), dept("deputy_head")],
    });
    expect(await can(s, actor(), "task.view")).toMatchObject({ allowed: true, level: "manage" });
    const approve = await can(s, actor(), "task.view", undefined, { verb: "approve" });
    expect(approve).toMatchObject({ allowed: false, level: "manage" });
    expect((await can(s, actor(), "task.view", undefined, { verb: "read" })).allowed).toBe(true);
  });

  it("treats review as unconditional for department-wide grants and relational for scoped ones", async () => {
    const wide = store({
      matrix: { reviewer: { "task.view": "review" } },
      grants: [dept("reviewer")],
    });
    expect((await can(wide, actor(), "task.view", undefined, { verb: "approve" })).allowed).toBe(
      true,
    );
    const scoped = store({
      matrix: { reviewer: { "task.view": "review" } },
      grants: [{ roleKey: "reviewer", scopeType: "committee", scopeId: "c1" }],
    });
    resolver({ committeeId: "c1" }, []);
    expect((await can(scoped, actor(), "task.view", TASK)).allowed).toBe(false);
    resolver({ committeeId: "c1" }, ["reviewer"]);
    expect((await can(scoped, actor(), "task.view", TASK)).allowed).toBe(true);
  });

  it("falls back from feature-prefixed keys to the registered generic key", () => {
    registerPermissionFallback("evaluation", "campaign.manage");
    const registered = new Set(["campaign.manage", "evaluation.close"]);
    expect(resolvePermissionKey("evaluation.close", registered)).toBe("evaluation.close");
    expect(resolvePermissionKey("evaluation.reopen", registered)).toBe("campaign.manage");
    expect(resolvePermissionKey("unknown.key", registered)).toBe("unknown.key");
    expect(resolvePermissionKey("nodot", registered)).toBe("nodot");
  });
});
