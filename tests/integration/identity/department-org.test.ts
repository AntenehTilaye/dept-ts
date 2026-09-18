import { describe, expect, it } from "vitest";
import { departmentService, departmentSlug } from "@/platform/people/departments";
import { migratorDb } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

describe("departments are better-auth organizations", () => {
  it("creates the organization and the department with one shared id and the code as slug", async () => {
    const code = `T${uniqueSuffix().toUpperCase()}`;
    const dept = await departmentService.create(
      { code, name: "Test Dept", facultyName: "Eng" },
      migratorDb,
    );
    expect(dept.id).toBe(dept.organizationId);
    const org = await migratorDb.organization.findUnique({ where: { id: dept.id } });
    expect(org).toMatchObject({ slug: departmentSlug(code), name: "Test Dept" });
    expect(JSON.parse(org!.metadata!)).toEqual({ code });
    expect((await departmentService.bySlug(code.toLowerCase()))?.id).toBe(dept.id);
  });

  it("rejects malformed codes and rolls back both rows on a duplicate code", async () => {
    await expect(departmentService.create({ code: "x", name: "bad" }, migratorDb)).rejects.toThrow(
      /2-12/,
    );
    const before = await migratorDb.organization.count();
    await expect(
      departmentService.create({ code: "CS", name: "dup" }, migratorDb),
    ).rejects.toThrow();
    expect(await migratorDb.organization.count()).toBe(before);
  });

  it("lists departments with their organization slug", async () => {
    const list = await departmentService.list();
    const cs = list.find((d) => d.id === DEPT_CS);
    expect(cs?.organization.slug).toBe("cs");
    expect(list.map((d) => d.code)).toEqual([...list.map((d) => d.code)].sort());
  });
});
