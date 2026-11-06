import { z } from "zod";

export const SyllabusTargetTypeEnum = z.enum(["CLASS_SECTION", "BATCH"]);
export const SyllabusStatusEnum = z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]);
export const TopicProgressStatusEnum = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]);
export const LessonPlanStatusEnum = z.enum(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

// ─────────────────────────────────────────────────────────────
// Syllabus Structure
// ─────────────────────────────────────────────────────────────

export const createSyllabusSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
    code: z
      .string()
      .trim()
      .min(2, "Code must be at least 2 characters")
      .max(30)
      .regex(/^[A-Za-z0-9-_]+$/, "Code may only contain letters, numbers, hyphens, and underscores"),
    description: z.string().trim().max(500).optional(),
    academicYearId: z.string().min(1, "Academic year is required"),
    subjectId: z.string().min(1, "Subject is required"),
    targetType: SyllabusTargetTypeEnum.default("CLASS_SECTION"),
    classId: z.string().optional().nullable(),
    sectionId: z.string().optional().nullable(),
    batchId: z.string().optional().nullable(),
    startDate: z.string().optional().nullable(),
    targetDate: z.string().optional().nullable(),
    teacherIds: z.array(z.string()).default([]),
  })
  .refine(
    (data) => {
      if (data.targetType === "CLASS_SECTION") {
        return !!data.classId;
      }
      if (data.targetType === "BATCH") {
        return !!data.batchId;
      }
      return true;
    },
    {
      message: "Please select a target class or batch based on target type",
      path: ["targetType"],
    }
  );

export type CreateSyllabusInput = z.infer<typeof createSyllabusSchema>;

export const updateSyllabusSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: SyllabusStatusEnum.optional(),
  startDate: z.string().optional().nullable(),
  targetDate: z.string().optional().nullable(),
  teacherIds: z.array(z.string()).optional(),
});

export type UpdateSyllabusInput = z.infer<typeof updateSyllabusSchema>;

// ─────────────────────────────────────────────────────────────
// Chapters
// ─────────────────────────────────────────────────────────────

export const createChapterSchema = z.object({
  syllabusId: z.string().min(1, "Syllabus ID is required"),
  title: z.string().trim().min(1, "Chapter title is required").max(150),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).default(0),
  estimatedHours: z.coerce.number().min(0).default(1),
  plannedStartDate: z.string().optional().nullable(),
  plannedEndDate: z.string().optional().nullable(),
});

export type CreateChapterInput = z.infer<typeof createChapterSchema>;

export const updateChapterSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).optional(),
  estimatedHours: z.coerce.number().min(0).optional(),
  plannedStartDate: z.string().optional().nullable(),
  plannedEndDate: z.string().optional().nullable(),
});

export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;

export const reorderChaptersSchema = z.object({
  syllabusId: z.string().min(1),
  chapterOrders: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(0),
    })
  ),
});

// ─────────────────────────────────────────────────────────────
// Topics
// ─────────────────────────────────────────────────────────────

export const createTopicSchema = z.object({
  syllabusId: z.string().min(1, "Syllabus ID is required"),
  chapterId: z.string().min(1, "Chapter ID is required"),
  title: z.string().trim().min(1, "Topic title is required").max(150),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).default(0),
  learningObjectives: z.string().trim().max(1000).optional().nullable(),
  estimatedMinutes: z.coerce.number().int().min(5).max(600).default(45),
  plannedDate: z.string().optional().nullable(),
});

export type CreateTopicInput = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  order: z.coerce.number().int().min(0).optional(),
  learningObjectives: z.string().trim().max(1000).optional().nullable(),
  estimatedMinutes: z.coerce.number().int().min(5).max(600).optional(),
  plannedDate: z.string().optional().nullable(),
});

export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

export const reorderTopicsSchema = z.object({
  chapterId: z.string().min(1),
  topicOrders: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(0),
    })
  ),
});

// ─────────────────────────────────────────────────────────────
// Lesson Plans
// ─────────────────────────────────────────────────────────────

export const createLessonPlanSchema = z.object({
  syllabusId: z.string().min(1),
  chapterId: z.string().min(1),
  topicId: z.string().min(1),
  title: z.string().trim().min(1, "Lesson title is required").max(150),
  objectives: z.string().trim().max(1000).optional().nullable(),
  methodology: z.string().trim().max(2000).optional().nullable(),
  materials: z.string().trim().max(1000).optional().nullable(),
  plannedDate: z.string().min(1, "Planned date is required"),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(45),
  homework: z.string().trim().max(1000).optional().nullable(),
});

export type CreateLessonPlanInput = z.infer<typeof createLessonPlanSchema>;

export const updateLessonPlanSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  objectives: z.string().trim().max(1000).optional().nullable(),
  methodology: z.string().trim().max(2000).optional().nullable(),
  materials: z.string().trim().max(1000).optional().nullable(),
  plannedDate: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
  completedDate: z.string().optional().nullable(),
  actualDurationMinutes: z.coerce.number().int().min(0).max(600).optional().nullable(),
  status: LessonPlanStatusEnum.optional(),
  remarks: z.string().trim().max(1000).optional().nullable(),
  homework: z.string().trim().max(1000).optional().nullable(),
});

export type UpdateLessonPlanInput = z.infer<typeof updateLessonPlanSchema>;

// ─────────────────────────────────────────────────────────────
// Progress Tracking
// ─────────────────────────────────────────────────────────────

export const updateTopicProgressSchema = z.object({
  syllabusId: z.string().min(1),
  topicId: z.string().min(1),
  status: TopicProgressStatusEnum,
  plannedDate: z.string().optional().nullable(),
  completedDate: z.string().optional().nullable(),
  completedHours: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export type UpdateTopicProgressInput = z.infer<typeof updateTopicProgressSchema>;

