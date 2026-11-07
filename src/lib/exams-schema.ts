import { z } from "zod";

export const EXAM_TYPES = [
  "UNIT_TEST",
  "MID_TERM",
  "FINAL",
  "MOCK_TEST",
  "PRACTICAL",
  "ASSIGNMENT",
  "CUSTOM",
] as const;

export const EXAM_TARGET_TYPES = ["CLASS_SECTION", "BATCH"] as const;

export const EXAM_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export const EXAM_ENROLLMENT_STATUSES = [
  "REGISTERED",
  "ELIGIBLE",
  "ABSENT",
  "EXEMPTED",
  "WITHDRAWN",
] as const;

export const EXAM_EVALUATION_STATUSES = [
  "PENDING",
  "DRAFT",
  "SUBMITTED",
  "VERIFIED",
] as const;

export const EXAM_RESULT_STATUSES = [
  "PASS",
  "FAIL",
  "WITHHELD",
  "EXPELLED",
] as const;

export const EXAM_RESULT_STATES = [
  "DRAFT",
  "COMPUTED",
  "VERIFIED",
  "PUBLISHED",
] as const;

export const createExaminationSchema = z
  .object({
    title: z.string().trim().min(2, "Title must be at least 2 characters").max(150),
    code: z
      .string()
      .trim()
      .min(2, "Code must be at least 2 characters")
      .max(50)
      .regex(/^[A-Z0-9_\-]+$/i, "Code can only contain letters, numbers, hyphens, and underscores"),
    examType: z.enum(EXAM_TYPES),
    targetType: z.enum(EXAM_TARGET_TYPES).default("CLASS_SECTION"),
    academicYearId: z.string().min(1, "Academic Year is required"),
    gradeScaleId: z.string().min(1, "Grading Scale is required"),
    syllabusTrackId: z.string().nullish().transform((v) => v || null),
    classId: z.string().nullish().transform((v) => v || null),
    sectionId: z.string().nullish().transform((v) => v || null),
    batchId: z.string().nullish().transform((v) => v || null),
    term: z.string().nullish().transform((v) => v || null),
    instructions: z.string().nullish().transform((v) => v || null),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  })
  .superRefine((data, ctx) => {
    const s = new Date(data.startDate);
    const e = new Date(data.endDate);
    if (isNaN(s.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start date", path: ["startDate"] });
    }
    if (isNaN(e.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end date", path: ["endDate"] });
    }
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e < s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after start date",
        path: ["endDate"],
      });
    }

    if (data.targetType === "CLASS_SECTION") {
      if (!data.classId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Class is required for Class/Section targeting",
          path: ["classId"],
        });
      }
      if (data.batchId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Batch must not be set for Class/Section targeting",
          path: ["batchId"],
        });
      }
    } else if (data.targetType === "BATCH") {
      if (!data.batchId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Batch is required for Batch targeting",
          path: ["batchId"],
        });
      }
      if (data.classId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Class must not be set for Batch targeting",
          path: ["classId"],
        });
      }
      if (data.sectionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Section must not be set for Batch targeting",
          path: ["sectionId"],
        });
      }
    }
  });

export const updateExaminationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(2).max(150),
    term: z.string().nullish().transform((v) => v || null),
    instructions: z.string().nullish().transform((v) => v || null),
    status: z.enum(EXAM_STATUSES).optional(),
    gradeScaleId: z.string().min(1).optional(),
    syllabusTrackId: z.string().nullish().transform((v) => v || null),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const s = new Date(data.startDate);
    const e = new Date(data.endDate);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e < s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after start date",
        path: ["endDate"],
      });
    }
  });

export const examSubjectItemSchema = z
  .object({
    subjectId: z.string().min(1, "Subject is required"),
    examDate: z.string().min(1, "Exam date is required"),
    startTime: z.string().nullish().transform((v) => v || null),
    endTime: z.string().nullish().transform((v) => v || null),
    roomNo: z.string().nullish().transform((v) => v || null),
    maxMarks: z.coerce.number().min(1, "Max marks must be at least 1").max(1000).default(100),
    passingMarks: z.coerce.number().min(0, "Passing marks must be >= 0").max(1000).default(35),
    weightage: z.coerce.number().min(0.1, "Weightage must be at least 0.1").max(10).default(1.0),
    order: z.coerce.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.passingMarks > data.maxMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passing marks cannot exceed maximum marks",
        path: ["passingMarks"],
      });
    }
  });

