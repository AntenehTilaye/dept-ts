import type { SubmissionStatus } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import { assertExists } from "../subject-registry";
import type { SubjectRef } from "../subject-registry/types";
import { activeForm, fieldsOf, FormError, formVersion } from "./definitions";
import { isNumeric, isPicker, isPresentational, PICKER_TYPES, type FieldDef } from "./field-schema";
import { zodFromFields } from "./zod-from-fields";

// Submissions: one response to a form, either standalone (bound to a subject or a feature step)
// or part of a campaign. Answers are normalised into rows with the typed columns aggregation
// and search read; the form version is pinned so a later version never rewrites history.

export interface AnswerMap {
  [questionKey: string]: unknown;
}

export interface SubmitContext {
  /** What the submission is about (committee report, portfolio, feature step, ...). */
  subject?: SubjectRef | null;
  stepKey?: string | null;
  respondentPersonId?: string | null;
  campaignId?: string | null;
  campaignSubjectId?: string | null;
  invitationId?: string | null;
  respondentGroup?: "students" | "colleagues" | "dh" | "other" | null;
  cohortAttributes?: Record<string, unknown> | null;
  pseudonymHash?: string | null;
  /** Anonymous campaigns truncate the timestamp to the day. */
  dayTruncated?: boolean;
  formVersion?: number;
}

export interface DraftHandle {
  id: string;
  formDefinitionId: string;
  formVersion: number;
  status: SubmissionStatus;
}

/** The pinned form of a submission (or the active one for a new draft). */
export async function resolveForm(db: Db, departmentId: string, key: string, version?: number) {
  const form = version
    ? ((await formVersion(db, key, version, departmentId)) ??
      (await formVersion(db, key, version, null)))
    : await activeForm(db, key, departmentId);
  if (!form) throw new FormError(`No published form "${key}"`, "not_found");
  return form;
}

function answerRows(fields: FieldDef[], answers: AnswerMap) {
  const rows: Array<{
    questionStableKey: string;
    groupIndex: number;
    valueJson: unknown;
    numericValue: number | null;
    rank: number | null;
    refType: string | null;
    refId: string | null;
    textValue: string | null;
  }> = [];

  const push = (field: FieldDef, value: unknown, groupIndex: number) => {
    if (value === undefined || value === null || value === "") return;
    const row = {
      questionStableKey: field.key,
      groupIndex,
      valueJson: value,
      numericValue: isNumeric(field.type) ? Number(value) : null,
      rank: null as number | null,
      refType: isPicker(field.type) ? (PICKER_TYPES[field.type] ?? null) : null,
      refId: isPicker(field.type) ? String(value) : null,
      textValue: field.type === "short_text" || field.type === "long_text" ? String(value) : null,
    };
    rows.push(row);
  };

  for (const field of fields) {
    if (isPresentational(field.type)) continue;
    const value = answers[field.key];
    if (field.type === "repeating_group") {
      const list = Array.isArray(value) ? value : [];
      list.forEach((entry, index) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        for (const sub of field.fields ?? []) push(sub, record[sub.key], index);
      });
      continue;
    }
    if (field.type === "ranked_list") {
      const order = (value as { order?: string[] } | null)?.order ?? [];
      order.forEach((id, index) => {
        rows.push({
          questionStableKey: field.key,
          groupIndex: index,
          valueJson: id,
          numericValue: null,
          rank: index + 1,
          refType: "ranked_option",
          refId: id,
          textValue: null,
        });
      });
      continue;
    }
    if (field.type === "multi_choice" || field.type === "file") {
      const list = Array.isArray(value) ? value : [];
      list.forEach((item, index) => {
        rows.push({
          questionStableKey: field.key,
          groupIndex: index,
          valueJson: item,
          numericValue: null,
          rank: null,
          refType: field.type === "file" ? "document" : null,
          refId: field.type === "file" ? String(item) : null,
          textValue: null,
        });
      });
      continue;
    }
    push(field, value, 0);
  }
  return rows;
}

async function writeAnswers(
  db: Db,
  departmentId: string,
  submissionId: string,
  fields: FieldDef[],
  answers: AnswerMap,
) {
  await db.answer.deleteMany({ where: { submissionId } });
  const rows = answerRows(fields, answers);
  if (!rows.length) return 0;
  await db.answer.createMany({
    data: rows.map((r) => ({
      departmentId,
      submissionId,
      questionStableKey: r.questionStableKey,
      groupIndex: r.groupIndex,
      valueJson: toJson(r.valueJson),
      numericValue: r.numericValue,
      rank: r.rank,
      refType: r.refType,
      refId: r.refId,
      textValue: r.textValue,
    })),
  });
  return rows.length;
}

/** Creates or updates a draft without validating required fields. */
export async function saveDraft(
  db: Db,
  departmentId: string,
  formKey: string,
  answers: AnswerMap,
  ctx: SubmitContext = {},
  draftId?: string,
): Promise<DraftHandle> {
  const form = await resolveForm(db, departmentId, formKey, ctx.formVersion);
  const fields = fieldsOf(form);
  if (ctx.subject) await assertExists(db, ctx.subject);
  const draft = draftId
    ? await db.submission.update({
        where: { id: draftId },
        data: { rowVersion: { increment: 1 } },
      })
    : await db.submission.create({
        data: {
          departmentId,
          formDefinitionId: form.id,
          formVersion: form.version,
          campaignId: ctx.campaignId ?? null,
          campaignSubjectId: ctx.campaignSubjectId ?? null,
          subjectType: (ctx.subject?.subjectType ?? null) as never,
          subjectId: ctx.subject?.subjectId ?? null,
          stepKey: ctx.stepKey ?? null,
          respondentPersonId: ctx.respondentPersonId ?? null,
          invitationId: ctx.invitationId ?? null,
          respondentGroup: ctx.respondentGroup ?? null,
          cohortAttributesJson: ctx.cohortAttributes ? toJson(ctx.cohortAttributes) : undefined,
          pseudonymHash: ctx.pseudonymHash ?? null,
          status: "draft",
        },
      });
  await writeAnswers(db, departmentId, draft.id, fields, answers);
  return {
    id: draft.id,
    formDefinitionId: form.id,
    formVersion: form.version,
    status: draft.status,
  };
}

