import { describe, expect, it } from "vitest";
import { ROLE_KEYS } from "@/lib/auth/access";
import {
  DEFAULT_MANAGE_EXCLUDED,
  MATRIX,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLES,
  defaultLevel,
} from "@/platform/identity/permissions-matrix";
import { allowsAction, higherLevel, relationshipSatisfies } from "@/platform/identity/levels";

describe("permission catalogue and default matrix", () => {
  it("has unique dotted keys with module and action parts", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PERMISSIONS) {
      expect(p.key).toBe(`${p.module}.${p.action}`);
      expect(p.description.length).toBeGreaterThan(5);
    }
  });

  it("only references registered keys and known roles, once per role/key", () => {
    const seen = new Set<string>();
    for (const row of MATRIX) {
      expect(PERMISSION_KEYS.has(row.key), row.key).toBe(true);
      expect(ROLE_KEYS.includes(row.role), row.role).toBe(true);
      const id = `${row.role}:${row.key}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
    for (const r of ROLES) expect(ROLE_KEYS.includes(r.key)).toBe(true);
  });

  it("gives the head full on everything but feature.manage and the deputy manage minus admin", () => {
    for (const p of PERMISSIONS) {
      expect(defaultLevel("department_head", p.key)).toBe(
        p.key === "feature.manage" ? undefined : "full",
      );
      const deputy = defaultLevel("deputy_head", p.key);
      expect(deputy).toBe(
        p.key === "feature.manage" || p.key === "admin.department" ? undefined : "manage",
      );
    }
    for (const k of DEFAULT_MANAGE_EXCLUDED) expect(PERMISSION_KEYS.has(k), k).toBe(true);
  });

  it("encodes the instructor, committee and student rows of section 30", () => {
    expect(defaultLevel("instructor", "portfolio.submit_own")).toBe("own");
    expect(defaultLevel("instructor", "task.act")).toBe("assigned");
    expect(defaultLevel("instructor", "evaluation.participate")).toBe("participate");
    expect(defaultLevel("instructor", "portfolio.approve")).toBeUndefined();
    expect(defaultLevel("committee_chair", "committee.task.manage")).toBe("assigned");
    expect(defaultLevel("committee_member", "committee.task.manage")).toBeUndefined();
    expect(defaultLevel("student_rep", "add_drop.submit")).toBe("submit");
    expect(defaultLevel("student", "task.view")).toBeUndefined();
    expect(defaultLevel("lab_staff", "lab.task.manage")).toBe("assigned");
  });
});

describe("levels", () => {
  it("ranks levels and gates verbs", () => {
    expect(higherLevel("view", "manage")).toBe("manage");
    expect(higherLevel("full", "review")).toBe("full");
    expect(allowsAction("view", "read")).toBe(true);
    expect(allowsAction("view", "comment")).toBe(false);
    expect(allowsAction("manage", "approve")).toBe(false);
    expect(allowsAction("review", "approve")).toBe(true);
    expect(allowsAction("submit", "submit")).toBe(true);
    expect(allowsAction("limited", "act")).toBe(false);
  });

  it("maps relational levels to relationships", () => {
    expect(relationshipSatisfies("own", new Set(["owner"]))).toBe(true);
    expect(relationshipSatisfies("own", new Set(["creator"]))).toBe(false);
    expect(relationshipSatisfies("assigned", new Set(["chair"]))).toBe(true);
    expect(relationshipSatisfies("participate", new Set(["target"]))).toBe(true);
    expect(relationshipSatisfies("limited", new Set(["section_rep"]))).toBe(true);
    expect(relationshipSatisfies("review", new Set(["reviewer"]))).toBe(true);
    expect(relationshipSatisfies("view", new Set(["owner"]))).toBe(false);
  });
});
