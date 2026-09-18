import { z } from "zod";

// Zod input schemas shared by server actions and imports (dates arrive as ISO strings).

export const isoDate = z.coerce.date();
export const idString = z.string().min(1);

export const academicYearSchema = z.object({
  code: z.string().regex(/^\d{4}\/\d{2}$/, "Use the form 2026/27"),
  startDate: isoDate,
  endDate: isoDate,
});

export const termSchema = z.object({
  academicYearId: idString,
  ordinal: z.enum(["first", "second", "summer"]),
  name: z.string().min(1).max(60),
  startDate: isoDate,
  endDate: isoDate,
});

export const periodKindSchema = z.enum([
  "registration",
  "add_drop",
  "course_preference",
  "elective_selection",
  "teaching",
  "examination",
  "portfolio_submission",
  "evaluation",
  "custom",
]);

export const periodSchema = z.object({
  id: idString.optional(),
  termId: idString,
  kind: periodKindSchema,
  label: z.string().min(1).max(80),
  startAt: isoDate,
  endAt: isoDate,
});

export const programSchema = z.object({
  id: idString.optional(),
  code: z.string().min(2).max(12),
  name: z.string().min(2).max(120),
  degreeLevel: z.string().min(2).max(40),
  durationYears: z.coerce.number().int().min(1).max(8),
  gradeScaleKey: z.string().min(1).max(40).optional(),
});

export const courseSchema = z.object({
  id: idString.optional(),
  code: z.string().min(2).max(16),
  title: z.string().min(2).max(160),
  creditHours: z.coerce.number().min(0).max(30),
  courseType: z.enum(["core", "elective", "common"]),
  programId: z.string().optional().nullable(),
  predecessorCourseId: z.string().optional().nullable(),
  status: z.enum(["active", "retired"]).optional(),
});

export const sectionSchema = z.object({
  programId: idString,
  academicYearId: idString,
  yearLevel: z.coerce.number().int().min(1).max(8),
  code: z.string().min(1).max(20),
  capacity: z.coerce.number().int().positive().optional().nullable(),
});

export const offeringSchema = z.object({
  courseId: idString,
  termId: idString,
  coordinatorPersonId: z.string().optional().nullable(),
});

export const teachingSchema = z.object({
  sectionOfferingId: idString,
  personId: idString,
  role: z.enum(["lecture", "lab", "tutorial", "coordinator"]),
  loadHours: z.coerce.number().min(0).max(99).optional().nullable(),
  sharePercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
});

export const resourceSchema = z.object({
  id: idString.optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  kind: z.enum(["classroom", "computer_lab", "meeting_room", "office", "exam_hall", "other"]),
  building: z.string().max(80).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  responsiblePersonId: z.string().optional().nullable(),
  computerCount: z.coerce.number().int().min(0).optional().nullable(),
  softwareList: z.array(z.string()).optional(),
  status: z.enum(["available", "maintenance", "retired"]).optional(),
});