export class SubmissionValidationError extends Error {
  constructor(readonly issues: Record<string, string[]>) {
    super("The form has validation errors");
    this.name = "SubmissionValidationError";
  }
}

/**
 * Validates against the pinned form and writes the answer rows. The caller decides who the
 * respondent is (or that there is none, for an anonymous campaign).
 */
export async function submit(
  db: Db,
  departmentId: string,
  formKey: string,
  answers: AnswerMap,
  ctx: SubmitContext = {},
  draftId?: string,
) {
  const form = await resolveForm(db, departmentId, formKey, ctx.formVersion);
  const fields = fieldsOf(form);
  const parsed = zodFromFields(fields).safeParse(answers);
  if (!parsed.success) {
    const issues: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const path = i.path.join(".") || "_";
      (issues[path] ??= []).push(i.message);
    }
    throw new SubmissionValidationError(issues);
  }
  if (ctx.subject) await assertExists(db, ctx.subject);

  const now = new Date();
  const submittedAt = ctx.dayTruncated
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : now;
  const data = {
    departmentId,
    formDefinitionId: form.id,
    formVersion: form.version,
    campaignId: ctx.campaignId ?? null,
    campaignSubjectId: ctx.campaignSubjectId ?? null,
    subjectType: (ctx.subject?.subjectType ?? null) as never,
    subjectId: ctx.subject?.subjectId ?? null,
    stepKey: ctx.stepKey ?? null,
    respondentPersonId: ctx.respondentPersonId ?? null,
    invitationId: ctx.invitationId ?? null,
    respondentGroup: ctx.respondentGroup ?? null,
    cohortAttributesJson: ctx.cohortAttributes ? toJson(ctx.cohortAttributes) : undefined,
    pseudonymHash: ctx.pseudonymHash ?? null,
    status: "submitted" as const,
    submittedAt,
  };
  const submission = draftId
    ? await db.submission.update({
        where: { id: draftId },
        data: { ...data, rowVersion: { increment: 1 } },
      })
    : await db.submission.create({ data });
  await writeAnswers(db, departmentId, submission.id, fields, parsed.data as AnswerMap);
  await publish(
    db,
    "submission.submitted",
    { subjectType: "submission", subjectId: submission.id },
    {
      submissionId: submission.id,
      formKey,
      campaignId: ctx.campaignId ?? null,
      subject: ctx.subject ?? null,
      stepKey: ctx.stepKey ?? null,
    },
    { departmentId },
  );
  return submission;
}

/** Marks a submission withdrawn (kept for the audit trail; answers stay). */
export async function withdraw(db: Db, submissionId: string) {
  return db.submission.update({
    where: { id: submissionId },
    data: { status: "withdrawn", rowVersion: { increment: 1 } },
  });
}

export async function submissionWithAnswers(db: Db, submissionId: string) {
  return db.submission.findUnique({
    where: { id: submissionId },
    include: {
      answers: { orderBy: [{ questionStableKey: "asc" }, { groupIndex: "asc" }] },
      form: { include: { questions: { orderBy: { order: "asc" } } } },
    },
  });
}

/** The stored answers as the shape the renderer and `submit` accept. */
export function answersOf(
  rows: Array<{
    questionStableKey: string;
    groupIndex: number;
    valueJson: unknown;
    rank: number | null;
  }>,
  fields: FieldDef[],
): AnswerMap {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const subParent = new Map<string, string>();
  for (const f of fields) for (const sub of f.fields ?? []) subParent.set(sub.key, f.key);
  const out: AnswerMap = {};
  for (const row of rows) {
    const parent = subParent.get(row.questionStableKey);
    if (parent) {
      const list = (out[parent] as Record<string, unknown>[] | undefined) ?? [];
      list[row.groupIndex] = {
        ...(list[row.groupIndex] ?? {}),
        [row.questionStableKey]: row.valueJson,
      };
      out[parent] = list;
      continue;
    }
    const field = byKey.get(row.questionStableKey);
    if (!field) continue;
    if (field.type === "ranked_list") {
      const current = (out[field.key] as { order: string[] } | undefined) ?? { order: [] };
      current.order[(row.rank ?? 1) - 1] = String(row.valueJson);
      out[field.key] = current;
      continue;
    }
    if (field.type === "multi_choice" || field.type === "file") {
      const list = (out[field.key] as unknown[] | undefined) ?? [];
      list[row.groupIndex] = row.valueJson;
      out[field.key] = list;
      continue;
    }
    out[field.key] = row.valueJson;
  }
  return out;
}

/** Answers of a submission as template variables (`answer.<key>`). */
export async function answersAsVariables(
  db: Db,
  submissionId: string,
): Promise<Record<string, unknown>> {
  const submission = await submissionWithAnswers(db, submissionId);
  if (!submission) return {};
  const fields = fieldsOf(submission.form);
  const answers = answersOf(submission.answers, fields);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    out[`answer_${key}`] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Submissions bound to a subject (committee reports, step forms, ...). */
export async function submissionsFor(db: Db, subject: SubjectRef, stepKey?: string) {
  return db.submission.findMany({
    where: {
      subjectType: subject.subjectType as never,
      subjectId: subject.subjectId,
      ...(stepKey ? { stepKey } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
