import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import {
  answersAsVariables,
  defineForm,
  fieldsOf,
  FormError,
  newVersion,
  resolveBinding,
  saveDraft,
  submissionWithAnswers,
  submit,
  SubmissionValidationError,
  type FieldDef,
} from "@/platform/forms";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

const field = (x: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...x });

let personId: string;

beforeAll(async () => {
  const p = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS));
  personId = p.id;
});

const FIELDS: FieldDef[] = [
  field({ key: "title", type: "short_text", label: "Title", constraints: { required: true } }),
  field({
    key: "score",
    type: "likert",
    label: "Score",
    aggregation: "mean",
    constraints: { required: true, min: 1, max: 5 },
  }),
  field({
    key: "owner",
    type: "person_picker",
    label: "Owner",
    sourceBinding: "staff_in_department",
    constraints: { required: false },
  }),
  field({
    key: "items",
    type: "repeating_group",
    label: "Items",
    constraints: { required: false, maxItems: 3 },
    fields: [
      field({ key: "name", type: "short_text", label: "Name", constraints: { required: true } }),
      field({ key: "qty", type: "number", label: "Quantity", constraints: { required: false } }),
    ],
  }),
  field({
    key: "prefs",
    type: "ranked_list",
    label: "Priorities",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    constraints: { required: false, maxRank: 2 },
  }),
];

