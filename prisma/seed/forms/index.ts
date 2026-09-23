import type { PrismaClient } from "../../../src/generated/prisma/client";
import { withTenantBypass } from "../../../src/lib/db/tenant";
import { defineForm } from "../../../src/platform/forms/definitions";
import type { FieldDef } from "../../../src/platform/forms/field-schema";
import type { FormKind } from "../../../src/generated/prisma/enums";

// Faculty-wide system forms. Each phase appends the forms its module needs; a form is only
// re-versioned when its questions actually change (defineForm hashes them).

export interface SeedForm {
  key: string;
  kind: FormKind;
  title: string;
  description?: string;
  fields: FieldDef[];
}

const field = (f: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...f });

export const SEED_FORMS: SeedForm[] = [
  {
    key: "appointment_request",
    kind: "appointment_request",
    title: "Appointment request",
    description: "What the meeting is about, so the right people and time can be picked.",
    fields: [
      field({
        key: "topic",
        type: "short_text",
        label: "Topic",
        constraints: { required: true },
        locked: true,
      }),
      field({
        key: "details",
        type: "long_text",
        label: "What would you like to discuss?",
        constraints: { required: true },
      }),
      field({
        key: "urgency",
        type: "single_choice",
        label: "Urgency",
        options: [
          { value: "routine", label: "Routine" },
          { value: "soon", label: "Within the week" },
          { value: "urgent", label: "Urgent" },
        ],
        constraints: { required: true },
      }),
      field({
        key: "attachments",
        type: "file",
        label: "Supporting documents",
        constraints: { required: false, maxFiles: 3, accept: ["pdf", "docx"] },
      }),
    ],
  },
];

export async function seedForms(_db: PrismaClient): Promise<void> {
  for (const form of SEED_FORMS) {
    await withTenantBypass({ worker: true, jobName: "seed" }, `seed form ${form.key}`, (tx) =>
      defineForm(tx, {
        key: form.key,
        kind: form.kind,
        title: form.title,
        description: form.description ?? null,
        fields: form.fields,
        isSystem: true,
        departmentId: null,
        publish: true,
      }),
    );
  }
}
