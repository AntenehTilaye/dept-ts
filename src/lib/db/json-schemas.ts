import { z, type ZodType } from "zod";

// Every Prisma `Json` column has a Zod schema registered here under "<Model>.<field>".
// prisma/scripts/check-schema.ts fails when a Json column is missing from this map, and the
// services validate at the boundary before writing (Prisma Json is untyped).
export const jsonSchemas: Record<string, ZodType> = {
  "Department.settingsJson": z.record(z.string(), z.unknown()),
  "SystemSetting.valueJson": z.unknown(),
  "ProfileItem.detailsJson": z.record(z.string(), z.unknown()),
  "AcademicYear.quarterBoundariesJson": z
    .array(
      z.object({ q: z.number().int().min(1).max(4), startDate: z.string(), endDate: z.string() }),
    )
    .length(4),
  "Resource.attributesJson": z.record(z.string(), z.unknown()),
  "WorkflowDefinition.statesJson": z.array(z.record(z.string(), z.unknown())),
  "WorkflowDefinition.transitionsJson": z.array(z.record(z.string(), z.unknown())),
  "WorkflowDefinition.lockedPathsJson": z.array(z.string()),
  "WorkflowInstance.branchStates": z.record(z.string(), z.unknown()).nullable(),
  "WorkflowTransitionLog.payloadJson": z.unknown(),
  "AuditEvent.fieldChangesJson": z
    .record(z.string(), z.object({ before: z.unknown(), after: z.unknown() }))
    .nullable(),
  "AuditEvent.clientInfoJson": z.record(z.string(), z.unknown()).nullable(),
  "DomainEvent.payloadJson": z.unknown(),
  "ReminderSchedule.offsetsJson": z.array(
    z.object({
      offsetDays: z.number().int(),
      templateKey: z.string(),
      channels: z.array(z.enum(["in_app", "email", "sms"])),
    }),
  ),
  "ReminderSchedule.escalationJson": z
    .object({ afterOverdueDays: z.number().int().min(1), toRoleKey: z.string() })
    .nullable(),
  "ReminderSubscription.deadlineSpecJson": z.unknown(),
  "ReminderSubscription.audienceSpecJson": z.record(z.string(), z.unknown()),
  "ReminderSubscription.variablesJson": z.record(z.string(), z.unknown()),
  "ScheduledJob.payloadJson": z.unknown(),
  "Notification.renderedJson": z
    .object({
      emailSubject: z.string().optional(),
      emailBody: z.string().optional(),
      sms: z.string().optional(),
    })
    .nullable(),
  "ChannelPreference.quietHoursJson": z.object({ from: z.string(), to: z.string() }).nullable(),
  "TemplateVersion.channelVariantsJson": z.object({
    inApp: z.string().optional(),
    emailSubject: z.string().optional(),
    emailBody: z.string().optional(),
    sms: z.string().optional(),
    document: z.string().optional(),
  }),
  "TemplateVersion.declaredVariablesJson": z.array(
    z.object({ name: z.string(), required: z.boolean(), type: z.string().optional() }),
  ),
  "Task.expectedDeliverablesJson": z.array(
    z.object({ key: z.string(), label: z.string(), required: z.boolean().optional() }),
  ),
  "Task.deadlineAnchorJson": z.unknown(),
  "TaskAssignment.sourceAudienceSpecJson": z.record(z.string(), z.unknown()).nullable(),
};
