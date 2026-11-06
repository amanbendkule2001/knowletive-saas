import { z } from "zod";

export const createBatchSchema = z
  .object({
    name: z.string().trim().min(2, "Batch name must be at least 2 characters").max(100),
    code: z
      .string()
      .trim()
      .min(1, "Batch code is required")
      .max(30)
      .regex(/^[A-Za-z0-9-_]+$/, "Batch code can only contain letters, numbers, hyphens, and underscores")
      .transform((c) => c.toUpperCase()),
    academicYearId: z.string().min(1, "Academic year is required"),
    subjectId: z.string().optional().nullable(),
    capacity: z.coerce.number().int().min(1, "Capacity must be at least 1").max(1000).default(30),
    status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    schedule: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
    teacherIds: z.array(z.string()).optional().default([]),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: "End date must be on or after start date",
      path: ["endDate"],
    }
  );

export const updateBatchSchema = z
  .object({
    name: z.string().trim().min(2, "Batch name must be at least 2 characters").max(100),
    code: z
      .string()
      .trim()
      .min(1, "Batch code is required")
      .max(30)
      .regex(/^[A-Za-z0-9-_]+$/, "Batch code can only contain letters, numbers, hyphens, and underscores")
      .transform((c) => c.toUpperCase()),
    academicYearId: z.string().min(1, "Academic year is required"),
    subjectId: z.string().optional().nullable(),
    capacity: z.coerce.number().int().min(1, "Capacity must be at least 1").max(1000),
    status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    schedule: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: "End date must be on or after start date",
      path: ["endDate"],
    }
  );

export const enrollStudentsSchema = z.object({
  batchId: z.string().min(1, "Batch ID is required"),
  studentIds: z.array(z.string()).min(1, "At least one student must be selected"),
});

export const dropStudentSchema = z.object({
  batchId: z.string().min(1, "Batch ID is required"),
  studentId: z.string().min(1, "Student ID is required"),
  reason: z.string().trim().max(300).optional().nullable(),
});

export const transferStudentSchema = z.object({
  fromBatchId: z.string().min(1, "Source batch ID is required"),
  toBatchId: z.string().min(1, "Destination batch ID is required"),
  studentId: z.string().min(1, "Student ID is required"),
  reason: z.string().trim().max(300).optional().nullable(),
});

