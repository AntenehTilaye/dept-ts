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
  "FormDefinition.scoringJson": z.unknown(),
  "FormDefinition.lockedPathsJson": z.array(z.string()),
  "Question.optionsJson": z
    .array(z.object({ value: z.string(), label: z.string(), score: z.number().optional() }))
    .nullable(),
  "Question.bindingArgsJson": z.record(z.string(), z.unknown()).nullable(),
  "Question.constraintsJson": z.record(z.string(), z.unknown()).nullable(),
  "Submission.cohortAttributesJson": z.record(z.string(), z.unknown()).nullable(),
  "Answer.valueJson": z.unknown(),
  "Campaign.windowAnchorJson": z.object({
    opens: z.record(z.string(), z.unknown()),
    closes: z.record(z.string(), z.unknown()),
  }),
  "Campaign.audienceSpecJson": z.record(z.string(), z.unknown()),
  "Campaign.aggregationSpecJson": z
    .object({ groupBy: z.array(z.string()).optional(), textSamples: z.number().optional() })
    .nullable(),
  "Campaign.optionsJson": z.record(z.string(), z.unknown()),
  "CampaignSubject.evaluatorAudienceSpecJson": z.record(z.string(), z.unknown()).nullable(),
  "AggregationResult.groupByJson": z.record(z.string(), z.unknown()),
  "AggregationResult.statsJson": z.record(z.string(), z.unknown()),
  // The authored aggregate and its compiled artefacts are validated by their own schemas
  // (src/platform/feature/schema.ts, compile.ts) before they are written.
  "FeatureDefinitionVersion.json": z.record(z.string(), z.unknown()),
  "FeatureDefinitionVersion.compiledJson": z.record(z.string(), z.unknown()).nullable(),
  "FeatureRecord.data": z.record(z.string(), z.unknown()),
  "FeatureRecord.branchStatesCache": z.record(z.string(), z.unknown()).nullable(),
  "FeatureMigration.stateMap": z.record(z.string(), z.string()),
  "FeatureMigration.stepMap": z.record(z.string(), z.string()),
  "FeatureMigration.plan": z.record(z.string(), z.unknown()),
  "FeatureMigration.blockedIds": z.array(z.string()).nullable(),
  // Availability: a window is a weekday plus two "HH:MM" times, and a blackout is an interval
  // with a reason (src/platform/availability/schema.ts holds the parsed shapes).
  "AvailabilityPolicy.weeklyWindowsJson": z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
  "AvailabilityPolicy.breakWindowsJson": z.array(
    z.object({
      weekday: z.number().int().min(1).max(7).optional(),
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
  "AvailabilityPolicy.blackoutPeriodsJson": z.array(
    z.object({ fromAt: z.string(), toAt: z.string(), reason: z.string().optional() }),
  ),
  // Import: the summary the list and preview read, and one row as it arrived, as it was
  // understood and what is wrong with it (src/platform/import/pipeline.ts owns the shapes).
  "ImportBatch.summaryJson": z.record(z.string(), z.unknown()),
  "ImportRow.rawJson": z.record(z.string(), z.unknown()),
  "ImportRow.normalizedJson": z.record(z.string(), z.unknown()).nullable(),
  "ImportRow.errorsJson": z.array(
    z.object({ code: z.string(), field: z.string().optional(), message: z.string() }),
  ),
  "ImportRow.warningsJson": z.array(
    z.object({ code: z.string(), field: z.string().optional(), message: z.string() }),
  ),
  "ColumnMappingProfile.mappingsJson": z.record(z.string(), z.string()),
  "ColumnMappingProfile.headerAliasesJson": z.record(z.string(), z.array(z.string())),
  // Reporting: what a report asks for, what one run was asked for, and the columns another
  // system expects (src/platform/reporting owns the shapes).
  "ReportDefinition.parametersSchemaJson": z.record(z.string(), z.unknown()),
  "ReportDefinition.scheduleSpecJson": z.record(z.string(), z.unknown()).nullable(),
  "GeneratedReport.paramsJson": z.record(z.string(), z.unknown()),
  "ExportFormatSpec.columnsJson": z.array(
    z.object({
      header: z.string(),
      sourcePath: z.string(),
      transform: z.string().optional(),
      format: z.string().optional(),
      order: z.number().int(),
      required: z.boolean().optional(),
    }),
  ),
  // Search: the facets a filter narrows by (module, state, year, ...).
  "SearchIndexEntry.facetsJson": z.record(z.string(), z.unknown()),
};