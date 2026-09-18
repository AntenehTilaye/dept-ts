import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import {
  activateVersion,
  createTemplate,
  listTemplates,
  newVersion,
  renderVariants,
  resolveTemplate,
} from "@/platform/template/service";
import { TemplateError } from "@/platform/template/mustache-safe";
import { variablesFor } from "@/platform/template/variables";
import { SEED_TEMPLATES } from "../../../prisma/seed/templates";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("template versions", () => {
  it("seeded system templates are active with declared variables", async () => {
    for (const t of SEED_TEMPLATES) {
      const r = await resolveTemplate(migratorDb, t.key, null);
      expect(r?.version, t.key).toBe(1);
      expect(r?.variants.emailSubject, t.key).toBeTruthy();
    }
  });

  it("newVersion + activate: render uses the active version, prior versions stay readable, department overrides win", async () => {
    const key = `t.${f.uniqueSuffix()}`;
    const declared = [{ name: "name", required: true }];
    await expect(
      createTemplate({
        key,
        kind: "message",
        variants: { inApp: "Hi {{nope}}" },
        declaredVariables: declared,
      }),
    ).rejects.toThrow(TemplateError);
    const t = await createTemplate({
      key,
      kind: "message",
      variants: { inApp: "v1 {{name}}", emailSubject: "s1" },
      declaredVariables: declared,
      isSystem: true,
    });
    expect(t.activeVersion).toBe(1);
    const v2 = await newVersion(t.id, {
      variants: { inApp: "v2 {{name}}", emailSubject: "s2" },
      declaredVariables: declared,
      createdBy: "tester",
    });
    expect(v2).toMatchObject({ version: 2, status: "draft" });
    let r = await resolveTemplate(migratorDb, key, DEPT_CS);
    expect(r?.version).toBe(1);
    await activateVersion(t.id, 2);
    r = await resolveTemplate(migratorDb, key, DEPT_CS);
    expect(r?.version).toBe(2);
    expect(renderVariants(r!, { name: "A" }).inApp).toBe("v2 A");
    const versions = await migratorDb.templateVersion.findMany({
      where: { templateId: t.id },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => v.status)).toEqual(["retired", "active"]);
    // a department override with the same key wins for that department only
    const override = await createTemplate({
      key,
      kind: "message",
      departmentId: DEPT_CS,
      variants: { inApp: "CS {{name}}" },
      declaredVariables: declared,
    });
    expect(override.departmentId).toBe(DEPT_CS);
    expect(
      (await withDept(DEPT_CS, (tx) => resolveTemplate(tx, key, DEPT_CS)))?.variants.inApp,
    ).toBe("CS {{name}}");
    expect(
      (await withDept(DEPT_EE, (tx) => resolveTemplate(tx, key, DEPT_EE)))?.variants.inApp,
    ).toBe("v2 {{name}}");
    expect((await listTemplates(migratorDb, DEPT_CS)).filter((x) => x.key === key)).toHaveLength(2);
    expect(
      await createTemplate({
        key,
        kind: "message",
        variants: { inApp: "dup" },
        declaredVariables: [],
      }),
    ).toMatchObject({ id: t.id });
  });

  it("variablesFor merges subject, person, department and calendar values", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const p = await f.staff(tx, DEPT_CS, { fullName: "Var Person" });
      const c = await f.course(tx, DEPT_CS);
      const vars = await variablesFor(tx, {
        subject: { subjectType: "course", subjectId: c.id },
        personId: p.id,
        departmentId: DEPT_CS,
        extra: { custom: 1 },
      });
      expect(vars).toMatchObject({
        course_code: c.code,
        recipient_name: "Var Person",
        department_code: "CS",
        term_name: "Semester I",
        custom: 1,
      });
      expect(typeof vars.today).toBe("string");
      const none = await variablesFor(tx, {
        subject: { subjectType: "unregistered", subjectId: "x" },
        departmentId: DEPT_CS,
      });
      expect(none.course_code).toBeUndefined();
    });
  });
});
