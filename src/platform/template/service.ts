import type { TemplateKind } from "@/generated/prisma/enums";
import { z } from "zod";
import { fromJson, toJson } from "../../lib/db/json";
import { withTenantBypass, withTenantTx } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";
import {
  renderBody,
  validateBody,
  TemplateError,
  type DeclaredVariable,
  type Variant,
} from "./mustache-safe";

// Versioned templates: create/newVersion validate every variant against the declared
// variables; activate switches the pointer; render uses the active version of the department
// override or the faculty template.

export const ChannelVariants = z.object({
  inApp: z.string().optional(),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
  sms: z.string().optional(),
  document: z.string().optional(),
});
export type ChannelVariants = z.infer<typeof ChannelVariants>;

export const DeclaredVariables = z.array(
  z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    required: z.boolean(),
    type: z.string().optional(),
  }),
);

export interface TemplateVersionInput {
  variants: ChannelVariants;
  declaredVariables: DeclaredVariable[];
  locale?: string;
  createdBy?: string | null;
}

export interface CreateTemplateInput extends TemplateVersionInput {
  key: string;
  kind: TemplateKind;
  contextType?: string | null;
  departmentId?: string | null;
  isSystem?: boolean;
  activate?: boolean;
}

function assertValid(variants: ChannelVariants, declared: DeclaredVariable[]): void {
  DeclaredVariables.parse(declared);
  for (const [variant, body] of Object.entries(variants)) {
    if (!body) continue;
    const undeclared = validateBody(body, declared);
    if (undeclared.length)
      throw new TemplateError(
        `${variant} references undeclared variables: ${undeclared.join(", ")}`,
        "undeclared",
      );
  }
  if (!Object.values(variants).some((b) => b && b.trim()))
    throw new TemplateError("At least one channel variant is required", "syntax");
}

function scopedWrite<T>(
  departmentId: string | null,
  reason: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return departmentId
    ? withTenantTx(departmentId, fn)
    : withTenantBypass({ worker: true, jobName: "template" }, reason, fn);
}

/** Creates the template with version 1 (activated by default); idempotent on (departmentId, key). */
export async function createTemplate(input: CreateTemplateInput) {
  assertValid(input.variants, input.declaredVariables);
  const departmentId = input.departmentId ?? null;
  return scopedWrite(departmentId, `template ${input.key}`, async (tx) => {
    const existing = await tx.template.findFirst({ where: { departmentId, key: input.key } });
    if (existing) return existing;
    const t = await tx.template.create({
      data: {
        departmentId,
        key: input.key,
        kind: input.kind,
        contextType: (input.contextType ?? null) as never,
        isSystem: input.isSystem ?? false,
        activeVersion: input.activate === false ? null : 1,
      },
    });
    await tx.templateVersion.create({
      data: {
        templateId: t.id,
        version: 1,
        channelVariantsJson: toJson(input.variants),
        declaredVariablesJson: toJson(input.declaredVariables),
        locale: input.locale ?? "en",
        status: input.activate === false ? "draft" : "active",
        createdBy: input.createdBy ?? null,
      },
    });
    return t;
  });
}

/** Appends a draft version (validated). */
export async function newVersion(templateId: string, input: TemplateVersionInput) {
  assertValid(input.variants, input.declaredVariables);
  return withTenantBypass(
    { worker: true, jobName: "template" },
    `template version ${templateId}`,
    async (tx) => {
      const latest = await tx.templateVersion.findFirst({
        where: { templateId },
        orderBy: { version: "desc" },
      });
      return tx.templateVersion.create({
        data: {
          templateId,
          version: (latest?.version ?? 0) + 1,
          channelVariantsJson: toJson(input.variants),
          declaredVariablesJson: toJson(input.declaredVariables),
          locale: input.locale ?? "en",
          status: "draft",
          createdBy: input.createdBy ?? null,
        },
      });
    },
  );
}

/** Activates a version; the previous active one is retired but stays readable. */
export async function activateVersion(templateId: string, version: number) {
  return withTenantBypass(
    { worker: true, jobName: "template" },
    `activate template ${templateId} v${version}`,
    async (tx) => {
      const target = await tx.templateVersion.findUniqueOrThrow({
        where: { templateId_version: { templateId, version } },
      });
      await tx.templateVersion.updateMany({
        where: { templateId, status: "active" },
        data: { status: "retired" },
      });
      await tx.templateVersion.update({ where: { id: target.id }, data: { status: "active" } });
      return tx.template.update({ where: { id: templateId }, data: { activeVersion: version } });
    },
  );
}

export interface ResolvedTemplate {
  templateId: string;
  key: string;
  kind: TemplateKind;
  version: number;
  variants: ChannelVariants;
  declaredVariables: DeclaredVariable[];
}

/** The active version for a key: department override first, then the faculty template. */
export async function resolveTemplate(
  db: Db,
  key: string,
  departmentId: string | null,
): Promise<ResolvedTemplate | null> {
  const rows = await db.template.findMany({
    where: { key, OR: [{ departmentId }, { departmentId: null }] },
    include: { versions: { where: { status: "active" } } },
  });
  const t =
    rows.find((r) => r.departmentId === departmentId && r.versions.length) ??
    rows.find((r) => r.departmentId === null && r.versions.length);
  if (!t) return null;
  const v = t.versions[0]!;
  return {
    templateId: t.id,
    key: t.key,
    kind: t.kind,
    version: v.version,
    variants: fromJson<ChannelVariants>(v.channelVariantsJson),
    declaredVariables: fromJson<DeclaredVariable[]>(v.declaredVariablesJson),
  };
}

export interface Rendered {
  inApp?: string;
  emailSubject?: string;
  emailBody?: string;
  sms?: string;
  document?: string;
}

export function renderVariants(
  t: Pick<ResolvedTemplate, "variants" | "declaredVariables">,
  variables: Record<string, unknown>,
  only?: Variant[],
): Rendered {
  const out: Rendered = {};
  for (const [k, body] of Object.entries(t.variants) as Array<[Variant, string | undefined]>) {
    if (!body || (only && !only.includes(k))) continue;
    out[k] = renderBody(body, k, variables, t.declaredVariables);
  }
  return out;
}

/** Preview a version body with the declared variables filled by sample values. */
export function previewWithSample(
  variants: ChannelVariants,
  declared: DeclaredVariable[],
): Rendered {
  const sample: Record<string, unknown> = {};
  for (const d of declared)
    sample[d.name] =
      d.type === "list"
        ? [{ name: "item 1" }, { name: "item 2" }]
        : d.type === "number"
          ? 42
          : `{${d.name}}`;
  return renderVariants({ variants, declaredVariables: declared }, sample);
}

export async function listTemplates(db: Db, departmentId: string | null = null) {
  return db.template.findMany({
    where: { OR: [{ departmentId }, { departmentId: null }] },
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { key: "asc" },
  });
}