export const saveExamSubjectsSchema = z.object({
  examId: z.string().min(1),
  subjects: z.array(examSubjectItemSchema).min(1, "At least one subject is required"),
});

export const enrollStudentsSchema = z.object({
  examId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1, "At least one student must be selected"),
});

export const updateEnrollmentStatusSchema = z.object({
  enrollmentId: z.string().min(1),
  status: z.enum(EXAM_ENROLLMENT_STATUSES),
  remarks: z.string().nullish().transform((v) => v || null),
});

export const markEntryItemSchema = z
  .object({
    studentId: z.string().min(1),
    marksObtained: z.coerce.number().nullish().transform((v) => (v === undefined || isNaN(v as number) ? null : v)),
    isAbsent: z.boolean().default(false),
    isExempted: z.boolean().default(false),
    feedback: z.string().nullish().transform((v) => v || null),
  })
  .superRefine((data, ctx) => {
    if (data.isAbsent && data.isExempted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate cannot be marked both absent and exempted",
        path: ["isExempted"],
      });
    } else if (data.isAbsent || data.isExempted) {
      if (data.marksObtained !== null && data.marksObtained !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Absent or exempted student cannot have marks obtained",
          path: ["marksObtained"],
        });
      }
    } else if (data.marksObtained !== null && data.marksObtained < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Marks obtained cannot be negative",
        path: ["marksObtained"],
      });
    }
  });

export const bulkMarksEntrySchema = z.object({
  examId: z.string().min(1),
  examSubjectId: z.string().min(1),
  entries: z.array(markEntryItemSchema).min(1, "At least one mark entry is required"),
  reason: z.string().trim().min(3, "Reason for entry/revision must be provided").max(500),
  submitForVerification: z.boolean().default(false),
});

export const gradeBandItemSchema = z
  .object({
    letterGrade: z.string().trim().min(1, "Letter grade required").max(10),
    gradePoint: z.coerce.number().min(0).max(10),
    minPercentage: z.coerce.number().min(0).max(100),
    maxPercentage: z.coerce.number().min(0).max(100),
    isPassing: z.boolean().default(true),
    remarks: z.string().nullish().transform((v) => v || null),
    order: z.coerce.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.minPercentage > data.maxPercentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Min percentage cannot exceed max percentage",
        path: ["minPercentage"],
      });
    }
  });

export const createGradeScaleSchema = z
  .object({
    name: z.string().trim().min(2, "Scale name must be at least 2 characters").max(100),
    code: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[A-Z0-9_\-]+$/i, "Code can only contain letters, numbers, hyphens, and underscores"),
    description: z.string().nullish().transform((v) => v || null),
    isDefault: z.boolean().default(false),
    bands: z.array(gradeBandItemSchema).min(2, "At least 2 grade bands are required"),
  })
  .superRefine((data, ctx) => {
    // Sort bands by minPercentage ascending
    const sorted = [...data.bands].sort((a, b) => a.minPercentage - b.minPercentage);
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current.maxPercentage >= next.minPercentage) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Grade bands overlap between '${current.letterGrade}' (${current.minPercentage}-${current.maxPercentage}%) and '${next.letterGrade}' (${next.minPercentage}-${next.maxPercentage}%)`,
          path: ["bands"],
        });
        break;
      }
    }
  });

export const publishResultsSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
});

export const correctPublishedMarkSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
  examSubjectId: z.string().min(1, "Subject assessment ID is required"),
  studentId: z.string().min(1, "Student ID is required"),
  newMark: z.coerce.number().min(0, "Marks must be >= 0").max(1000, "Marks cannot exceed 1000"),
  expectedVersion: z.coerce.number().int().min(1, "Expected mark version must be an integer >= 1"),
  reason: z
    .string()
    .trim()
    .min(10, "A detailed justification (minimum 10 characters) is required for published result correction")
    .max(500),
});

export const transitionExamStatusSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
  requestedStatus: z.enum(EXAM_STATUSES),
  reason: z.string().trim().max(500).optional(),
  expectedCurrentStatus: z.enum(EXAM_STATUSES).optional(),
});

export const reopenEvaluatedExamSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
  reason: z.string().trim().min(10, "Justification of at least 10 characters required to reopen evaluation").max(500),
});

export const cancelExaminationSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
  reason: z.string().trim().min(10, "Cancellation justification of at least 10 characters is required").max(500),
});

export const archiveExaminationSchema = z.object({
  examId: z.string().min(1, "Exam ID is required"),
  reason: z.string().trim().max(500).optional(),
});