describe("form definitions and submissions", () => {
  it("defines a form, re-defines it as a no-op and cuts a version when the questions change", async () => {
    const key = `t_${f.uniqueSuffix()}`;
    const v1 = await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "T",
        fields: FIELDS,
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("published");
    const again = await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "T",
        fields: FIELDS,
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    expect(again.version).toBe(1);

    const v2 = await withTenantTx(DEPT_CS, (tx) =>
      newVersion(
        tx,
        key,
        [...FIELDS, field({ key: "extra", type: "short_text", label: "Extra" })],
        {
          departmentId: DEPT_CS,
          publish: true,
        },
      ),
    );
    expect(v2.version).toBe(2);
    expect(v2.questionsHash).not.toBe(v1.questionsHash);
    const retired = await migratorDb.formDefinition.findUniqueOrThrow({ where: { id: v1.id } });
    expect(retired.status).toBe("retired");
  });

  it("writes normalised answer rows with the typed columns and pins the version", async () => {
    const key = `t_${f.uniqueSuffix()}`;
    const form = await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "T",
        fields: FIELDS,
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    const submission = await withTenantTx(DEPT_CS, (tx) =>
      submit(tx, DEPT_CS, key, {
        title: "A plan",
        score: 4,
        owner: personId,
        items: [{ name: "First", qty: 2 }, { name: "Second" }],
        prefs: { order: ["b", "a"] },
      }),
    );
    expect(submission.formVersion).toBe(form.version);
    expect(submission.status).toBe("submitted");

    const rows = await migratorDb.answer.findMany({
      where: { submissionId: submission.id },
      orderBy: [{ questionStableKey: "asc" }, { groupIndex: "asc" }],
    });
    const score = rows.find((r) => r.questionStableKey === "score")!;
    expect(Number(score.numericValue)).toBe(4);
    const owner = rows.find((r) => r.questionStableKey === "owner")!;
    expect(owner).toMatchObject({ refType: "person", refId: personId });
    const title = rows.find((r) => r.questionStableKey === "title")!;
    expect(title.textValue).toBe("A plan");
    // repeating group rows carry their index
    expect(rows.filter((r) => r.questionStableKey === "name").map((r) => r.groupIndex)).toEqual([
      0, 1,
    ]);
    // ranked list keeps the order in `rank`
    const ranked = rows.filter((r) => r.questionStableKey === "prefs");
    expect(ranked.map((r) => [r.valueJson, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);

    const variables = await withTenantTx(DEPT_CS, (tx) => answersAsVariables(tx, submission.id));
    expect(variables.answer_title).toBe("A plan");
  });

  it("refuses an invalid submission with per-field issues and keeps drafts unvalidated", async () => {
    const key = `t_${f.uniqueSuffix()}`;
    await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "T",
        fields: FIELDS,
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    const draft = await withTenantTx(DEPT_CS, (tx) =>
      saveDraft(tx, DEPT_CS, key, { title: "incomplete" }),
    );
    expect(draft.status).toBe("draft");

    await expect(
      withTenantTx(DEPT_CS, (tx) => submit(tx, DEPT_CS, key, { title: "" }, {}, draft.id)),
    ).rejects.toBeInstanceOf(SubmissionValidationError);
    try {
      await withTenantTx(DEPT_CS, (tx) => submit(tx, DEPT_CS, key, { title: "" }, {}, draft.id));
    } catch (error) {
      const issues = (error as SubmissionValidationError).issues;
      expect(Object.keys(issues).sort()).toEqual(["score", "title"]);
    }
    // the draft survives the failed submit and can be completed
    const done = await withTenantTx(DEPT_CS, (tx) =>
      submit(tx, DEPT_CS, key, { title: "Complete", score: 3 }, {}, draft.id),
    );
    expect(done.id).toBe(draft.id);
    expect(done.status).toBe("submitted");
    const stored = await withTenantTx(DEPT_CS, (tx) => submissionWithAnswers(tx, draft.id));
    expect(stored!.answers.map((a) => a.questionStableKey).sort()).toEqual(["score", "title"]);
  });

  it("keeps the pinned version when a newer one is published", async () => {
    const key = `t_${f.uniqueSuffix()}`;
    await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "T",
        fields: [
          field({ key: "a", type: "short_text", label: "A", constraints: { required: true } }),
        ],
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    const first = await withTenantTx(DEPT_CS, (tx) => submit(tx, DEPT_CS, key, { a: "one" }));
    await withTenantTx(DEPT_CS, (tx) =>
      newVersion(
        tx,
        key,
        [
          field({ key: "a", type: "short_text", label: "A", constraints: { required: true } }),
          field({ key: "b", type: "short_text", label: "B", constraints: { required: true } }),
        ],
        { departmentId: DEPT_CS, publish: true },
      ),
    );
    // the old submission still points at v1 and its form still has one question
    const stored = await withTenantTx(DEPT_CS, (tx) => submissionWithAnswers(tx, first.id));
    expect(stored!.formVersion).toBe(1);
    expect(fieldsOf(stored!.form)).toHaveLength(1);
    // a new submission must satisfy v2
    await expect(
      withTenantTx(DEPT_CS, (tx) => submit(tx, DEPT_CS, key, { a: "two" })),
    ).rejects.toBeInstanceOf(SubmissionValidationError);
  });

  it("refuses to remove or retype a locked question of a system form", async () => {
    const key = `sys_${f.uniqueSuffix()}`;
    // faculty-wide rows (departmentId null) are written under bypass, exactly as the seed does
    const faculty = <T>(
      fn: (tx: Parameters<Parameters<typeof withTenantTx>[1]>[0]) => Promise<T>,
    ) => withTenantBypass({ worker: true, jobName: "test" }, "system form", fn);
    await faculty((tx) =>
      defineForm(tx, {
        key,
        kind: "generic",
        title: "System",
        isSystem: true,
        departmentId: null,
        publish: true,
        fields: [
          field({ key: "locked_one", type: "short_text", label: "Locked", locked: true }),
          field({ key: "free", type: "short_text", label: "Free" }),
        ],
      }),
    );
    await expect(
      faculty((tx) =>
        newVersion(tx, key, [field({ key: "free", type: "short_text", label: "Free" })], {
          departmentId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(FormError);
    await expect(
      faculty((tx) =>
        newVersion(
          tx,
          key,
          [
            field({ key: "locked_one", type: "number", label: "Locked", locked: true }),
            field({ key: "free", type: "short_text", label: "Free" }),
          ],
          { departmentId: null },
        ),
      ),
    ).rejects.toThrow(/cannot change type/);
    // relabelling a locked question is allowed
    const ok = await faculty((tx) =>
      newVersion(
        tx,
        key,
        [
          field({ key: "locked_one", type: "short_text", label: "Locked (renamed)", locked: true }),
          field({ key: "free", type: "short_text", label: "Free" }),
        ],
        { departmentId: null, publish: true },
      ),
    );
    expect(ok.version).toBe(2);
  });

  it("source bindings only return rows of the caller's department", async () => {
    await withDept(DEPT_EE, (tx) => f.staff(tx, DEPT_EE));
    const cs = await withTenantTx(DEPT_CS, (tx) =>
      resolveBinding("staff_in_department", { db: tx, departmentId: DEPT_CS }),
    );
    const ee = await withTenantTx(DEPT_EE, (tx) =>
      resolveBinding("staff_in_department", { db: tx, departmentId: DEPT_EE }),
    );
    expect(cs.length).toBeGreaterThan(0);
    expect(ee.length).toBeGreaterThan(0);
    const csIds = new Set(cs.map((o) => o.value));
    expect(ee.some((o) => csIds.has(o.value))).toBe(false);
  });
});
