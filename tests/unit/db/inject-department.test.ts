import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/tenancy-manifest", () => ({
  TENANT_MODELS: new Set(["Task"]),
  SHARED_MODELS: new Set(["Role"]),
  GLOBAL_MODELS: new Set(["Department"]),
}));

const { injectDepartmentId, TenantMismatchError } = await import("@/lib/db/scoped");

describe("injectDepartmentId", () => {
  it("adds departmentId to create data of tenant and shared models", () => {
    const args = injectDepartmentId("Task", "create", { data: { title: "x" } }, "dep_cs")!;
    expect(args.data).toEqual({ title: "x", departmentId: "dep_cs" });
    const shared = injectDepartmentId("Role", "create", { data: { key: "k" } }, "dep_cs")!;
    expect(shared.data).toEqual({ key: "k", departmentId: "dep_cs" });
  });

  it("handles createMany arrays and upsert create blocks", () => {
    const many = injectDepartmentId(
      "Task",
      "createMany",
      { data: [{ title: "a" }, { title: "b" }] },
      "dep_cs",
    )!;
    expect(many.data).toEqual([
      { title: "a", departmentId: "dep_cs" },
      { title: "b", departmentId: "dep_cs" },
    ]);
    const up = injectDepartmentId(
      "Task",
      "upsert",
      { where: { id: "1" }, create: { title: "a" }, update: { title: "b" } },
      "dep_cs",
    )!;
    expect(up.create).toEqual({ title: "a", departmentId: "dep_cs" });
    expect(up.update).toEqual({ title: "b" });
  });

  it("throws TenantMismatchError on a foreign departmentId before anything reaches the database", () => {
    expect(() =>
      injectDepartmentId("Task", "create", { data: { departmentId: "dep_ee" } }, "dep_cs"),
    ).toThrow(TenantMismatchError);
    expect(() =>
      injectDepartmentId(
        "Role",
        "update",
        { where: { id: "1" }, data: { departmentId: "dep_ee" } },
        "dep_cs",
      ),
    ).toThrow(/does not match the active department/);
  });

  it("allows an explicit NULL only for shared models (faculty-wide rows written under bypass)", () => {
    expect(
      injectDepartmentId("Role", "create", { data: { departmentId: null } }, "dep_cs")!.data,
    ).toEqual({ departmentId: null });
    expect(() =>
      injectDepartmentId("Task", "create", { data: { departmentId: null } }, "dep_cs"),
    ).toThrow(TenantMismatchError);
  });

  it("leaves reads, nested include arguments and unrelated updates untouched (RLS does that filtering)", () => {
    const read = { where: { title: "x" }, include: { assignments: true } };
    expect(injectDepartmentId("Task", "findMany", read, "dep_cs")).toBe(read);
    expect(read).toEqual({ where: { title: "x" }, include: { assignments: true } });
    const update = { where: { id: "1" }, data: { title: "y" } };
    expect(injectDepartmentId("Task", "update", update, "dep_cs")!.data).toEqual({ title: "y" });
    expect(injectDepartmentId("Task", "create", undefined, "dep_cs")).toBeUndefined();
  });
});
