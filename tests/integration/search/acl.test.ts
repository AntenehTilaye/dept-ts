import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { createTaskRecord } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { index, rebuild, search, suggest, tokensForActor } from "@/platform/search";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// Search is only worth having if it never shows somebody something they could not open. The
// tokens narrow the rows in the database and `can()` has the last word, so these tests are
// about both gates agreeing — and about a rebuild producing what the live index already holds.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let head: Actor;
let instructor: Actor;
let taskId: string;
let recordId: string;
let courseCode: string;

beforeAll(async () => {
  const [dh, ins] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor2.cs@deptts.local" } }),
  ]);
  const [p1, p2] = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" })),
    withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: ins.id, email: "instructor2.cs@deptts.local" }),
    ),
  ]);
  head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
  instructor = { userId: ins.id, personId: p2.id, departmentId: DEPT_CS, isAdmin: false };

  const course = await withDept(DEPT_CS, (tx) => f.course(tx, DEPT_CS));
  courseCode = course.code;

  const spawned = await withTenantTx(DEPT_CS, (tx) =>
    createTaskRecord(tx, DEPT_CS, head, {
      title: "Invigilate the pharmacology examination",
      description: "A task the head assigned to the instructor.",
      assignees: [{ type: "person", id: p2.id }],
    }),
  );
  taskId = spawned.taskId;
  recordId = spawned.recordId;

  await withTenantTx(DEPT_CS, async (tx) => {
    await index(tx, { subjectType: "task", subjectId: taskId }, DEPT_CS);
    await index(tx, { subjectType: "feature_record", subjectId: recordId }, DEPT_CS);
    await index(tx, { subjectType: "course", subjectId: course.id }, DEPT_CS);
  });
});

describe("searching", () => {
  it("finds a task by its words, with a snippet and a link", async () => {
    const hits = await withTenantTx(DEPT_CS, (tx) => search(tx, head, "pharmacology"));
    const task = hits.find((h) => h.subjectType === "task");
    expect(task).toBeDefined();
    expect(task!.title).toContain("Invigilate");
    expect(task!.url).toContain("/d/cs/tasks/");
    // the snippet is text, not markup
    expect(task!.snippet).not.toContain("<b>");
  });

  it("a person's tokens are their department, their roles, themselves and their groups", async () => {
    const tokens = await withTenantTx(DEPT_CS, (tx) => tokensForActor(tx, head));
    expect(tokens).toContain(`dept:${DEPT_CS}`);
    expect(tokens).toContain(`person:${head.personId}`);
    expect(tokens.some((t) => t.startsWith("role:department_head@"))).toBe(true);
  });

  it("another department never sees it, whatever they search for", async () => {
    const eeUser = await migratorDb.user.findUniqueOrThrow({
      where: { email: "dh.ee@deptts.local" },
    });
    const eePerson = await withDept(DEPT_EE, (tx) => f.staff(tx, DEPT_EE, { userId: eeUser.id }));
    const stranger: Actor = {
      userId: eeUser.id,
      personId: eePerson.id,
      departmentId: DEPT_EE,
      isAdmin: false,
    };
    const hits = await withTenantTx(DEPT_EE, (tx) => search(tx, stranger, "pharmacology"));
    expect(hits).toEqual([]);
  });

  it("the type filter narrows the kinds, and suggest matches a prefix of a title", async () => {
    const only = await withTenantTx(DEPT_CS, (tx) =>
      search(tx, head, "pharmacology", { types: ["feature_record"] }),
    );
    expect(only.every((h) => h.subjectType === "feature_record")).toBe(true);

    const suggestions = await withTenantTx(DEPT_CS, (tx) =>
      suggest(tx, head, courseCode.slice(0, 4)),
    );
    expect(suggestions.some((s) => s.title.includes(courseCode))).toBe(true);
  });

  it("a rebuild reproduces what the live index holds", async () => {
    const before = await migratorDb.searchIndexEntry.findMany({
      where: { departmentId: DEPT_CS, subjectType: "task" },
      select: { subjectId: true, title: true, aclTokens: true },
      orderBy: { subjectId: "asc" },
    });
    await withTenantTx(DEPT_CS, (tx) => rebuild(tx, DEPT_CS, ["task"]));
    const after = await migratorDb.searchIndexEntry.findMany({
      where: { departmentId: DEPT_CS, subjectType: "task" },
      select: { subjectId: true, title: true, aclTokens: true },
      orderBy: { subjectId: "asc" },
    });
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    const rebuilt = after.find((r) => r.subjectId === taskId)!;
    const original = before.find((r) => r.subjectId === taskId)!;
    expect(rebuilt.title).toBe(original.title);
    expect([...rebuilt.aclTokens].sort()).toEqual([...original.aclTokens].sort());
  });

  it("an empty query finds nothing rather than everything", async () => {
    expect(await withTenantTx(DEPT_CS, (tx) => search(tx, head, "   "))).toEqual([]);
    expect(await withTenantTx(DEPT_CS, (tx) => suggest(tx, head, "a"))).toEqual([]);
  });

  it("punctuation somebody types is not a query syntax error", async () => {
    for (const query of ["CS-201 & ", '"a phrase', "back\\slash", "a:b:c"]) {
      await expect(
        withTenantTx(DEPT_CS, (tx) => search(tx, instructor, query)),
      ).resolves.toBeInstanceOf(Array);
    }
  });
});
