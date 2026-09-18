import { afterEach, describe, expect, it } from "vitest";
import * as registry from "@/platform/subject-registry";
import type { Db } from "@/lib/db/types";

const db = {} as Db;

function reg(over: Partial<registry.SubjectRegistration> = {}): registry.SubjectRegistration {
  return {
    label: async (_db, id) => (id === "missing" ? null : `label ${id}`),
    snapshot: async (_db, id) => (id === "missing" ? null : { label: `label ${id}` }),
    contextOf: async () => ({ departmentId: "d1" }),
    relationships: async (_db, _id, personId) => (personId === "me" ? ["owner"] : []),
    ...over,
  };
}

afterEach(() => {
  for (const t of registry.types()) registry.replace(t, null);
});

describe("subject registry", () => {
  it("registers, resolves and lists types; duplicate registration throws", () => {
    registry.register("task", reg());
    registry.register("case", reg());
    expect(registry.types()).toEqual(["case", "task"]);
    expect(registry.isRegistered("task")).toBe(true);
    expect(() => registry.register("task", reg())).toThrow(/already registered/);
    expect(() => registry.resolve("nope")).toThrow(registry.UnknownSubjectTypeError);
  });

  it("exists() is false for an unknown id and assertExists throws", async () => {
    registry.register("task", reg());
    expect(await registry.exists(db, { subjectType: "task", subjectId: "t1" })).toBe(true);
    expect(await registry.exists(db, { subjectType: "task", subjectId: "missing" })).toBe(false);
    await expect(
      registry.assertExists(db, { subjectType: "task", subjectId: "missing" }),
    ).rejects.toThrow(registry.SubjectNotFoundError);
    expect(await registry.label(db, { subjectType: "task", subjectId: "missing" })).toBe(
      "task missing",
    );
    expect(await registry.snapshot(db, { subjectType: "task", subjectId: "t1" })).toEqual({
      label: "label t1",
    });
  });

  it("contextOf merges the parent context, child ids winning", async () => {
    registry.register(
      "committee",
      reg({ contextOf: async () => ({ departmentId: "d1", committeeId: "c1", groupId: "g1" }) }),
    );
    registry.register(
      "task",
      reg({
        contextOf: async () => ({
          groupId: "g2",
          parentRef: { subjectType: "committee", subjectId: "c1" },
        }),
      }),
    );
    expect(await registry.contextOf(db, { subjectType: "task", subjectId: "t1" })).toEqual({
      departmentId: "d1",
      committeeId: "c1",
      groupId: "g2",
    });
    expect(
      await registry.relationships(db, { subjectType: "task", subjectId: "t1" }, "me"),
    ).toEqual(["owner"]);
    expect(await registry.variables(db, { subjectType: "task", subjectId: "t1" })).toEqual({});
    expect(registry.url({ subjectType: "task", subjectId: "t1" }, "cs")).toBeNull();
  });

  it("resolverWith builds the can() resolver from a client factory", async () => {
    registry.register("task", reg());
    const seen: string[] = [];
    const resolver = registry.resolverWith((departmentId) => {
      seen.push(departmentId);
      return db;
    });
    expect(await resolver.contextOf({ subjectType: "task", subjectId: "t1" }, "dep_cs")).toEqual({
      departmentId: "d1",
    });
    expect(
      await resolver.relationships({ subjectType: "task", subjectId: "t1" }, "me", "dep_ee"),
    ).toEqual(["owner"]);
    expect(seen).toEqual(["dep_cs", "dep_ee"]);
  });
});
