import type { AuditAction } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { currentAudit } from "./context";

export interface FieldChange {
  before: unknown;
  after: unknown;
}

export interface RecordInput {
  action: AuditAction;
  subjectType: string;
  subjectId: string;
  departmentId?: string | null;
  actorUserId?: string | null;
  fieldChanges?: Record<string, FieldChange> | null;
  reason?: string | null;
  correlationId?: string | null;
  clientInfo?: Record<string, unknown> | null;
}

/** Writes one AuditEvent row (explicit actions: login, export, denied, tenant_bypass, transition, ...). */
export async function record(db: Db, input: RecordInput) {
  const ctx = currentAudit();
  return db.auditEvent.create({
    data: {
      departmentId:
        input.departmentId === undefined ? (ctx?.departmentId ?? null) : input.departmentId,
      actorUserId: input.actorUserId === undefined ? (ctx?.actorUserId ?? null) : input.actorUserId,
      action: input.action,
      subjectType: input.subjectType as never,
      subjectId: input.subjectId,
      fieldChangesJson: input.fieldChanges ? toJson(input.fieldChanges) : undefined,
      reason: input.reason ?? null,
      correlationId:
        input.correlationId === undefined ? (ctx?.correlationId ?? null) : input.correlationId,
      clientInfoJson: input.clientInfo
        ? toJson(input.clientInfo)
        : ctx?.clientInfo
          ? toJson(ctx.clientInfo)
          : undefined,
    },
  });
}
