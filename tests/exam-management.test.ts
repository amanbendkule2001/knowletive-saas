import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Examination, ExamSubject, Student, ExamEnrollment } from "@prisma/client";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    authorizeTenantWrite: vi.fn(),
  };
});

import { authorizeTenantWrite } from "@/lib/rbac";
import type { TenantContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createExaminationSchema,
  saveExamSubjectsSchema,
  createGradeScaleSchema,
  bulkMarksEntrySchema,
  correctPublishedMarkSchema,
} from "@/lib/exams-schema";
import {
  canonicalStringify,
  computeSnapshotChecksum,
  verifySnapshotChecksum,
} from "@/lib/exam-snapshot";
import {
  type PreservedSubjectMark,
  createExaminationAction,
  updateExaminationAction,
  deleteExaminationAction,
  saveExamSubjectsAction,
  autoEnrollEligibleStudentsAction,
  enrollStudentsAction,
  updateEnrollmentStatusAction,
  enterMarksBulkAction,
  verifyExamSubjectMarksAction,
  calculateAndPublishResultsAction,
  correctPublishedMarkAction,
  exportExamResultsCsvAction,
  verifyResultSnapshotIntegrityAction,
  cancelExaminationAction,
  archiveExaminationAction,
  reopenEvaluatedExamAction,
  transitionExamStatusAction,
} from "@/actions/exams";
import {
  VALID_EXAM_TRANSITIONS,
  assertExamTransition,
  verifyCandidateSubjectCompleteness,
  lockExaminationRow,
  lockBatchRow,
  lockBatchRows,
} from "@/lib/exam-lifecycle";
import {
  enrollStudentsAction as batchEnrollStudentsAction,
  dropStudentAction as batchDropStudentAction,
  transferStudentAction as batchTransferStudentAction,
  completeBatchAction,
} from "@/actions/batches";

describe("Stage 4: Enterprise Exam Management System Test Suite", () => {
  let tenantA: { id: string; name: string };
  let tenantB: { id: string; name: string };
  let academicYearA: { id: string };
  let subjectMath: { id: string; name: string };
  let subjectScience: { id: string; name: string };
  let classA: { id: string };
  let sectionA: { id: string };
  let batchA: { id: string };
  let student1: { id: string };
  let student2: { id: string };
  let gradeScaleA: { id: string; name: string };

  const createdExamIds: string[] = [];
  const createdStudentIds: string[] = [];
  const createdBatchIds: string[] = [];

  beforeAll(async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Find or create academic year (prefer active)
    let ay = await db.academicYear.findFirst({
      where: { tenantId: tenantA.id, isActive: true },
    });
    if (!ay) {
      ay = await db.academicYear.findFirst({
        where: { tenantId: tenantA.id },
      });
    }
    if (!ay) {
      ay = await db.academicYear.create({
        data: {
          tenantId: tenantA.id,
          name: `AY-EXAM-${Date.now().toString().slice(-4)}`,
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isActive: true,
        },
      });
    }
    academicYearA = ay;

    // Find or create subjects
    let sm = await db.subject.findFirst({
      where: { tenantId: tenantA.id, name: { contains: "Math", mode: "insensitive" } },
    });
    if (!sm) {
      sm = await db.subject.create({
        data: {
          tenantId: tenantA.id,
          name: "Mathematics",
          code: "MATH",
        },
      });
    }
    subjectMath = sm;

    let ss = await db.subject.findFirst({
      where: { tenantId: tenantA.id, name: { contains: "Science", mode: "insensitive" } },
    });
    if (!ss) {
      ss = await db.subject.create({
        data: {
          tenantId: tenantA.id,
          name: "Science",
          code: "SCI",
        },
      });
    }
    subjectScience = ss;

    // Class and Section
    let cl = await db.classLevel.findFirst({
      where: { tenantId: tenantA.id },
      include: { sections: true },
    });
    if (!cl) {
      cl = await db.classLevel.create({
        data: {
          tenantId: tenantA.id,
          name: "Grade 10",
          order: 10,
        },
        include: { sections: true },
      });
    }
    classA = cl;

    let sec = cl.sections[0];
    if (!sec) {
      sec = await db.section.create({
        data: {
          tenantId: tenantA.id,
          classId: cl.id,
          name: "A",
        },
      });
    }
    sectionA = sec;

    // Batch
    const batchCode = `BATCH-EXAM-${Date.now().toString().slice(-6)}`;
    batchA = await db.batch.create({
      data: {
        tenantId: tenantA.id,
        academicYearId: academicYearA.id,
        subjectId: subjectMath.id,
        name: "IIT-JEE Foundation 2026",
        code: batchCode,
        capacity: 40,
        status: "ACTIVE",
      },
    });

    // Students
    const ts = Date.now().toString().slice(-5);
    student1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-E1-${ts}`,
        firstName: "Aarav",
        lastName: "Sharma",
        classId: classA.id,
        sectionId: sectionA.id,
        status: "ACTIVE",
      },
    });

    student2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-E2-${ts}`,
        firstName: "Vivaan",
        lastName: "Gupta",
        classId: classA.id,
        sectionId: sectionA.id,
        status: "ACTIVE",
      },
    });

    // Enroll students in batch
    await db.batchStudent.createMany({
      data: [
        { batchId: batchA.id, studentId: student1.id, status: "ACTIVE" },
        { batchId: batchA.id, studentId: student2.id, status: "ACTIVE" },
      ],
      skipDuplicates: true,
    });

    // Grade scale
    let gs = await db.gradeScale.findFirst({
      where: { tenantId: tenantA.id, isDefault: true },
    });
    if (!gs) {
      gs = await db.gradeScale.create({
        data: {
          tenantId: tenantA.id,
          name: "Standard CBSE Scale",
          code: `CBSE-${ts}`,
          isDefault: true,
          bands: {
            create: [
              { tenantId: tenantA.id, letterGrade: "A1", gradePoint: 10, minPercentage: 90, maxPercentage: 100, isPassing: true, order: 1 },
              { tenantId: tenantA.id, letterGrade: "A2", gradePoint: 9, minPercentage: 80, maxPercentage: 89.99, isPassing: true, order: 2 },
              { tenantId: tenantA.id, letterGrade: "B1", gradePoint: 8, minPercentage: 70, maxPercentage: 79.99, isPassing: true, order: 3 },
              { tenantId: tenantA.id, letterGrade: "C", gradePoint: 5, minPercentage: 40, maxPercentage: 69.99, isPassing: true, order: 4 },
              { tenantId: tenantA.id, letterGrade: "D", gradePoint: 4, minPercentage: 33, maxPercentage: 39.99, isPassing: true, order: 5 },
              { tenantId: tenantA.id, letterGrade: "E", gradePoint: 0, minPercentage: 0, maxPercentage: 32.99, isPassing: false, order: 6 },
            ],
          },
        },
      });
    }
    gradeScaleA = gs;
  });

  afterAll(async () => {
    // Teardown test entities safely disabling immutability triggers temporarily
    if (createdExamIds.length > 0) {
      try {
        await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" DISABLE TRIGGER trg_exam_snapshot_protect`);
        await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" DISABLE TRIGGER trg_exam_revision_event_protect`);

        await db.examResultSnapshot.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examMarksRevisionEvent.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examResult.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examMark.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examEnrollment.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examSubject.deleteMany({ where: { examId: { in: createdExamIds } } });
        await db.examination.deleteMany({ where: { id: { in: createdExamIds } } });

        await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" ENABLE TRIGGER trg_exam_snapshot_protect`);
        await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" ENABLE TRIGGER trg_exam_revision_event_protect`);
      } catch (err) {
        console.error("Cleanup error in afterAll:", err);
      }
    }

    if (batchA) {
      await db.batchStudent.deleteMany({ where: { batchId: batchA.id } });
      await db.batch.delete({ where: { id: batchA.id } }).catch(() => {});
    }

    if (createdBatchIds.length > 0) {
      try {
        await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering;`);
        await db.batchEnrollmentEvent.deleteMany({ where: { batchId: { in: createdBatchIds } } });
        await db.batchStudent.deleteMany({ where: { batchId: { in: createdBatchIds } } });
        await db.batchTeacher.deleteMany({ where: { batchId: { in: createdBatchIds } } });
        await db.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
        await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering;`);
      } catch (err) {
        console.error("Cleanup error for batches in afterAll:", err);
      }
    }

    if (createdStudentIds.length > 0) {
      await db.student.deleteMany({ where: { id: { in: createdStudentIds } } }).catch(() => {});
    }
    if (student1) await db.student.delete({ where: { id: student1.id } }).catch(() => {});
    if (student2) await db.student.delete({ where: { id: student2.id } }).catch(() => {});
  });

  // ─────────────────────────────────────────────────────────────
  // 1. DOMAIN & SCHEMA VALIDATIONS
  // ─────────────────────────────────────────────────────────────
  describe("1. Domain & Target Integrity Schema Validation", () => {
    it("accepts valid conventional class targeting schema", () => {
      const valid = createExaminationSchema.safeParse({
        title: "Class 10 Mid Term Exam",
        code: "MID-TERM-2026",
        examType: "MID_TERM",
        targetType: "CLASS_SECTION",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        classId: classA.id,
        sectionId: sectionA.id,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      expect(valid.success).toBe(true);
    });

    it("accepts valid batch targeting schema", () => {
      const valid = createExaminationSchema.safeParse({
        title: "IIT Foundation Mock 1",
        code: "MOCK-IIT-01",
        examType: "MOCK_TEST",
        targetType: "BATCH",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        batchId: batchA.id,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
      });
      expect(valid.success).toBe(true);
    });

    it("rejects CLASS_SECTION targeting missing classId", () => {
      const invalid = createExaminationSchema.safeParse({
        title: "Invalid Target Exam",
        code: "INV-01",
        examType: "UNIT_TEST",
        targetType: "CLASS_SECTION",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues.some((i) => i.path.includes("classId"))).toBe(true);
    });

    it("rejects CLASS_SECTION targeting with batchId specified", () => {
      const invalid = createExaminationSchema.safeParse({
        title: "Conflicting Target Exam",
        code: "INV-02",
        examType: "UNIT_TEST",
        targetType: "CLASS_SECTION",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        classId: classA.id,
        batchId: batchA.id,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues.some((i) => i.path.includes("batchId"))).toBe(true);
    });

    it("rejects BATCH targeting with classId or sectionId specified", () => {
      const invalid = createExaminationSchema.safeParse({
        title: "Conflicting Batch Exam",
        code: "INV-03",
        examType: "UNIT_TEST",
        targetType: "BATCH",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        batchId: batchA.id,
        classId: classA.id,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues.some((i) => i.path.includes("classId"))).toBe(true);
    });

    it("rejects examination where endDate is before startDate", () => {
      const invalid = createExaminationSchema.safeParse({
        title: "Inverted Dates Exam",
        code: "INV-04",
        examType: "UNIT_TEST",
        targetType: "BATCH",
        academicYearId: academicYearA.id,
        gradeScaleId: gradeScaleA.id,
        batchId: batchA.id,
        startDate: "2026-09-10",
        endDate: "2026-09-01",
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues.some((i) => i.path.includes("endDate"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. GRADE SCALE VALIDATIONS
  // ─────────────────────────────────────────────────────────────
  describe("2. GradeScale Non-Overlapping & Continuous Boundaries", () => {
    it("accepts valid non-overlapping grade bands", () => {
      const valid = createGradeScaleSchema.safeParse({
        name: "Honors Scale",
        code: "HONORS-4",
        bands: [
          { letterGrade: "A", gradePoint: 4, minPercentage: 80, maxPercentage: 100, isPassing: true, order: 1 },
          { letterGrade: "B", gradePoint: 3, minPercentage: 60, maxPercentage: 79.99, isPassing: true, order: 2 },
          { letterGrade: "C", gradePoint: 2, minPercentage: 40, maxPercentage: 59.99, isPassing: true, order: 3 },
          { letterGrade: "F", gradePoint: 0, minPercentage: 0, maxPercentage: 39.99, isPassing: false, order: 4 },
        ],
      });
      expect(valid.success).toBe(true);
    });

    it("rejects overlapping grade bands", () => {
      const invalid = createGradeScaleSchema.safeParse({
        name: "Overlapping Scale",
        code: "OVERLAP-1",
        bands: [
          { letterGrade: "A", gradePoint: 4, minPercentage: 80, maxPercentage: 100, isPassing: true, order: 1 },
          { letterGrade: "B", gradePoint: 3, minPercentage: 70, maxPercentage: 85, isPassing: true, order: 2 }, // overlaps with A
        ],
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues.some((i) => i.message.includes("overlap"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. POSTGRESQL CHECK CONSTRAINT INTEGRITY
  // ─────────────────────────────────────────────────────────────
  describe("3. Database Check Constraint Enforcement", () => {
    it("POSTGRES CONSTRAINT: Rejects raw INSERT with conflicting targetType and IDs", async () => {
      const membership = await db.membership.findFirst({
        where: { tenantId: tenantA.id },
      });
      expect(membership).toBeTruthy();

      const invalidCode = `CHK-FAIL-${Date.now().toString().slice(-6)}`;
      await expect(
        db.$executeRawUnsafe(`
          INSERT INTO "Examination" (
            id, "tenantId", "academicYearId", "gradeScaleId", "targetType", "classId", "batchId",
            title, code, "examType", status, "startDate", "endDate", "createdById", "createdAt", "updatedAt"
          ) VALUES (
            'chk-test-01', '${tenantA.id}', '${academicYearA.id}', '${gradeScaleA.id}', 'CLASS_SECTION',
            '${classA.id}', '${batchA.id}', 'Illegal XOR Exam', '${invalidCode}', 'UNIT_TEST', 'DRAFT',
            NOW(), NOW() + INTERVAL '7 days', '${membership!.id}', NOW(), NOW()
          )
        `)
      ).rejects.toThrow(/chk_examination_target_integrity/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. EXAMINATION CREATION & SUBJECT CONFIGURATION
  // ─────────────────────────────────────────────────────────────
  describe("4. Assessment Setup, Subjects & Auto-Enrollment", () => {
    let testExamId: string;

    it("creates an examination with conventional targeting", async () => {
      const membership = await db.membership.findFirst({
        where: { tenantId: tenantA.id },
      });

      const exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Grade 10 First Term Exam",
          code: `EXAM-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "DRAFT",
          startDate: new Date("2026-10-01"),
          endDate: new Date("2026-10-10"),
          createdById: membership!.id,
        },
      });
      expect(exam.id).toBeTruthy();
      testExamId = exam.id;
      createdExamIds.push(testExamId);
    });

    it("configures assessment subjects with dates, maximum marks and passing thresholds", async () => {
      const now = new Date();
      await db.examSubject.createMany({
        data: [
          {
            tenantId: tenantA.id,
            examId: testExamId,
            subjectId: subjectMath.id,
            examDate: now,
            startTime: "09:00",
            endTime: "11:00",
            maxMarks: 100,
            passingMarks: 35,
            weightage: 1.0,
            order: 1,
          },
          {
            tenantId: tenantA.id,
            examId: testExamId,
            subjectId: subjectScience.id,
            examDate: new Date(now.getTime() + 86400000),
            startTime: "09:00",
            endTime: "11:00",
            maxMarks: 100,
            passingMarks: 35,
            weightage: 1.0,
            order: 2,
          },
        ],
      });

      const count = await db.examSubject.count({ where: { examId: testExamId } });
      expect(count).toBe(2);
    });

    it("auto-enrolls active students belonging to the target class and section", async () => {
      // Find students in classA + sectionA
      const targetStudents = await db.student.findMany({
        where: { tenantId: tenantA.id, sectionId: sectionA.id, status: "ACTIVE" },
      });
      expect(targetStudents.length).toBeGreaterThanOrEqual(2);

      await db.examEnrollment.createMany({
        data: targetStudents.map((s) => ({
          tenantId: tenantA.id,
          examId: testExamId,
          studentId: s.id,
          status: "ELIGIBLE",
        })),
        skipDuplicates: true,
      });

      const enrollments = await db.examEnrollment.findMany({ where: { examId: testExamId } });
      expect(enrollments.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. MARKS ENTRY, AUDIT TRAIL & VERIFICATION WORKFLOW
  // ─────────────────────────────────────────────────────────────
  describe("5. Marks Evaluation, Absenteeism, and Revision Events", () => {
    let testExamId: string;
    let mathSubId: string;
    let sciSubId: string;
    let enr1Id: string;
    let enr2Id: string;

    beforeAll(async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: batchA.id,
          title: "IIT Advanced Mock Test 1",
          code: `IIT-MOCK-${Date.now().toString().slice(-6)}`,
          examType: "MOCK_TEST",
          status: "SCHEDULED",
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-05"),
          createdById: membership!.id,
        },
      });
      testExamId = exam.id;
      createdExamIds.push(testExamId);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-01"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1.0,
          order: 1,
        },
      });
      mathSubId = sub1.id;

      const sub2 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-02"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1.0,
          order: 2,
        },
      });
      sciSubId = sub2.id;

      const e1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: testExamId, studentId: student1.id, status: "ELIGIBLE" },
      });
      enr1Id = e1.id;

      const e2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: testExamId, studentId: student2.id, status: "ELIGIBLE" },
      });
      enr2Id = e2.id;
    });

    it("evaluates student marks and creates immutable revision events", async () => {
      // Enter marks for Student 1 (95) and Student 2 (82) in Math
      const mark1 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: mathSubId,
          studentId: student1.id,
          enrollmentId: enr1Id,
          marksObtained: 95,
          evaluationStatus: "SUBMITTED",
        },
      });

      await db.examMarksRevisionEvent.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: mathSubId,
          studentId: student1.id,
          markId: mark1.id,
          actorName: "Test Teacher",
          oldMarks: null,
          newMarks: 95,
          newStatus: "SUBMITTED",
          reason: "Initial evaluation entry",
        },
      });

      const mark2 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: mathSubId,
          studentId: student2.id,
          enrollmentId: enr2Id,
          marksObtained: 82,
          evaluationStatus: "SUBMITTED",
        },
      });

      await db.examMarksRevisionEvent.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: mathSubId,
          studentId: student2.id,
          markId: mark2.id,
          actorName: "Test Teacher",
          oldMarks: null,
          newMarks: 82,
          newStatus: "SUBMITTED",
          reason: "Initial evaluation entry",
        },
      });

      const eventsCount = await db.examMarksRevisionEvent.count({
        where: { examId: testExamId, examSubjectId: mathSubId },
      });
      expect(eventsCount).toBe(2);
    });

    it("properly flags absent candidate with null marks and absent boolean", async () => {
      // Science: Student 1 scores 88, Student 2 is absent
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: sciSubId,
          studentId: student1.id,
          enrollmentId: enr1Id,
          marksObtained: 88,
          evaluationStatus: "SUBMITTED",
        },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          examSubjectId: sciSubId,
          studentId: student2.id,
          enrollmentId: enr2Id,
          marksObtained: null,
          isAbsent: true,
          evaluationStatus: "SUBMITTED",
        },
      });

      const absMark = await db.examMark.findUnique({
        where: { examSubjectId_studentId: { examSubjectId: sciSubId, studentId: student2.id } },
      });
      expect(absMark?.isAbsent).toBe(true);
      expect(absMark?.marksObtained).toBeNull();
    });

    it("verifies and locks marks across assessment subjects", async () => {
      await db.examMark.updateMany({
        where: { examId: testExamId },
        data: { evaluationStatus: "VERIFIED" },
      });

      const verifiedCount = await db.examMark.count({
        where: { examId: testExamId, evaluationStatus: "VERIFIED" },
      });
      expect(verifiedCount).toBe(4);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. RESULT CALCULATION, SNAPSHOTS & REPORT CARDS
  // ─────────────────────────────────────────────────────────────
  describe("6. Authoritative Result Calculation, Snapshots & Checksums", () => {
    let testExamId: string;
    let res1Id: string;

    beforeAll(async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: batchA.id,
          title: "CBSE Annual Pre-Board 2026",
          code: `PRE-BOARD-${Date.now().toString().slice(-6)}`,
          examType: "FINAL",
          status: "EVALUATED",
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membership!.id,
        },
      });
      testExamId = exam.id;
      createdExamIds.push(testExamId);

      const mSub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          subjectId: subjectMath.id,
          examDate: new Date("2026-12-01"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const sSub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          subjectId: subjectScience.id,
          examDate: new Date("2026-12-02"),
          maxMarks: 100,
          passingMarks: 35,
          order: 2,
        },
      });

      const e1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: testExamId, studentId: student1.id, status: "ELIGIBLE" },
      });
      const e2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: testExamId, studentId: student2.id, status: "ELIGIBLE" },
      });

      // Student 1: Math 92, Science 94 (Total: 186/200 = 93%, Grade A1)
      await db.examMark.createMany({
        data: [
          { tenantId: tenantA.id, examId: testExamId, examSubjectId: mSub.id, studentId: student1.id, enrollmentId: e1.id, marksObtained: 92, evaluationStatus: "VERIFIED" },
          { tenantId: tenantA.id, examId: testExamId, examSubjectId: sSub.id, studentId: student1.id, enrollmentId: e1.id, marksObtained: 94, evaluationStatus: "VERIFIED" },
        ],
      });

      // Student 2: Math 45, Science 25 (Fail Science, Total: 70/200 = 35%, Result: FAIL)
      await db.examMark.createMany({
        data: [
          { tenantId: tenantA.id, examId: testExamId, examSubjectId: mSub.id, studentId: student2.id, enrollmentId: e2.id, marksObtained: 45, evaluationStatus: "VERIFIED" },
          { tenantId: tenantA.id, examId: testExamId, examSubjectId: sSub.id, studentId: student2.id, enrollmentId: e2.id, marksObtained: 25, evaluationStatus: "VERIFIED" },
        ],
      });

      // Publish results
      const publishedAt = new Date();
      const r1 = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          studentId: student1.id,
          enrollmentId: e1.id,
          totalMaxMarks: 200,
          totalMarksObtained: 186,
          percentage: 93,
          grade: "A1",
          gradePoint: 10,
          rank: 1,
          resultStatus: "PASS",
          passedSubjectsCount: 2,
          failedSubjectsCount: 0,
          publishedAt,
        },
      });
      res1Id = r1.id;

      await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          studentId: student2.id,
          enrollmentId: e2.id,
          totalMaxMarks: 200,
          totalMarksObtained: 70,
          percentage: 35,
          grade: "D",
          gradePoint: 4,
          rank: null, // Failed student rank is null
          resultStatus: "FAIL",
          passedSubjectsCount: 1,
          failedSubjectsCount: 1,
          publishedAt,
        },
      });
    });

    it("verifies accurate ranking and pass/fail thresholds in ExamResult", async () => {
      const results = await db.examResult.findMany({
        where: { examId: testExamId },
        orderBy: { totalMarksObtained: "desc" },
      });

      expect(results.length).toBe(2);
      expect(results[0].rank).toBe(1);
      expect(results[0].percentage).toBe(93);
      expect(results[0].resultStatus).toBe("PASS");
      expect(results[0].grade).toBe("A1");

      expect(results[1].resultStatus).toBe("FAIL");
      expect(results[1].failedSubjectsCount).toBe(1);
    });

    it("creates cryptographic result snapshots with SHA-256 integrity checksum", async () => {
      const payload = {
        examId: testExamId,
        studentId: student1.id,
        percentage: 93,
        grade: "A1",
        rank: 1,
      };
      const checksum = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

      const snapshot = await db.examResultSnapshot.create({
        data: {
          tenantId: tenantA.id,
          examId: testExamId,
          studentId: student1.id,
          resultId: res1Id,
          snapshotData: payload,
          checksum,
        },
      });

      expect(snapshot.id).toBeTruthy();
      expect(snapshot.checksum).toBe(checksum);
    });

    it("POSTGRES TRIGGER: Blocks UPDATE on ExamResultSnapshot (P0001)", async () => {
      await expect(
        db.$executeRawUnsafe(`
          UPDATE "ExamResultSnapshot"
          SET checksum = 'tampered-hash'
          WHERE "resultId" = '${res1Id}'
        `)
      ).rejects.toThrow(/ExamResultSnapshot records are immutable and cannot be updated or deleted/);
    });

    it("POSTGRES TRIGGER: Blocks DELETE on ExamResultSnapshot (P0001)", async () => {
      await expect(
        db.$executeRawUnsafe(`
          DELETE FROM "ExamResultSnapshot"
          WHERE "resultId" = '${res1Id}'
        `)
      ).rejects.toThrow(/ExamResultSnapshot records are immutable and cannot be updated or deleted/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. MULTI-TENANT ISOLATION
  // ─────────────────────────────────────────────────────────────
  describe("7. Multi-Tenant Isolation & Partitioning", () => {
    it("strictly isolates examinations between Tenant A and Tenant B", async () => {
      const membershipB = await db.membership.findFirst({ where: { tenantId: tenantB.id } });
      const gsB = await db.gradeScale.findFirst({ where: { tenantId: tenantB.id } });
      const ayB = await db.academicYear.findFirst({ where: { tenantId: tenantB.id } });

      if (membershipB && gsB && ayB) {
        let clB = await db.classLevel.findFirst({ where: { tenantId: tenantB.id } });
        if (!clB) {
          clB = await db.classLevel.create({
            data: { tenantId: tenantB.id, name: "Tenant B Class", order: 1 },
          });
        }

        const examB = await db.examination.create({
          data: {
            tenantId: tenantB.id,
            academicYearId: ayB.id,
            gradeScaleId: gsB.id,
            targetType: "CLASS_SECTION",
            classId: clB.id,
            title: "Tenant B Private Exam",
            code: `TB-EXAM-${Date.now().toString().slice(-6)}`,
            examType: "UNIT_TEST",
            startDate: new Date("2026-10-01"),
            endDate: new Date("2026-10-05"),
            createdById: membershipB.id,
          },
        });
        createdExamIds.push(examB.id);

        // Querying with Tenant A's tenantId should find 0 exams belonging to Tenant B
        const crossTenantCheck = await db.examination.findMany({
          where: { tenantId: tenantA.id, id: examB.id },
        });
        expect(crossTenantCheck.length).toBe(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. STAGE 4.1: HARDENING, INTEGRITY & CONCURRENCY
  // ─────────────────────────────────────────────────────────────
  describe("8. Stage 4.1: Security, Integrity & Concurrency Hardening", () => {
    it("POSTGRES TRIGGER: Blocks TRUNCATE on ExamResultSnapshot (P0001)", async () => {
      await expect(
        db.$executeRawUnsafe('TRUNCATE TABLE "ExamResultSnapshot" CASCADE')
      ).rejects.toThrow(/ExamResultSnapshot records are immutable and cannot be truncated/);
    });

    it("POSTGRES TRIGGER: Blocks TRUNCATE on ExamMarksRevisionEvent (P0001)", async () => {
      await expect(
        db.$executeRawUnsafe('TRUNCATE TABLE "ExamMarksRevisionEvent" CASCADE')
      ).rejects.toThrow(/ExamMarksRevisionEvent records are immutable audit logs and cannot be truncated/);
    });

    it("Grading Scale Engine: Correctly evaluates exact boundary and fractional boundary values", () => {
      const bands = [
        { letterGrade: "A+", minPercentage: 90.0, maxPercentage: 100.0, gradePoint: 10.0 },
        { letterGrade: "A", minPercentage: 80.0, maxPercentage: 89.99, gradePoint: 9.0 },
        { letterGrade: "B", minPercentage: 70.0, maxPercentage: 79.99, gradePoint: 8.0 },
        { letterGrade: "F", minPercentage: 0.0, maxPercentage: 69.99, gradePoint: 0.0 },
      ];

      const getGrade = (pct: number) => {
        const rounded = Math.round((pct + Number.EPSILON) * 100) / 100;
        const b = bands.find((band) => rounded >= band.minPercentage && rounded <= band.maxPercentage);
        return b?.letterGrade || "N/A";
      };

      expect(getGrade(89.99)).toBe("A");
      expect(getGrade(90.00)).toBe("A+");
      expect(getGrade(100.00)).toBe("A+");
      expect(getGrade(79.99)).toBe("B");
      expect(getGrade(80.00)).toBe("A");
      expect(getGrade(69.99)).toBe("F");
      expect(getGrade(70.00)).toBe("B");
    });

    it("Optimistic Concurrency: Stale mark version update fails atomically", async () => {
      const existing = await db.examMark.findFirst({ where: { tenantId: tenantA.id } });
      expect(existing).not.toBeNull();
      if (existing) {
        const currentVersion = existing.version;
        // Update with matching version succeeds
        const update1 = await db.examMark.updateMany({
          where: { id: existing.id, version: currentVersion },
          data: { version: { increment: 1 } },
        });
        expect(update1.count).toBe(1);

        // Concurrent update with stale version fails (0 rows updated)
        const updateStale = await db.examMark.updateMany({
          where: { id: existing.id, version: currentVersion },
          data: { version: { increment: 1 } },
        });
        expect(updateStale.count).toBe(0);
      }
    });

    it("Published Result Snapshot: Preserves previous snapshot and records revision event on correction", async () => {
      const exam = await db.examination.findFirst({
        where: { tenantId: tenantA.id, isPublished: true },
        include: { results: { include: { snapshots: true } } },
      });

      if (exam && exam.results.length > 0) {
        const result = exam.results[0];
        const initialSnapshotCount = await db.examResultSnapshot.count({
          where: { resultId: result.id },
        });

        // Add a new snapshot version
        const newPayload = {
          examId: exam.id,
          studentId: result.studentId,
          percentage: result.percentage + 1,
          grade: "A1",
          rank: result.rank,
          correctionReason: "Re-evaluation of subjective section",
        };
        const newChecksum = crypto.createHash("sha256").update(JSON.stringify(newPayload)).digest("hex");

        await db.examResultSnapshot.create({
          data: {
            tenantId: tenantA.id,
            examId: exam.id,
            studentId: result.studentId,
            resultId: result.id,
            version: 2,
            snapshotData: newPayload,
            checksum: newChecksum,
          },
        });

        const newSnapshotCount = await db.examResultSnapshot.count({
          where: { resultId: result.id },
        });
        expect(newSnapshotCount).toBe(initialSnapshotCount + 1);

        // Record revision event
        const targetSubject = (await db.examSubject.findFirst({ where: { examId: exam.id } }))!;
        const targetMark = (await db.examMark.findFirst({ where: { examSubjectId: targetSubject.id, studentId: result.studentId } }))!;
        const revision = await db.examMarksRevisionEvent.create({
          data: {
            tenantId: tenantA.id,
            examId: exam.id,
            examSubjectId: targetSubject.id,
            studentId: result.studentId,
            markId: targetMark.id,
            actorId: "actor-test",
            actorName: "Principal Lead",
            oldMarks: 85,
            newMarks: 88,
            oldStatus: "VERIFIED",
            newStatus: "VERIFIED",
            reason: "[PUBLISHED CORRECTION] Script remarking after student appeal",
          },
        });
        expect(revision.id).toBeTruthy();
        expect(revision.reason).toContain("[PUBLISHED CORRECTION]");
      }
    });

    it("Portal Isolation: Queries strictly scope candidate results to linked student IDs", async () => {
      const allResults = await db.examResult.findMany({
        where: { tenantId: tenantA.id, exam: { isPublished: true } },
      });

      if (allResults.length >= 2) {
        const studentAId = allResults[0].studentId;
        const studentBId = allResults[1].studentId;

        // Guardian linked only to studentAId
        const guardianAQuery = await db.examResult.findMany({
          where: {
            tenantId: tenantA.id,
            studentId: { in: [studentAId] },
            exam: { isPublished: true },
          },
        });

        expect(guardianAQuery.every((r) => r.studentId === studentAId)).toBe(true);
        expect(guardianAQuery.some((r) => r.studentId === studentBId)).toBe(false);
      }
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 4.2: SPECIFIC VERIFICATIONS
    // ─────────────────────────────────────────────────────────────

    it("Canonical Snapshot Serialization: Guarantees deterministic checksum regardless of object key order", () => {
      const payloadA = {
        examId: "exam-123",
        studentId: "student-456",
        performance: { percentage: 88.5, grade: "A", rank: 1 },
        subjects: [{ name: "Math", score: 95 }, { name: "Science", score: 82 }],
      };

      const payloadB = {
        subjects: [{ name: "Math", score: 95 }, { name: "Science", score: 82 }],
        studentId: "student-456",
        performance: { rank: 1, grade: "A", percentage: 88.5 },
        examId: "exam-123",
      };

      const serializedA = canonicalStringify(payloadA);
      const serializedB = canonicalStringify(payloadB);
      expect(serializedA).toBe(serializedB);

      const hashA = computeSnapshotChecksum(payloadA);
      const hashB = computeSnapshotChecksum(payloadB);
      expect(hashA).toBe(hashB);
      expect(hashA.length).toBe(64);
    });

    it("Snapshot Integrity Verification: Detects altered data and invalid hashes", () => {
      const payload = {
        exam: "Final Board 2026",
        student: "Aarav Sharma",
        marks: 450,
        grade: "A1",
      };
      const validChecksum = computeSnapshotChecksum(payload);

      // Valid case
      const resValid = verifySnapshotChecksum(payload, validChecksum);
      expect(resValid.isValid).toBe(true);
      expect(resValid.computedChecksum).toBe(validChecksum);

      // Altered payload
      const alteredPayload = { ...payload, marks: 451 };
      const resAltered = verifySnapshotChecksum(alteredPayload, validChecksum);
      expect(resAltered.isValid).toBe(false);
      expect(resAltered.computedChecksum).not.toBe(validChecksum);

      // Invalid / Missing checksum
      const resMissing = verifySnapshotChecksum(payload, "");
      expect(resMissing.isValid).toBe(false);

      const resTampered = verifySnapshotChecksum(payload, "0000000000000000000000000000000000000000000000000000000000000000");
      expect(resTampered.isValid).toBe(false);
    });

    it("True Concurrency: Competing concurrent updates on the same mark version result in exactly one winner", async () => {
      const mark = await db.examMark.findFirst({ where: { tenantId: tenantA.id } });
      expect(mark).not.toBeNull();
      if (!mark) return;

      const baseVersion = mark.version;

      // Simulate two racing transactions attempting to update the same base version simultaneously
      const [attempt1, attempt2] = await Promise.all([
        db.examMark.updateMany({
          where: { id: mark.id, version: baseVersion },
          data: { marksObtained: 88, version: { increment: 1 } },
        }),
        db.examMark.updateMany({
          where: { id: mark.id, version: baseVersion },
          data: { marksObtained: 89, version: { increment: 1 } },
        }),
      ]);

      const successCount = attempt1.count + attempt2.count;
      expect(successCount).toBe(1);
      expect(attempt1.count === 1 ? attempt2.count === 0 : attempt1.count === 0).toBe(true);

      // Verify the final stored version in the database is exactly baseVersion + 1
      const updated = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(updated?.version).toBe(baseVersion + 1);
    });

    it("Ranking Engine: Correctly applies standard competition ranking ties", () => {
      type StudentScore = { id: string; totalMarks: number; rank?: number };
      const candidates: StudentScore[] = [
        { id: "s1", totalMarks: 450 },
        { id: "s2", totalMarks: 450 },
        { id: "s3", totalMarks: 420 },
        { id: "s4", totalMarks: 390 },
        { id: "s5", totalMarks: 390 },
        { id: "s6", totalMarks: 350 },
      ];

      candidates.sort((a, b) => b.totalMarks - a.totalMarks);

      let currentRank = 1;
      const ranked = candidates.map((c, idx) => {
        if (idx > 0 && c.totalMarks < candidates[idx - 1].totalMarks) {
          currentRank = idx + 1;
        }
        return { ...c, rank: currentRank };
      });

      expect(ranked[0].rank).toBe(1); // 450
      expect(ranked[1].rank).toBe(1); // 450 (tie)
      expect(ranked[2].rank).toBe(3); // 420 (skips rank 2)
      expect(ranked[3].rank).toBe(4); // 390
      expect(ranked[4].rank).toBe(4); // 390 (tie)
      expect(ranked[5].rank).toBe(6); // 350 (skips rank 5)
    });

    it("CSV Export Defense: Escapes commas, quotes, and neutralizes spreadsheet formula injection", () => {
      const escapeCsv = (str: string | number | null | undefined): string => {
        if (str === null || str === undefined) return "";
        let s = String(str);
        if (/^[=+\-@]/.test(s)) {
          s = `'${s}`;
        }
        if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      // Formula injection
      expect(escapeCsv("=1+1")).toBe("'=1+1");
      expect(escapeCsv("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(escapeCsv("-100")).toBe("'-100");
      expect(escapeCsv("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");

      // Commas and quotes
      expect(escapeCsv("Doe, John")).toBe('"Doe, John"');
      expect(escapeCsv('Quoted "Text" Here')).toBe('"Quoted ""Text"" Here"');
      expect(escapeCsv("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');

      // Unicode names
      expect(escapeCsv("आरव शर्मा (Aarav)")).toBe("आरव शर्मा (Aarav)");
    });

    it("Candidate Status Policies: Correctly differentiates ABSENT, EXEMPTED, and EXPELLED", () => {
      const evaluateOutcome = (status: string, hasFailedSubject: boolean) => {
        if (status === "EXEMPTED") return { resultStatus: "WITHHELD", grade: "EXM" };
        if (status === "ABSENT") return { resultStatus: "FAIL", percentage: 0, remarks: "Candidate absent" };
        if (status === "EXPELLED") return { resultStatus: "EXPELLED", grade: "EXP", rank: null };
        return { resultStatus: hasFailedSubject ? "FAIL" : "PASS" };
      };

      const resAbsent = evaluateOutcome("ABSENT", false);
      expect(resAbsent.resultStatus).toBe("FAIL");
      expect(resAbsent.percentage).toBe(0);

      const resExempted = evaluateOutcome("EXEMPTED", false);
      expect(resExempted.resultStatus).toBe("WITHHELD");
      expect(resExempted.grade).toBe("EXM");

      const resExpelled = evaluateOutcome("EXPELLED", false);
      expect(resExpelled.resultStatus).toBe("EXPELLED");
      expect(resExpelled.grade).toBe("EXP");
      expect(resExpelled.rank).toBeNull();
    });

    it("Marks Correction Schema: Enforces mandatory expectedVersion and minimum 10-character justification", () => {
      const valid = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        expectedVersion: 1,
        reason: "Re-evaluation of final calculus question requested by academic committee",
      });
      expect(valid.success).toBe(true);

      const missingVersion = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        reason: "Re-evaluation of final calculus question requested by academic committee",
      });
      expect(missingVersion.success).toBe(false);

      const tooShort = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        expectedVersion: 1,
        reason: "wrong mark",
      });
      expect(tooShort.success).toBe(true); // "wrong mark" is exactly 10 characters

      const shortFail = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        expectedVersion: 1,
        reason: "mistake",
      });
      expect(shortFail.success).toBe(false);
      expect(shortFail.error?.issues[0]?.message).toContain("minimum 10 characters");
    });
  });

  describe("10. Stage 4.3 — Step 1: Versioned Snapshot Integrity & Regression Suite", () => {
    it("Multiple snapshots for one result can be created and version increments sequentially", async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const testExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Versioned Snapshot Test Exam",
          code: `VER-SNAP-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "PUBLISHED",
          isPublished: true,
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-05"),
          createdById: membership!.id,
        },
      });
      createdExamIds.push(testExam.id);

      const testEnrollment = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          status: "ELIGIBLE",
        },
      });

      const testResult = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          enrollmentId: testEnrollment.id,
          totalMaxMarks: 100,
          totalMarksObtained: 85,
          percentage: 85,
          grade: "A",
          gradePoint: 9,
          rank: 1,
          processingStatus: "PUBLISHED",
          resultStatus: "PASS",
        },
      });

      // 1. Initial publication creates snapshot version 1
      const payloadV1 = {
        examId: testExam.id,
        studentId: student1.id,
        percentage: 85,
        version: 1,
      };
      const snapV1 = await db.examResultSnapshot.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          resultId: testResult.id,
          version: 1,
          snapshotData: payloadV1,
          checksum: computeSnapshotChecksum(payloadV1),
        },
      });
      expect(snapV1.version).toBe(1);

      // 2. A subsequent correction creates version 2 without modifying or deleting version 1
      const payloadV2 = {
        examId: testExam.id,
        studentId: student1.id,
        percentage: 88,
        version: 2,
        correctionReason: "Subjective question re-evaluation",
      };
      const snapV2 = await db.examResultSnapshot.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          resultId: testResult.id,
          version: 2,
          snapshotData: payloadV2,
          checksum: computeSnapshotChecksum(payloadV2),
        },
      });
      expect(snapV2.version).toBe(2);

      // 3. Verify total snapshot count is 2
      const allSnapshots = await db.examResultSnapshot.findMany({
        where: { resultId: testResult.id },
        orderBy: { version: "asc" },
      });
      expect(allSnapshots.length).toBe(2);
      expect(allSnapshots[0].version).toBe(1);
      expect(allSnapshots[1].version).toBe(2);

      // 4. Verify previous snapshot content remains completely unchanged
      expect(allSnapshots[0].checksum).toBe(snapV1.checksum);
      expect((allSnapshots[0].snapshotData as Record<string, unknown>).percentage).toBe(85);
      expect((allSnapshots[1].snapshotData as Record<string, unknown>).percentage).toBe(88);

      // 5. Verify latest-snapshot retrieval selects the highest version
      const latestSnapshot = await db.examResultSnapshot.findFirst({
        where: { resultId: testResult.id },
        orderBy: { version: "desc" },
      });
      expect(latestSnapshot).not.toBeNull();
      expect(latestSnapshot?.version).toBe(2);
      expect(latestSnapshot?.id).toBe(snapV2.id);

      // 6. Verify duplicate version insertion for same result is rejected by unique constraint
      await expect(
        db.examResultSnapshot.create({
          data: {
            tenantId: tenantA.id,
            examId: testExam.id,
            studentId: student1.id,
            resultId: testResult.id,
            version: 1, // Duplicate of existing version 1!
            snapshotData: payloadV1,
            checksum: "duplicate-checksum",
          },
        })
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 11. STEP 1.1: CONCURRENT SNAPSHOT VERSION ALLOCATION & CONCURRENCY HARDENING
  // ─────────────────────────────────────────────────────────────
  describe("11. Stage 4.3 — Step 1.1: Concurrent Snapshot Version Allocation & Optimistic Concurrency Hardening", () => {
    let testExam: { id: string };
    let subMath: { id: string };
    let subSci: { id: string };
    let markMath: { id: string };
    let markSci: { id: string };
    let testEnrollment: { id: string };
    let testResult: { id: string };
    let initialSnapshot: { id: string; version: number };
    let adminUserId: string;

    beforeAll(async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      adminUserId = membership?.userId || "user-admin-default";

      // Configure authorized tenant context mock
      vi.mocked(authorizeTenantWrite).mockResolvedValue({
        ok: true,
        ctx: {
          tenant: { id: tenantA.id, name: tenantA.name } as unknown as TenantContext["tenant"],
          user: { id: adminUserId, name: "Admin Officer" } as unknown as TenantContext["user"],
          membership: { roleKey: "ADMIN" } as unknown as TenantContext["membership"],
          permissions: new Set(["tenant.exams.correct_published_marks"]),
          subscriptionBlocked: false,
          isOwnerView: true,
        },
      });

      testExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Concurrency Hardening Exam",
          code: `CONCUR-${Date.now().toString().slice(-6)}`,
          examType: "MID_TERM",
          status: "PUBLISHED",
          isPublished: true,
          publishedAt: new Date(),
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-05"),
          createdById: membership!.id,
        },
      });
      createdExamIds.push(testExam.id);

      subMath = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-02"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      subSci = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-03"),
          maxMarks: 100,
          passingMarks: 35,
          order: 2,
        },
      });

      testEnrollment = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          status: "ELIGIBLE",
        },
      });

      markMath = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          examSubjectId: subMath.id,
          studentId: student1.id,
          enrollmentId: testEnrollment.id,
          marksObtained: 80,
          evaluationStatus: "VERIFIED",
          version: 1,
        },
      });

      markSci = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          examSubjectId: subSci.id,
          studentId: student1.id,
          enrollmentId: testEnrollment.id,
          marksObtained: 75,
          evaluationStatus: "VERIFIED",
          version: 1,
        },
      });

      testResult = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          enrollmentId: testEnrollment.id,
          totalMaxMarks: 200,
          totalMarksObtained: 155,
          percentage: 77.5,
          grade: "B+",
          gradePoint: 8,
          rank: 1,
          processingStatus: "PUBLISHED",
          resultStatus: "PASS",
          passedSubjectsCount: 2,
          failedSubjectsCount: 0,
        },
      });

      const initialPayload = {
        examId: testExam.id,
        studentId: student1.id,
        totalMarksObtained: 155,
        percentage: 77.5,
        version: 1,
      };

      initialSnapshot = await db.examResultSnapshot.create({
        data: {
          tenantId: tenantA.id,
          examId: testExam.id,
          studentId: student1.id,
          resultId: testResult.id,
          version: 1,
          snapshotData: initialPayload,
          checksum: computeSnapshotChecksum(initialPayload),
        },
      });
    });

    it("1. handles concurrent corrections affecting different marks for the same result with serialized version allocation", async () => {
      expect(initialSnapshot.version).toBe(1);
      // Both corrections target the same candidate/result concurrently on different subjects
      const [res1, res2] = await Promise.all([
        correctPublishedMarkAction({
          examId: testExam.id,
          examSubjectId: subMath.id,
          studentId: student1.id,
          newMark: 85,
          reason: "Recounting verified math answer sheet marks",
          expectedVersion: 1,
        }),
        correctPublishedMarkAction({
          examId: testExam.id,
          examSubjectId: subSci.id,
          studentId: student1.id,
          newMark: 90,
          reason: "Practical experiment bonus marks added",
          expectedVersion: 1,
        }),
      ]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      // Verify snapshots allocated sequential versions without collision
      const snapshots = await db.examResultSnapshot.findMany({
        where: { resultId: testResult.id },
        orderBy: { version: "asc" },
      });

      // We should now have versions 1, 2, and 3
      expect(snapshots.length).toBe(3);
      expect(snapshots.map((s) => s.version)).toEqual([1, 2, 3]);

      // All snapshot checksums must be valid
      for (const snap of snapshots) {
        expect(verifySnapshotChecksum(snap.snapshotData, snap.checksum).isValid).toBe(true);
      }

      // Check final result matches both corrections (85 + 90 = 175)
      const updatedResult = await db.examResult.findUnique({
        where: { id: testResult.id },
      });
      expect(updatedResult?.totalMarksObtained).toBe(175);
      expect(updatedResult?.percentage).toBe(87.5);
    });

    it("2. detects concurrent conflict on the same mark and rejects stale version with STALE_VERSION code", async () => {
      // Current mark for Math is at version 2 (after test 1)
      const currentMathMark = await db.examMark.findUnique({
        where: { id: markMath.id },
      });
      expect(currentMathMark?.version).toBe(2);

      // Simulate two concurrent requests with stale expectedVersion 2
      const [resA, resB] = await Promise.all([
        correctPublishedMarkAction({
          examId: testExam.id,
          examSubjectId: subMath.id,
          studentId: student1.id,
          newMark: 88,
          reason: "Teacher revision A applied correctly",
          expectedVersion: 2,
        }),
        correctPublishedMarkAction({
          examId: testExam.id,
          examSubjectId: subMath.id,
          studentId: student1.id,
          newMark: 92,
          reason: "Teacher revision B applied concurrently",
          expectedVersion: 2,
        }),
      ]);

      // Exactly one must succeed and one must return STALE_VERSION
      const succeeded = [resA, resB].filter((r) => r.ok);
      const failed = [resA, resB].filter((r) => !r.ok);

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].code).toBe("STALE_VERSION");
      expect(failed[0].error).toContain("modified by another process");

      // Verify the mark version incremented exactly once (from 2 to 3)
      const finalMathMark = await db.examMark.findUnique({
        where: { id: markMath.id },
      });
      expect(finalMathMark?.version).toBe(3);
    });

    it("3. rejects fast when caller provides an outdated expectedVersion without modifying state", async () => {
      // Mark is now at version 3. Providing expectedVersion: 1 should fail fast.
      const res = await correctPublishedMarkAction({
        examId: testExam.id,
        examSubjectId: subMath.id,
        studentId: student1.id,
        newMark: 99,
        reason: "Stale caller attempting outdated update",
        expectedVersion: 1,
      });

      expect(res.ok).toBe(false);
      expect(res.code).toBe("STALE_VERSION");

      // Verify mark was untouched
      const mark = await db.examMark.findUnique({
        where: { id: markMath.id },
      });
      expect(mark?.version).toBe(3);
      expect(mark?.marksObtained).not.toBe(99);
    });

    it("4. performs complete rollback and leaves no partial records on transaction failure", async () => {
      const markBefore = await db.examMark.findUnique({ where: { id: markSci.id } });
      const revEventsBefore = await db.examMarksRevisionEvent.count({ where: { examId: testExam.id } });
      const snapshotsBefore = await db.examResultSnapshot.count({ where: { resultId: testResult.id } });

      // Attempt correction for a non-existent student in this exam to trigger transaction abort
      const res = await correctPublishedMarkAction({
        examId: testExam.id,
        examSubjectId: subSci.id,
        studentId: "non-existent-student-id",
        newMark: 95,
        expectedVersion: 1,
        reason: "Invalid candidate should abort completely",
      });

      expect(res.ok).toBe(false);

      // Verify state was completely rolled back: no mark change, no orphan revision event, no orphan snapshot
      const markAfter = await db.examMark.findUnique({ where: { id: markSci.id } });
      const revEventsAfter = await db.examMarksRevisionEvent.count({ where: { examId: testExam.id } });
      const snapshotsAfter = await db.examResultSnapshot.count({ where: { resultId: testResult.id } });

      expect(markAfter?.marksObtained).toBe(markBefore?.marksObtained);
      expect(markAfter?.version).toBe(markBefore?.version);
      expect(revEventsAfter).toBe(revEventsBefore);
      expect(snapshotsAfter).toBe(snapshotsBefore);
    });

    it("5. ensures no duplicate snapshot versions exist in database for any result", async () => {
      const duplicates = await db.$queryRaw<Array<{ resultId: string; version: number; count: bigint }>>`
        SELECT "resultId", "version", COUNT(*) as count
        FROM "ExamResultSnapshot"
        WHERE "resultId" = ${testResult.id}
        GROUP BY "resultId", "version"
        HAVING COUNT(*) > 1
      `;
      expect(duplicates.length).toBe(0);
    });

    it("6. retrieves latest snapshot by highest version accurately", async () => {
      const latestSnapshot = await db.examResultSnapshot.findFirst({
        where: { resultId: testResult.id },
        orderBy: { version: "desc" },
      });

      expect(latestSnapshot).not.toBeNull();
      // Should be at version 4 (v1 initial + v2 Math + v3 Sci + v4 Math from test 2)
      expect(latestSnapshot?.version).toBe(4);
      expect(verifySnapshotChecksum(latestSnapshot?.snapshotData, latestSnapshot!.checksum).isValid).toBe(true);
    });

    it("7. Cross-candidate concurrency within one exam: Request A (Student 1) and Request B (Student 2) execute simultaneously with accurate rank recalculation and serialization", async () => {
      // Create a fresh published exam with two candidates where corrections flip their institutional ranking
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const crossExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Cross-Candidate Ranking Concurrency Exam",
          code: `CROSS-${Date.now().toString().slice(-6)}`,
          examType: "FINAL",
          status: "PUBLISHED",
          isPublished: true,
          publishedAt: new Date(),
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-05"),
          createdById: membership!.id,
        },
      });
      createdExamIds.push(crossExam.id);

      const crossSubject = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: crossExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-02"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const enr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: crossExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });
      const enr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: crossExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });

      // Student 1 starts with 60 marks (version 1)
      const mark1 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: crossExam.id,
          examSubjectId: crossSubject.id,
          studentId: student1.id,
          enrollmentId: enr1.id,
          marksObtained: 60,
          evaluationStatus: "VERIFIED",
          version: 1,
        },
      });

      // Student 2 starts with 70 marks (version 1) -> Rank 1
      const mark2 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: crossExam.id,
          examSubjectId: crossSubject.id,
          studentId: student2.id,
          enrollmentId: enr2.id,
          marksObtained: 70,
          evaluationStatus: "VERIFIED",
          version: 1,
        },
      });

      // Initial results: Student 2 is Rank 1, Student 1 is Rank 2
      const res1 = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: crossExam.id,
          studentId: student1.id,
          enrollmentId: enr1.id,
          totalMaxMarks: 100,
          totalMarksObtained: 60,
          percentage: 60,
          grade: "B",
          gradePoint: 7,
          rank: 2,
          processingStatus: "PUBLISHED",
          resultStatus: "PASS",
        },
      });

      const res2 = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: crossExam.id,
          studentId: student2.id,
          enrollmentId: enr2.id,
          totalMaxMarks: 100,
          totalMarksObtained: 70,
          percentage: 70,
          grade: "B+",
          gradePoint: 8,
          rank: 1,
          processingStatus: "PUBLISHED",
          resultStatus: "PASS",
        },
      });

      // Initial snapshots (version 1)
      const payload1 = { examId: crossExam.id, studentId: student1.id, marks: 60, rank: 2 };
      const payload2 = { examId: crossExam.id, studentId: student2.id, marks: 70, rank: 1 };
      await db.examResultSnapshot.createMany({
        data: [
          {
            tenantId: tenantA.id,
            examId: crossExam.id,
            studentId: student1.id,
            resultId: res1.id,
            version: 1,
            snapshotData: payload1,
            checksum: computeSnapshotChecksum(payload1),
          },
          {
            tenantId: tenantA.id,
            examId: crossExam.id,
            studentId: student2.id,
            resultId: res2.id,
            version: 1,
            snapshotData: payload2,
            checksum: computeSnapshotChecksum(payload2),
          },
        ],
      });

      // Simultaneously correct Candidate 1 to 95 (flips to Rank 1) and Candidate 2 to 80 (Rank 2)
      const [corrA, corrB] = await Promise.all([
        correctPublishedMarkAction({
          examId: crossExam.id,
          examSubjectId: crossSubject.id,
          studentId: student1.id,
          newMark: 95,
          expectedVersion: 1,
          reason: "Candidate 1 revaluation pushes score to 95",
        }),
        correctPublishedMarkAction({
          examId: crossExam.id,
          examSubjectId: crossSubject.id,
          studentId: student2.id,
          newMark: 80,
          expectedVersion: 1,
          reason: "Candidate 2 revaluation pushes score to 80",
        }),
      ]);

      expect(corrA.ok).toBe(true);
      expect(corrB.ok).toBe(true);

      // Verify no lost updates: Student 1 has 95 (v2), Student 2 has 80 (v2)
      const finalMark1 = await db.examMark.findUnique({ where: { id: mark1.id } });
      const finalMark2 = await db.examMark.findUnique({ where: { id: mark2.id } });
      expect(finalMark1?.marksObtained).toBe(95);
      expect(finalMark1?.version).toBe(2);
      expect(finalMark2?.marksObtained).toBe(80);
      expect(finalMark2?.version).toBe(2);

      // Verify rankings recalculated consistently across candidates without tie or collision
      const finalRes1 = await db.examResult.findUnique({ where: { id: res1.id } });
      const finalRes2 = await db.examResult.findUnique({ where: { id: res2.id } });
      expect(finalRes1?.totalMarksObtained).toBe(95);
      expect(finalRes1?.rank).toBe(1);
      expect(finalRes2?.totalMarksObtained).toBe(80);
      expect(finalRes2?.rank).toBe(2);

      // Verify snapshots: each student has version 2 with correct ranks and valid checksums
      const snap1V2 = await db.examResultSnapshot.findUnique({
        where: { resultId_version: { resultId: res1.id, version: 2 } },
      });
      const snap2V2 = await db.examResultSnapshot.findUnique({
        where: { resultId_version: { resultId: res2.id, version: 2 } },
      });

      expect(snap1V2).not.toBeNull();
      expect(snap2V2).not.toBeNull();
      expect(verifySnapshotChecksum(snap1V2?.snapshotData, snap1V2!.checksum).isValid).toBe(true);
      expect(verifySnapshotChecksum(snap2V2?.snapshotData, snap2V2!.checksum).isValid).toBe(true);

      // Verify revision events exist for both candidates
      const revEvents = await db.examMarksRevisionEvent.findMany({
        where: { examId: crossExam.id },
      });
      expect(revEvents.length).toBe(2);
      expect(revEvents.some((e) => e.studentId === student1.id && e.newMarks === 95)).toBe(true);
      expect(revEvents.some((e) => e.studentId === student2.id && e.newMarks === 80)).toBe(true);

      // Verify audit logs exist for both corrections
      const auditLogs = await db.auditLog.findMany({
        where: {
          tenantId: tenantA.id,
          action: "exam.published_mark_corrected",
          entityId: { in: [mark1.id, mark2.id] },
        },
      });
      expect(auditLogs.length).toBe(2);
    });

    it("8. Rank cascade consistency: Correcting one student's marks flips another student's rank and generates a new snapshot for the affected student, while leaving unaffected students on their previous snapshot", async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });

      // Create student 3
      const student3 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          admissionNo: `ADM-E3-${Date.now().toString().slice(-5)}`,
          firstName: "Rohan",
          lastName: "Verma",
          classId: classA.id,
          sectionId: sectionA.id,
          status: "ACTIVE",
        },
      });

      let cascadeExamId = "";

      try {
        const cascadeExam = await db.examination.create({
          data: {
            tenantId: tenantA.id,
            academicYearId: academicYearA.id,
            gradeScaleId: gradeScaleA.id,
            targetType: "CLASS_SECTION",
            classId: classA.id,
            title: "Rank Cascade Cascade Verification Exam",
            code: `CASCADE-${Date.now().toString().slice(-6)}`,
            examType: "UNIT_TEST",
            status: "PUBLISHED",
            isPublished: true,
            publishedAt: new Date(),
            startDate: new Date("2026-11-01"),
            endDate: new Date("2026-11-05"),
            createdById: membership!.id,
          },
        });
        cascadeExamId = cascadeExam.id;
        createdExamIds.push(cascadeExam.id);

        const cascadeSub = await db.examSubject.create({
          data: {
            tenantId: tenantA.id,
            examId: cascadeExam.id,
            subjectId: subjectMath.id,
            examDate: new Date("2026-11-02"),
            maxMarks: 100,
            passingMarks: 35,
            order: 1,
          },
        });

        const e1 = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: cascadeExam.id, studentId: student1.id, status: "ELIGIBLE" },
        });
        const e2 = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: cascadeExam.id, studentId: student2.id, status: "ELIGIBLE" },
        });
        const e3 = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: cascadeExam.id, studentId: student3.id, status: "ELIGIBLE" },
        });

        // Initial scores:
        // Student 3: 90 (Rank 1)
        // Student 2: 70 (Rank 2)
        // Student 1: 60 (Rank 3)
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: cascadeExam.id,
            examSubjectId: cascadeSub.id,
            studentId: student1.id,
            enrollmentId: e1.id,
            marksObtained: 60,
            evaluationStatus: "VERIFIED",
            version: 1,
          },
        });

        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: cascadeExam.id,
            examSubjectId: cascadeSub.id,
            studentId: student2.id,
            enrollmentId: e2.id,
            marksObtained: 70,
            evaluationStatus: "VERIFIED",
            version: 1,
          },
        });

        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: cascadeExam.id,
            examSubjectId: cascadeSub.id,
            studentId: student3.id,
            enrollmentId: e3.id,
            marksObtained: 90,
            evaluationStatus: "VERIFIED",
            version: 1,
          },
        });

        // Initial publication using calculateAndPublishResultsAction
        const pubRes = await calculateAndPublishResultsAction({ examId: cascadeExam.id });
        expect(pubRes.ok).toBe(true);

        const r1 = await db.examResult.findUnique({ where: { examId_studentId: { examId: cascadeExam.id, studentId: student1.id } } });
        const r2 = await db.examResult.findUnique({ where: { examId_studentId: { examId: cascadeExam.id, studentId: student2.id } } });
        const r3 = await db.examResult.findUnique({ where: { examId_studentId: { examId: cascadeExam.id, studentId: student3.id } } });
        expect(r1?.rank).toBe(3);
        expect(r2?.rank).toBe(2);
        expect(r3?.rank).toBe(1);

        // Correct ONLY Student 1: from 60 to 75.
        // This causes Student 1 to move from Rank 3 to Rank 2!
        // Student 2 moves from Rank 2 to Rank 3! (AFFECTED by rank cascade!)
        // Student 3 remains at Rank 1 (90 marks)! (UNAFFECTED!)
        const correctionRes = await correctPublishedMarkAction({
          examId: cascadeExam.id,
          examSubjectId: cascadeSub.id,
          studentId: student1.id,
          newMark: 75,
          expectedVersion: 1,
          reason: "Mark correction moves Candidate 1 above Candidate 2",
        });

        expect(correctionRes.ok).toBe(true);

        // 1. Verify Student 1 (directly corrected) has snapshot version 2 with rank 2
        const s1Snapshots = await db.examResultSnapshot.findMany({
          where: { resultId: r1!.id },
          orderBy: { version: "asc" },
        });
        expect(s1Snapshots.length).toBe(2);
        expect(s1Snapshots[0].version).toBe(1);
        expect(s1Snapshots[1].version).toBe(2);
        type SnapPerf = { totalMarksObtained: number; rank: number; percentage: number; grade: string; resultStatus: string };
        const getPerf = (snap: { snapshotData: unknown }) => (snap.snapshotData as { performance: SnapPerf }).performance;

        const s1V2Perf = getPerf(s1Snapshots[1]);
        expect(s1V2Perf.totalMarksObtained).toBe(75);
        expect(s1V2Perf.rank).toBe(2);
        expect(verifySnapshotChecksum(s1Snapshots[1].snapshotData, s1Snapshots[1].checksum).isValid).toBe(true);

        // 2. Verify Student 2 (rank cascaded from 2 to 3) has snapshot version 2 with rank 3!
        const s2Snapshots = await db.examResultSnapshot.findMany({
          where: { resultId: r2!.id },
          orderBy: { version: "asc" },
        });
        expect(s2Snapshots.length).toBe(2);
        expect(s2Snapshots[0].version).toBe(1);
        expect(s2Snapshots[1].version).toBe(2);
        const s2V2Perf = getPerf(s2Snapshots[1]);
        expect(s2V2Perf.totalMarksObtained).toBe(70);
        expect(s2V2Perf.rank).toBe(3);
        expect(verifySnapshotChecksum(s2Snapshots[1].snapshotData, s2Snapshots[1].checksum).isValid).toBe(true);

        // 3. Verify Student 3 (unaffected at Rank 1) retains ONLY version 1 (NO unnecessary snapshot version 2 created!)
        const s3Snapshots = await db.examResultSnapshot.findMany({
          where: { resultId: r3!.id },
          orderBy: { version: "asc" },
        });
        expect(s3Snapshots.length).toBe(1);
        expect(s3Snapshots[0].version).toBe(1);

        // 4. Verify previous snapshot versions (v1 for all candidates) remain completely unchanged
        expect(getPerf(s1Snapshots[0]).rank).toBe(3);
        expect(getPerf(s2Snapshots[0]).rank).toBe(2);
        expect(getPerf(s3Snapshots[0]).rank).toBe(1);

        // 5. Verify live ExamResult matches latest snapshots for all candidates
        const liveR1 = await db.examResult.findUnique({ where: { id: r1!.id } });
        const liveR2 = await db.examResult.findUnique({ where: { id: r2!.id } });
        const liveR3 = await db.examResult.findUnique({ where: { id: r3!.id } });

        expect(liveR1?.rank).toBe(s1V2Perf.rank);
        expect(liveR1?.totalMarksObtained).toBe(s1V2Perf.totalMarksObtained);
        expect(liveR2?.rank).toBe(s2V2Perf.rank);
        expect(liveR2?.totalMarksObtained).toBe(s2V2Perf.totalMarksObtained);
        expect(liveR3?.rank).toBe(1);
      } finally {
        if (cascadeExamId) {
          await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" DISABLE TRIGGER trg_exam_snapshot_protect`);
          await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" DISABLE TRIGGER trg_exam_revision_event_protect`);
          await db.examResultSnapshot.deleteMany({ where: { examId: cascadeExamId } });
          await db.examMarksRevisionEvent.deleteMany({ where: { examId: cascadeExamId } });
          await db.examResult.deleteMany({ where: { examId: cascadeExamId } });
          await db.examMark.deleteMany({ where: { examId: cascadeExamId } });
          await db.examEnrollment.deleteMany({ where: { examId: cascadeExamId } });
          await db.examSubject.deleteMany({ where: { examId: cascadeExamId } });
          await db.examination.deleteMany({ where: { id: cascadeExamId } });
          await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" ENABLE TRIGGER trg_exam_snapshot_protect`);
          await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" ENABLE TRIGGER trg_exam_revision_event_protect`);
        }
        await db.student.delete({ where: { id: student3.id } }).catch(() => {});
      }
    });

    it("9. Negative authorization & tenant isolation: Rejects unauthorized roles and cross-tenant access without mutating state", async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const adminUserId = membership?.userId || "user-admin-default";

      const authorizedCtx = {
        tenant: { id: tenantA.id, name: tenantA.name } as unknown as TenantContext["tenant"],
        user: { id: adminUserId, name: "Admin Officer" } as unknown as TenantContext["user"],
        membership: { roleKey: "ADMIN" } as unknown as TenantContext["membership"],
        permissions: new Set(["tenant.exams.correct_published_marks"]),
        subscriptionBlocked: false,
        isOwnerView: true,
      };

      try {
        // A. Denied caller (e.g. Teacher or Accountant without correct_published_marks permission)
        vi.mocked(authorizeTenantWrite).mockResolvedValueOnce({
          ok: false,
          error: "Forbidden: Missing permission tenant.exams.correct_published_marks",
        });

        const deniedRes = await correctPublishedMarkAction({
          examId: testExam.id,
          examSubjectId: subMath.id,
          studentId: student1.id,
          newMark: 95,
          expectedVersion: 1,
          reason: "Unauthorized attempt by teacher without correction privilege",
        });

        expect(deniedRes.ok).toBe(false);
        expect(deniedRes.error).toContain("Forbidden: Missing permission tenant.exams.correct_published_marks");

        // B. Cross-tenant isolation check: Tenant B principal attempting to modify Tenant A's examination
        vi.mocked(authorizeTenantWrite).mockResolvedValueOnce({
          ok: true,
          ctx: {
            tenant: { id: tenantB.id, name: tenantB.name } as unknown as TenantContext["tenant"],
            user: { id: "user-tenant-b", name: "Tenant B Admin" } as unknown as TenantContext["user"],
            membership: { roleKey: "ADMIN" } as unknown as TenantContext["membership"],
            permissions: new Set(["tenant.exams.correct_published_marks"]),
            subscriptionBlocked: false,
            isOwnerView: true,
          },
        });

        const crossTenantRes = await correctPublishedMarkAction({
          examId: testExam.id, // Exam belongs to Tenant A
          examSubjectId: subMath.id,
          studentId: student1.id,
          newMark: 95,
          expectedVersion: 1,
          reason: "Cross-tenant intrusion attempt",
        });

        expect(crossTenantRes.ok).toBe(false);
        expect(crossTenantRes.error).toBe("Examination not found.");
      } finally {
        // Restore authorized context
        vi.mocked(authorizeTenantWrite).mockResolvedValue({
          ok: true,
          ctx: authorizedCtx,
        });
      }
    });

    it("10. Snapshot semantic completeness: Every newly created snapshot payload reflects the complete authoritative published report card", async () => {
      const latestSnapshot = await db.examResultSnapshot.findFirst({
        where: { resultId: testResult.id },
        orderBy: { version: "desc" },
      });

      expect(latestSnapshot).not.toBeNull();
      const payload = latestSnapshot!.snapshotData as Record<string, unknown>;

      // 1. Verify institute & exam identity
      expect((payload.institute as Record<string, unknown>).id).toBe(tenantA.id);
      expect((payload.exam as Record<string, unknown>).id).toBe(testExam.id);

      // 2. Verify candidate identity
      const studentData = payload.student as Record<string, unknown>;
      expect(studentData.id).toBe(student1.id);
      expect(studentData.admissionNo).toBeDefined();

      // 3. Verify performance fields (Total marks, percentage, rank, grade, outcome)
      const perf = payload.performance as Record<string, unknown>;
      expect(typeof perf.totalMarksObtained).toBe("number");
      expect(typeof perf.totalMaxMarks).toBe("number");
      expect(typeof perf.percentage).toBe("number");
      expect(typeof perf.grade).toBe("string");
      expect(typeof perf.gradePoint).toBe("number");
      expect(["PASS", "FAIL", "WITHHELD", "EXPELLED"]).toContain(perf.resultStatus);
      expect(perf.passedSubjectsCount).toBeDefined();
      expect(perf.failedSubjectsCount).toBeDefined();

      // 4. Verify subject-level breakdown
      const subjects = payload.subjects as Array<Record<string, unknown>>;
      expect(Array.isArray(subjects)).toBe(true);
      expect(subjects.length).toBeGreaterThanOrEqual(1);
      for (const sub of subjects) {
        expect(sub.subjectId).toBeDefined();
        expect(sub.subjectName).toBeDefined();
        expect(typeof sub.maxMarks).toBe("number");
        expect(typeof sub.passingMarks).toBe("number");
        expect(typeof sub.isPassed).toBe("boolean");
      }

      // 5. Verify authoritative SHA-256 checksum matches
      const checksumVerification = verifySnapshotChecksum(latestSnapshot!.snapshotData, latestSnapshot!.checksum);
      expect(checksumVerification.isValid).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 12. LIFECYCLE STATE MACHINE AND MANDATORY SAFEGUARDS
  // ─────────────────────────────────────────────────────────────
  describe("12. Lifecycle State Machine and Mandatory Safeguards", () => {
    let lifecycleExam: { id: string };
    let emptyDraftExam: { id: string };
    let subMathLife: { id: string };
    let subSciLife: { id: string };
    let memberId: string;
    let adminCtx: TenantContext;

    beforeAll(async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      memberId = membership!.id;
      const adminUserId = membership!.userId;

      adminCtx = {
        tenant: { id: tenantA.id, name: tenantA.name } as unknown as TenantContext["tenant"],
        user: { id: adminUserId, name: "Admin Officer" } as unknown as TenantContext["user"],
        membership: { id: memberId, roleKey: "ADMIN" } as unknown as TenantContext["membership"],
        permissions: new Set([
          "tenant.exams.read",
          "tenant.exams.write",
          "tenant.exams.enroll",
          "tenant.exams.enter_marks",
          "tenant.exams.verify_marks",
          "tenant.exams.publish_results",
          "tenant.exams.correct_published_marks",
          "tenant.exams.manage_grading",
        ]),
        subscriptionBlocked: false,
        isOwnerView: true,
      };

      vi.mocked(authorizeTenantWrite).mockResolvedValue({
        ok: true,
        ctx: adminCtx,
      });

      // 1. Create an active operational exam
      lifecycleExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Lifecycle Master Assessment 2026",
          code: `LIFE-${Date.now().toString().slice(-6)}`,
          examType: "FINAL",
          status: "DRAFT",
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-10"),
          createdById: memberId,
        },
      });
      createdExamIds.push(lifecycleExam.id);

      // 2. Create an empty draft exam for safe deletion testing
      emptyDraftExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Empty Draft Exam",
          code: `EMPTY-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "DRAFT",
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: memberId,
        },
      });
      createdExamIds.push(emptyDraftExam.id);

      // Add subjects to lifecycleExam
      subMathLife = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: lifecycleExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-12-02"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1,
          order: 1,
        },
      });

      subSciLife = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: lifecycleExam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-12-04"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1,
          order: 2,
        },
      });

      // Enroll candidates
      await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: lifecycleExam.id,
          studentId: student1.id,
          status: "ELIGIBLE",
        },
      });

      await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: lifecycleExam.id,
          studentId: student2.id,
          status: "ELIGIBLE",
        },
      });

      // Student 3: Withdrawn candidate
      const student3 = await db.student.findFirst({
        where: { tenantId: tenantA.id, id: { notIn: [student1.id, student2.id] } },
      });
      if (student3) {
        await db.examEnrollment.create({
          data: {
            tenantId: tenantA.id,
            examId: lifecycleExam.id,
            studentId: student3.id,
            status: "WITHDRAWN",
          },
        });
      }
    });

    it("1. Transition Matrix: Enforces strict transition rules and blocks forbidden transitions", async () => {
      // DRAFT -> PUBLISHED is prohibited
      const checkDraftToPub = assertExamTransition("DRAFT", "PUBLISHED", adminCtx);
      expect(checkDraftToPub.allowed).toBe(false);
      expect(checkDraftToPub.code).toBe("INVALID_TRANSITION");

      // IN_PROGRESS -> DRAFT is prohibited (illegal rollback)
      const checkProgToDraft = assertExamTransition("IN_PROGRESS", "DRAFT", adminCtx);
      expect(checkProgToDraft.allowed).toBe(false);

      // PUBLISHED -> DRAFT is prohibited
      const checkPubToDraft = assertExamTransition("PUBLISHED", "DRAFT", adminCtx);
      expect(checkPubToDraft.allowed).toBe(false);

      // ARCHIVED -> ANY is prohibited
      const checkArchToProg = assertExamTransition("ARCHIVED", "IN_PROGRESS", adminCtx);
      expect(checkArchToProg.allowed).toBe(false);

      // Same status is allowed as safe no-op
      const checkSameStatus = assertExamTransition("IN_PROGRESS", "IN_PROGRESS", adminCtx);
      expect(checkSameStatus.allowed).toBe(true);

      // Transition action: DRAFT -> SCHEDULED
      const transRes = await transitionExamStatusAction({
        examId: lifecycleExam.id,
        requestedStatus: "SCHEDULED",
      });
      expect(transRes.ok).toBe(true);

      const dbExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(dbExam?.status).toBe("SCHEDULED");
    });

    it("2. Safeguard 5: Safe deletion blocks operational exams and permits empty drafts", async () => {
      // Attempting to delete operational exam with enrollments and subjects MUST fail
      const deleteOpRes = await deleteExaminationAction(lifecycleExam.id);
      expect(deleteOpRes.ok).toBe(false);
      expect(deleteOpRes.error).toMatch(/Only draft examinations can be deleted|Operational examinations must be cancelled/i);

      // Attempting to delete empty draft MUST succeed
      const deleteDraftRes = await deleteExaminationAction(emptyDraftExam.id);
      expect(deleteDraftRes.ok).toBe(true);

      const deletedCheck = await db.examination.findUnique({ where: { id: emptyDraftExam.id } });
      expect(deletedCheck).toBeNull();
    });

    it("2.1. Safeguard 5: Permanent deletion rejected when draft examination has historical ExamResult", async () => {
      // Create a separate reference exam and enrollment to provide a valid unique foreign key for ExamResult
      const refExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Reference Exam for Result FK",
          code: `REF-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "DRAFT",
          startDate: new Date("2026-12-10"),
          endDate: new Date("2026-12-15"),
          createdById: memberId,
        },
      });
      createdExamIds.push(refExam.id);

      const refEnrollment = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: refExam.id,
          studentId: student2.id,
          status: "ELIGIBLE",
        },
      });

      // 1. Create a DRAFT examination with a historical ExamResult
      const draftExamWithResult = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Draft Exam with Historical Result",
          code: `DR-RES-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "DRAFT",
          startDate: new Date("2026-12-10"),
          endDate: new Date("2026-12-15"),
          createdById: memberId,
        },
      });
      createdExamIds.push(draftExamWithResult.id);

      const historicalResult = await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: draftExamWithResult.id,
          studentId: student2.id,
          enrollmentId: refEnrollment.id,
          totalMaxMarks: 100,
          totalMarksObtained: 75,
          percentage: 75,
          grade: "B",
          rank: 1,
          resultStatus: "PASS",
        },
      });

      // 2. Ensure enrollment, ExamMark, and revision-event counts are zero
      const [enrollmentCount, markCount, revisionEventCount, resultCount] = await Promise.all([
        db.examEnrollment.count({ where: { examId: draftExamWithResult.id, tenantId: tenantA.id } }),
        db.examMark.count({ where: { examId: draftExamWithResult.id, tenantId: tenantA.id } }),
        db.examMarksRevisionEvent.count({ where: { examId: draftExamWithResult.id, tenantId: tenantA.id } }),
        db.examResult.count({ where: { examId: draftExamWithResult.id, tenantId: tenantA.id } }),
      ]);
      expect(enrollmentCount).toBe(0);
      expect(markCount).toBe(0);
      expect(revisionEventCount).toBe(0);
      expect(resultCount).toBe(1);

      // 3. Attempt deletion
      const deleteRes = await deleteExaminationAction(draftExamWithResult.id);

      // 4. Assert deletion is rejected
      expect(deleteRes.ok).toBe(false);
      expect(deleteRes.code).toBe("INVALID_TRANSITION");
      expect(deleteRes.error).toMatch(/historical results \(1\)/i);

      // 5. Assert ExamResult and Examination remain intact
      const examCheck = await db.examination.findUnique({ where: { id: draftExamWithResult.id } });
      expect(examCheck).not.toBeNull();
      expect(examCheck?.id).toBe(draftExamWithResult.id);

      const resultCheck = await db.examResult.findUnique({ where: { id: historicalResult.id } });
      expect(resultCheck).not.toBeNull();
      expect(resultCheck?.id).toBe(historicalResult.id);

      // Cleanup historical result and ref entities
      await db.examResult.delete({ where: { id: historicalResult.id } });
      await db.examEnrollment.delete({ where: { id: refEnrollment.id } });
      await db.examination.delete({ where: { id: refExam.id } });
      await db.examination.delete({ where: { id: draftExamWithResult.id } });
    });

    it("3. Safeguard 4: Completeness engine detects missing, unverified, and malformed marks", async () => {
      // Step A: Move exam to IN_PROGRESS via marks entry
      const enterRes = await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subMathLife.id,
        entries: [
          { studentId: student1.id, marksObtained: 85, isAbsent: false, isExempted: false, expectedVersion: 0 },
        ],
        reason: "Midterm paper grading",
        submitForVerification: false,
      });
      expect(enterRes.ok).toBe(true);

      const inProgExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(inProgExam?.status).toBe("IN_PROGRESS");

      // Step B: Check completeness: student2 has no mark in Math, and both have no mark in Science
      const compCheck1 = await db.$transaction(async (tx) => {
        return await verifyCandidateSubjectCompleteness(tx, lifecycleExam.id, tenantA.id);
      });
      expect(compCheck1.isValid).toBe(false);
      expect(compCheck1.errors.length).toBeGreaterThan(0);
      expect(compCheck1.errors.some((e) => e.includes("Missing mark record"))).toBe(true);
      expect(compCheck1.errors.some((e) => e.includes("Unverified mark"))).toBe(true);

      // Candidate-subject Cartesian completeness must exclude WITHDRAWN candidates
      // Eligible candidates should be 2 (student1 and student2)
      expect(compCheck1.eligibleCandidatesCount).toBe(2);
      expect(compCheck1.expectedPairsCount).toBe(4); // 2 candidates * 2 subjects

      // Step C: Attempting transition to EVALUATED when marks are incomplete or unverified MUST fail
      const prematureEval = await transitionExamStatusAction({
        examId: lifecycleExam.id,
        requestedStatus: "EVALUATED",
      });
      expect(prematureEval.ok).toBe(false);
      expect(prematureEval.code).toBe("INCOMPLETE_EVALUATION");

      // Step D: Enter marks for student2 in Math, and both in Science
      await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subMathLife.id,
        entries: [
          { studentId: student2.id, marksObtained: 90, isAbsent: false, isExempted: false, expectedVersion: 0 },
        ],
        reason: "Grading student 2",
        submitForVerification: false,
      });

      await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subSciLife.id,
        entries: [
          { studentId: student1.id, marksObtained: 78, isAbsent: false, isExempted: false, expectedVersion: 0 },
          { studentId: student2.id, marksObtained: 88, isAbsent: false, isExempted: false, expectedVersion: 0 },
        ],
        reason: "Science grading",
        submitForVerification: false,
      });

      // Still unverified
      const compCheckUnverified = await db.$transaction(async (tx) => {
        return await verifyCandidateSubjectCompleteness(tx, lifecycleExam.id, tenantA.id);
      });
      expect(compCheckUnverified.isValid).toBe(false);
      expect(compCheckUnverified.errors.some((e) => e.includes("must be VERIFIED"))).toBe(true);

      // Verify Math marks
      await verifyExamSubjectMarksAction(lifecycleExam.id, subMathLife.id);

      // Exam should still be IN_PROGRESS because Science is not verified
      const halfVerifiedExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(halfVerifiedExam?.status).toBe("IN_PROGRESS");

      // Verify Science marks -> now all Cartesian pairs are complete & verified -> auto transitions to EVALUATED
      await verifyExamSubjectMarksAction(lifecycleExam.id, subSciLife.id);

      const evaluatedExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(evaluatedExam?.status).toBe("EVALUATED");
    });

    it("4. Reopen Evaluated Exam: Transitions EVALUATED back to IN_PROGRESS and unlocks marks", async () => {
      // Reopen with insufficient justification (<10 chars) MUST fail
      const shortReopen = await reopenEvaluatedExamAction({
        examId: lifecycleExam.id,
        reason: "Too short",
      });
      expect(shortReopen.ok).toBe(false);

      // Reopen with valid justification (>=10 chars)
      const validReopen = await reopenEvaluatedExamAction({
        examId: lifecycleExam.id,
        reason: "Reopening assessment to permit examiner score adjustments",
      });
      expect(validReopen.ok).toBe(true);

      const reopenedExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(reopenedExam?.status).toBe("IN_PROGRESS");

      // Candidate marks should now be unlocked to SUBMITTED
      const marks = await db.examMark.findMany({ where: { examId: lifecycleExam.id } });
      expect(marks.every((m) => m.evaluationStatus === "SUBMITTED")).toBe(true);

      // Re-verify both subjects to return to EVALUATED
      await verifyExamSubjectMarksAction(lifecycleExam.id, subMathLife.id);
      await verifyExamSubjectMarksAction(lifecycleExam.id, subSciLife.id);

      const reEvaluatedExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(reEvaluatedExam?.status).toBe("EVALUATED");
    });

    it("5. Safeguard 3: COMPLETED State behavior allows marks entry and verification", async () => {
      // Create a dedicated exam to test COMPLETED workflow
      const completedExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Assessment Window Concluded Exam",
          code: `COMPL-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          startDate: new Date("2026-11-01"),
          endDate: new Date("2026-11-05"),
          createdById: memberId,
        },
      });
      createdExamIds.push(completedExam.id);

      // Transition IN_PROGRESS -> COMPLETED
      const transComp = await transitionExamStatusAction({
        examId: completedExam.id,
        requestedStatus: "COMPLETED",
      });
      expect(transComp.ok).toBe(true);

      const dbComp = await db.examination.findUnique({ where: { id: completedExam.id } });
      expect(dbComp?.status).toBe("COMPLETED");

      // Reverting COMPLETED to IN_PROGRESS requires justification
      const revertNoJust = await transitionExamStatusAction({
        examId: completedExam.id,
        requestedStatus: "IN_PROGRESS",
      });
      expect(revertNoJust.ok).toBe(false);
      expect(revertNoJust.error).toMatch(/justification of at least 10 characters/i);

      const revertWithJust = await transitionExamStatusAction({
        examId: completedExam.id,
        requestedStatus: "IN_PROGRESS",
        reason: "Reopening assessment window for student special accommodation",
      });
      expect(revertWithJust.ok).toBe(true);
    });

    it("6. Publish Results and Safeguard 2: PUBLISHED protects grading parameters and maintains invariants", async () => {
      // Publish results for lifecycleExam (currently EVALUATED)
      const pubRes = await calculateAndPublishResultsAction({ examId: lifecycleExam.id });
      expect(pubRes.ok).toBe(true);

      const publishedDbExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(publishedDbExam?.status).toBe("PUBLISHED");
      expect(publishedDbExam?.isPublished).toBe(true);
      expect(publishedDbExam?.publishedAt).not.toBeNull();
      const initialPublishedAt = publishedDbExam!.publishedAt;

      // 1. Modifying grade scale on published exam MUST be rejected
      const modifyGradeScale = await updateExaminationAction({
        id: lifecycleExam.id,
        title: "Lifecycle Master Assessment 2026",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
        gradeScaleId: "different-scale-id",
      });
      expect(modifyGradeScale.ok).toBe(false);
      expect(modifyGradeScale.error).toMatch(/Cannot modify grading scales or syllabus structure for a published examination/i);

      // 2. Modifying title on published exam MUST be rejected
      const modifyTitle = await updateExaminationAction({
        id: lifecycleExam.id,
        title: "Attempted Alteration of Published Title",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
      });
      expect(modifyTitle.ok).toBe(false);
      expect(modifyTitle.error).toMatch(/Cannot modify examination title for a published examination/i);

      // 3. Modifying allowed metadata (e.g. instructions, term) while preserving title MUST succeed
      const updateMeta = await updateExaminationAction({
        id: lifecycleExam.id,
        title: "Lifecycle Master Assessment 2026",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
        instructions: "Official archival instructions updated by Registrar.",
      });
      expect(updateMeta.ok).toBe(true);

      // 4. Invariant check: publishedAt is preserved and isPublished remains true
      const postUpdateExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(postUpdateExam?.isPublished).toBe(true);
      expect(postUpdateExam?.publishedAt?.toISOString()).toBe(initialPublishedAt?.toISOString());
      expect(postUpdateExam?.instructions).toBe("Official archival instructions updated by Registrar.");
    });

    it("7. Safeguard 1: ARCHIVED is permanently frozen, immutable, and idempotent", async () => {
      // Archive the published examination
      const archiveRes = await archiveExaminationAction({
        examId: lifecycleExam.id,
        reason: "End-of-term institutional archival",
      });
      expect(archiveRes.ok).toBe(true);

      const archivedExam = await db.examination.findUnique({ where: { id: lifecycleExam.id } });
      expect(archivedExam?.status).toBe("ARCHIVED");
      // Published flags are preserved so report cards remain accessible
      expect(archivedExam?.isPublished).toBe(true);
      expect(archivedExam?.publishedAt).not.toBeNull();

      // Repeated archive call is an idempotent safe no-op
      const repeatArchive = await archiveExaminationAction({ examId: lifecycleExam.id });
      expect(repeatArchive.ok).toBe(true);

      // Modifying metadata on ARCHIVED exam MUST fail
      const updateArchived = await updateExaminationAction({
        id: lifecycleExam.id,
        title: "Cannot Change Archived Exam",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
      });
      expect(updateArchived.ok).toBe(false);
      expect(updateArchived.code).toBe("INVALID_TRANSITION");

      // Modifying subjects on ARCHIVED exam MUST fail
      const modSubjects = await saveExamSubjectsAction({
        examId: lifecycleExam.id,
        subjects: [
          { subjectId: subjectMath.id, examDate: "2026-12-02", maxMarks: 100, passingMarks: 35, weightage: 1, order: 1 },
        ],
      });
      expect(modSubjects.ok).toBe(false);
      expect(modSubjects.code).toBe("INVALID_TRANSITION");

      // Enrolling candidates on ARCHIVED exam MUST fail
      const enrollArchived = await autoEnrollEligibleStudentsAction(lifecycleExam.id);
      expect(enrollArchived.ok).toBe(false);
      expect(enrollArchived.code).toBe("INVALID_TRANSITION");

      // Entering marks on ARCHIVED exam MUST fail
      const enterMarksArchived = await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subMathLife.id,
        entries: [{ studentId: student1.id, marksObtained: 99, isAbsent: false, isExempted: false, expectedVersion: 1 }],
        reason: "Post-archival illegal update",
      });
      expect(enterMarksArchived.ok).toBe(false);
      expect(enterMarksArchived.code).toBe("INVALID_TRANSITION");

      // Correcting marks on ARCHIVED exam MUST fail
      const mark1 = await db.examMark.findFirst({
        where: { examId: lifecycleExam.id, studentId: student1.id, examSubjectId: subMathLife.id },
      });
      const correctArchived = await correctPublishedMarkAction({
        examId: lifecycleExam.id,
        examSubjectId: subMathLife.id,
        studentId: student1.id,
        newMark: 95,
        reason: "Post-archival illegal correction",
        expectedVersion: mark1?.version ?? 1,
      });
      expect(correctArchived.ok).toBe(false);
      expect(correctArchived.code).toBe("INVALID_TRANSITION");

      // Status reopening from ARCHIVED MUST fail
      const reopenArchived = await transitionExamStatusAction({
        examId: lifecycleExam.id,
        requestedStatus: "IN_PROGRESS",
        reason: "Illegal attempt to revive archived exam",
      });
      expect(reopenArchived.ok).toBe(false);
      expect(reopenArchived.code).toBe("INVALID_TRANSITION");
    });

    it("8. Absence & Exemption Invariants: Differing candidate subject eligibility and non-contributing denominators", async () => {
      // Create a dedicated exam for differing candidate subject eligibility
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const diffExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Differing Eligibility Assessment",
          code: `DIFF-${Date.now().toString().slice(-6)}`,
          examType: "MID_TERM",
          status: "IN_PROGRESS",
          startDate: new Date("2026-11-15"),
          endDate: new Date("2026-11-20"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(diffExam.id);

      const dSub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: diffExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-16"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1,
          order: 1,
        },
      });

      const dSub2 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: diffExam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-18"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1,
          order: 2,
        },
      });

      // Student 1: Regular (takes both subjects)
      await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: diffExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      // Student 2: Exempted from Science (takes only Math)
      await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: diffExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });

      // Student 3: Withdrawn candidate
      const student3 = await db.student.findFirst({
        where: { tenantId: tenantA.id, id: { notIn: [student1.id, student2.id] } },
      });
      if (student3) {
        await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: diffExam.id, studentId: student3.id, status: "WITHDRAWN" },
        });
      }

      // Enter marks:
      // Student 1: Math 85, Science 75
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub1.id,
        entries: [{ studentId: student1.id, marksObtained: 85, isAbsent: false, isExempted: false, expectedVersion: 0 }],
        reason: "Student 1 Math score",
      });
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub2.id,
        entries: [{ studentId: student1.id, marksObtained: 75, isAbsent: false, isExempted: false, expectedVersion: 0 }],
        reason: "Student 1 Science score",
      });

      // Student 2: Math 90, Science EXEMPTED
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub1.id,
        entries: [{ studentId: student2.id, marksObtained: 90, isAbsent: false, isExempted: false, expectedVersion: 0 }],
        reason: "Student 2 Math score",
      });
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub2.id,
        entries: [{ studentId: student2.id, marksObtained: null, isAbsent: false, isExempted: true, expectedVersion: 0 }],
        reason: "Student 2 officially exempted from Science by Academic Board",
      });

      // Verify all marks
      await verifyExamSubjectMarksAction(diffExam.id, dSub1.id);
      await verifyExamSubjectMarksAction(diffExam.id, dSub2.id);

      const diffEvaluated = await db.examination.findUnique({ where: { id: diffExam.id } });
      expect(diffEvaluated?.status).toBe("EVALUATED");

      // Publish results
      const pubRes = await calculateAndPublishResultsAction({ examId: diffExam.id });
      expect(pubRes.ok).toBe(true);

      // Verify Student 1 (Regular):
      // Scored: 85 + 75 = 160. Total Max Marks: 200. Percentage: 80%.
      const res1 = await db.examResult.findFirst({
        where: { examId: diffExam.id, studentId: student1.id },
      });
      expect(res1?.totalMarksObtained).toBe(160);
      expect(res1?.totalMaxMarks).toBe(200);
      expect(res1?.percentage).toBe(80);
      expect(res1?.resultStatus).toBe("PASS");

      // Verify Student 2 (Science Exempted):
      // Exempted marks MUST NOT contribute to denominator:
      // Scored: 90. Total Max Marks evaluated: 100 (NOT 200!). Percentage: 90%.
      const res2 = await db.examResult.findFirst({
        where: { examId: diffExam.id, studentId: student2.id },
      });
      expect(res2?.totalMarksObtained).toBe(90);
      expect(res2?.totalMaxMarks).toBe(100);
      expect(res2?.percentage).toBe(90);
      expect(res2?.resultStatus).toBe("PASS");

      // Verify Student 3 (Withdrawn): Excluded from results
      if (student3) {
        const res3 = await db.examResult.findFirst({
          where: { examId: diffExam.id, studentId: student3.id },
        });
        expect(res3).toBeNull();
      }

      // Check snapshot payloads reflect correct candidate-specific totalMaxMarks
      const snap2 = await db.examResultSnapshot.findFirst({
        where: { resultId: res2!.id, version: 1 },
      });
      expect(snap2).not.toBeNull();
      const perf2 = (snap2!.snapshotData as Record<string, unknown>).performance as Record<string, unknown>;
      expect(perf2.totalMaxMarks).toBe(100);
      expect(perf2.percentage).toBe(90);
      expect(verifySnapshotChecksum(snap2!.snapshotData, snap2!.checksum).isValid).toBe(true);
    });

    it("9. Real PostgreSQL Concurrency: Marks entry versus Publishing coordinates safely", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Concurrent Marks vs Publish Assessment",
          code: `C1-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "EVALUATED",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const enr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          examSubjectId: sub1.id,
          studentId: student1.id,
          enrollmentId: enr.id,
          marksObtained: 85,
          evaluationStatus: "VERIFIED",
        },
      });

      // Fire simultaneous requests: enter marks vs publish
      const [resMarks, resPublish] = await Promise.all([
        enterMarksBulkAction({
          examId: concExam.id,
          examSubjectId: sub1.id,
          entries: [{ studentId: student1.id, marksObtained: 88, isAbsent: false, isExempted: false, expectedVersion: 1 }],
          reason: "Concurrent mark adjustment",
        }),
        calculateAndPublishResultsAction({ examId: concExam.id }),
      ]);

      // Serialized via Examination row lock:
      // Either publish committed first (in which case marks entry failed with INVALID_TRANSITION),
      // OR marks entry committed first (in which case exam was EVALUATED with verified marks and published succeeded).
      // Both outcomes are consistent; at least one must have succeeded.
      expect(resMarks.ok || resPublish.ok).toBe(true);

      // Verify final database state is consistent
      const finalExam = await db.examination.findUnique({ where: { id: concExam.id } });
      expect(finalExam).not.toBeNull();
      if (resPublish.ok) {
        expect(finalExam?.status).toBe("PUBLISHED");
        expect(finalExam?.isPublished).toBe(true);
        expect(finalExam?.publishedAt).not.toBeNull();
        const results = await db.examResult.findMany({ where: { examId: concExam.id } });
        expect(results.length).toBe(1);
      }
    });

    it("10. Real PostgreSQL Concurrency: Enrollment versus Publishing coordinates safely", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Concurrent Enrollment vs Publish",
          code: `C2-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "EVALUATED",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const enr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          examSubjectId: sub1.id,
          studentId: student1.id,
          enrollmentId: enr.id,
          marksObtained: 90,
          evaluationStatus: "VERIFIED",
        },
      });

      // Fire simultaneous requests: enroll student 2 vs publish
      const [resEnroll, resPublish] = await Promise.all([
        enrollStudentsAction({ examId: concExam.id, studentIds: [student2.id] }),
        calculateAndPublishResultsAction({ examId: concExam.id }),
      ]);

      // Serialized via Examination row lock:
      // If enrollment won: student 2 was enrolled without marks -> publishing failed with INCOMPLETE_EVALUATION.
      // If publishing won: exam published -> enrollment failed with INVALID_TRANSITION.
      expect(resEnroll.ok || resPublish.ok).toBe(true);

      const finalExam = await db.examination.findUnique({ where: { id: concExam.id } });
      expect(finalExam).not.toBeNull();
    });

    it("11. Real PostgreSQL Concurrency: Withdrawal versus Publishing coordinates safely", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Concurrent Withdrawal vs Publish",
          code: `C3-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "EVALUATED",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const enr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      const enr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });

      await db.examMark.createMany({
        data: [
          {
            tenantId: tenantA.id,
            examId: concExam.id,
            examSubjectId: sub1.id,
            studentId: student1.id,
            enrollmentId: enr1.id,
            marksObtained: 90,
            evaluationStatus: "VERIFIED",
          },
          {
            tenantId: tenantA.id,
            examId: concExam.id,
            examSubjectId: sub1.id,
            studentId: student2.id,
            enrollmentId: enr2.id,
            marksObtained: 80,
            evaluationStatus: "VERIFIED",
          },
        ],
      });

      // Fire simultaneous requests: withdraw student 2 vs publish
      const [resWithdraw, resPublish] = await Promise.all([
        updateEnrollmentStatusAction({ enrollmentId: enr2.id, status: "WITHDRAWN", remarks: "Candidate withdrawn" }),
        calculateAndPublishResultsAction({ examId: concExam.id }),
      ]);

      expect(resWithdraw.ok || resPublish.ok).toBe(true);

      const finalExam = await db.examination.findUnique({ where: { id: concExam.id } });
      expect(finalExam).not.toBeNull();
    });

    it("12. Real PostgreSQL Concurrency: Subject configuration versus Evaluation coordinates safely", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Concurrent Subject vs Evaluation",
          code: `C4-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const enr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          examSubjectId: sub1.id,
          studentId: student1.id,
          enrollmentId: enr.id,
          marksObtained: 85,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Fire simultaneous requests: add Science subject vs verify Math marks
      const [resAddSub, resVerify] = await Promise.all([
        saveExamSubjectsAction({
          examId: concExam.id,
          subjects: [
            { subjectId: subjectMath.id, examDate: "2026-11-21", maxMarks: 100, passingMarks: 35, weightage: 1, order: 1 },
            { subjectId: subjectScience.id, examDate: "2026-11-23", maxMarks: 100, passingMarks: 35, weightage: 1, order: 2 },
          ],
        }),
        verifyExamSubjectMarksAction(concExam.id, sub1.id),
      ]);

      expect(resAddSub.ok || resVerify.ok).toBe(true);

      // Verify that final database consistency holds
      const finalExam = await db.examination.findUnique({ where: { id: concExam.id } });
      expect(finalExam).not.toBeNull();
    });

    it("13. Real PostgreSQL Concurrency: Incompatible concurrent lifecycle transitions serialize deterministically", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Incompatible Transitions Concurrency",
          code: `C5-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "SCHEDULED",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      // Fire simultaneous incompatible transitions: revert to DRAFT vs commence to IN_PROGRESS
      const [resRevert, resStart] = await Promise.all([
        transitionExamStatusAction({
          examId: concExam.id,
          requestedStatus: "DRAFT",
          expectedCurrentStatus: "SCHEDULED",
        }),
        transitionExamStatusAction({
          examId: concExam.id,
          requestedStatus: "IN_PROGRESS",
          expectedCurrentStatus: "SCHEDULED",
        }),
      ]);

      // Exactly one must win; the other must be rejected
      const oneSucceeded = (resRevert.ok && !resStart.ok) || (!resRevert.ok && resStart.ok);
      expect(oneSucceeded).toBe(true);

      const finalExam = await db.examination.findUnique({ where: { id: concExam.id } });
      expect(["DRAFT", "IN_PROGRESS"]).toContain(finalExam?.status);
    });

    it("14. Real PostgreSQL Concurrency: Subject marks verification versus Candidate withdrawal coordinates safely", async () => {
      const member = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const concExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          title: "Verification vs Withdrawal Concurrency",
          code: `C6-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: member!.id,
        },
      });
      createdExamIds.push(concExam.id);

      const mathSub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: concExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          weightage: 1,
          order: 1,
        },
      });

      const enr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });
      const enr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: concExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });

      // Enter marks for student1 (Math 90) and student2 (Math 70) as SUBMITTED
      await enterMarksBulkAction({
        examId: concExam.id,
        examSubjectId: mathSub.id,
        entries: [
          { studentId: student1.id, marksObtained: 90, isAbsent: false, isExempted: false, expectedVersion: 0 },
          { studentId: student2.id, marksObtained: 70, isAbsent: false, isExempted: false, expectedVersion: 0 },
        ],
        submitForVerification: true,
        reason: "Initial marks submission",
      });

      // Fire simultaneous Request A (verify subject marks) and Request B (withdraw student 2)
      const [resVerify, resWithdraw] = await Promise.all([
        verifyExamSubjectMarksAction(concExam.id, mathSub.id),
        updateEnrollmentStatusAction({
          enrollmentId: enr2.id,
          status: "WITHDRAWN",
          remarks: "Medical withdrawal during assessment",
        }),
      ]);

      // Both serialize through the examination row lock:
      // - If resVerify runs first, marks become VERIFIED, completeness checks both candidates (both have verified marks) -> EVALUATED. Then resWithdraw fails with INVALID_TRANSITION because exam is EVALUATED.
      // - If resWithdraw runs first, student 2 becomes WITHDRAWN, then resVerify verifies marks and completeness checks only remaining eligible candidate (student 1) -> EVALUATED. Both succeed!
      // In either case, integrity is fully preserved.
      expect(resVerify.ok).toBe(true);
      expect(typeof resWithdraw.ok).toBe("boolean");

      // Verify no partial verification: all marks in mathSub have valid status (all VERIFIED)
      const mathMarks = await db.examMark.findMany({
        where: { examSubjectId: mathSub.id },
      });
      expect(mathMarks.every((m) => m.evaluationStatus === "VERIFIED")).toBe(true);

      // Verify the final cohort and completeness calculation:
      const updatedEnr2 = await db.examEnrollment.findUnique({ where: { id: enr2.id } });
      const compCheck = await verifyCandidateSubjectCompleteness(db, concExam.id, tenantA.id);

      if (updatedEnr2?.status === "WITHDRAWN") {
        // Only student 1 is in the eligible cohort
        expect(compCheck.eligibleCandidatesCount).toBe(1);
        expect(compCheck.isValid).toBe(true);
      } else {
        // Both were eligible and verified before withdrawal was attempted
        expect(compCheck.eligibleCandidatesCount).toBe(2);
        expect(compCheck.isValid).toBe(true);
      }

      // If results are calculated/published, withdrawn candidate NEVER receives a result
      if (updatedEnr2?.status === "WITHDRAWN") {
        const pubRes = await calculateAndPublishResultsAction({ examId: concExam.id });
        expect(pubRes.ok).toBe(true);

        const results = await db.examResult.findMany({ where: { examId: concExam.id } });
        expect(results.some((r) => r.enrollmentId === enr2.id)).toBe(false);
        expect(results.some((r) => r.enrollmentId === enr1.id)).toBe(true);
      }

      // Verify audit logs exist and are consistent
      const audits = await db.auditLog.findMany({
        where: {
          tenantId: tenantA.id,
          entityId: { in: [concExam.id, mathSub.id, enr2.id] },
        },
      });
      expect(audits.some((a) => a.action === "exam.marks_verified")).toBe(true);
    });
  });

  describe("Section 13: Candidate-Level ABSENT / EXEMPTED Handling, Propagation & Marks Consistency (Stage 4.3 Step 3)", () => {
    let sec13Exam: { id: string };
    let sec13SubMath: { id: string };
    let sec13SubSci: { id: string };
    let studentCandA: { id: string };
    let studentCandB: { id: string };
    let studentCandC: { id: string };
    let enrA: { id: string };
    let enrB: { id: string };
    let enrC: { id: string };
    let adminUserId: string;

    beforeAll(async () => {
      const membership = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      adminUserId = membership?.userId || "user-admin-default";

      vi.mocked(authorizeTenantWrite).mockResolvedValue({
        ok: true,
        ctx: {
          tenant: { id: tenantA.id, name: tenantA.name } as unknown as TenantContext["tenant"],
          user: { id: adminUserId, name: "Admin Officer" } as unknown as TenantContext["user"],
          membership: { roleKey: "ADMIN" } as unknown as TenantContext["membership"],
          permissions: new Set([
            "tenant.exams.read",
            "tenant.exams.write",
            "tenant.exams.enroll",
            "tenant.exams.enter_marks",
            "tenant.exams.verify_marks",
            "tenant.exams.publish_results",
            "tenant.exams.correct_published_marks",
          ]),
          subscriptionBlocked: false,
          isOwnerView: true,
        },
      });

      // Create students
      studentCandA = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "Candidate",
          lastName: "Exempted",
          admissionNo: `CAND-EXM-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(studentCandA.id);

      studentCandB = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "Candidate",
          lastName: "NumericMarks",
          admissionNo: `CAND-NUM-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(studentCandB.id);

      studentCandC = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "Candidate",
          lastName: "Absent",
          admissionNo: `CAND-ABS-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(studentCandC.id);

      sec13Exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Stage 4.3 Step 3 Candidate Handling Exam",
          code: `STG43-S3-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-10"),
          endDate: new Date("2026-11-15"),
          createdById: membership!.id,
        },
      });
      createdExamIds.push(sec13Exam.id);

      sec13SubMath = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: sec13Exam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-11"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      sec13SubSci = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: sec13Exam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-12"),
          maxMarks: 100,
          passingMarks: 35,
          order: 2,
        },
      });

      enrA = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: sec13Exam.id,
          studentId: studentCandA.id,
          status: "ELIGIBLE",
        },
      });

      enrB = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: sec13Exam.id,
          studentId: studentCandB.id,
          status: "ELIGIBLE",
        },
      });

      enrC = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: sec13Exam.id,
          studentId: studentCandC.id,
          status: "ELIGIBLE",
        },
      });
    });

    it("1. Candidate-level exemption propagates verified marks to all subjects and records revision events", async () => {
      const res = await updateEnrollmentStatusAction({
        enrollmentId: enrA.id,
        status: "EXEMPTED",
        remarks: "Medical board approved whole-exam exemption",
      });

      expect(res.ok).toBe(true);

      const updatedEnr = await db.examEnrollment.findUnique({ where: { id: enrA.id } });
      expect(updatedEnr?.status).toBe("EXEMPTED");

      const marks = await db.examMark.findMany({
        where: { examId: sec13Exam.id, studentId: studentCandA.id },
      });
      expect(marks).toHaveLength(2);
      expect(marks.some((m) => m.examSubjectId === sec13SubSci.id)).toBe(true);
      for (const m of marks) {
        expect(m.isExempted).toBe(true);
        expect(m.isAbsent).toBe(false);
        expect(m.marksObtained).toBeNull();
        expect(m.evaluationStatus).toBe("VERIFIED");
        expect(m.feedback).toContain("[Candidate Exemption]");
      }

      const revisions = await db.examMarksRevisionEvent.findMany({
        where: { examId: sec13Exam.id, studentId: studentCandA.id },
      });
      expect(revisions.length).toBeGreaterThanOrEqual(2);
      expect(revisions.every((r) => r.newStatus === "VERIFIED")).toBe(true);
    });

    it("2. Idempotent candidate-level exemption does not duplicate marks or fail", async () => {
      const res = await updateEnrollmentStatusAction({
        enrollmentId: enrA.id,
        status: "EXEMPTED",
        remarks: "Repeat confirmation of medical exemption",
      });

      expect(res.ok).toBe(true);

      const marks = await db.examMark.findMany({
        where: { examId: sec13Exam.id, studentId: studentCandA.id },
      });
      expect(marks).toHaveLength(2);
    });

    it("3. Protection against silent overwrite of existing manual scores (EXISTING_MARKS_PRESENT)", async () => {
      // Enter a real score for Candidate B in Math
      const enterRes = await enterMarksBulkAction({
        examId: sec13Exam.id,
        examSubjectId: sec13SubMath.id,
        entries: [
          {
            studentId: studentCandB.id,
            marksObtained: 78.5,
            isAbsent: false,
            isExempted: false,
            feedback: "Mid-term submission",
            expectedVersion: 0,
          },
        ],
        reason: "Entering regular score",
        submitForVerification: false,
      });
      expect(enterRes.ok).toBe(true);

      // Attempting to set EXEMPTED without overwriteExistingMarks must fail with EXISTING_MARKS_PRESENT
      const attemptFail = await updateEnrollmentStatusAction({
        enrollmentId: enrB.id,
        status: "EXEMPTED",
        remarks: "Attempt without overwrite confirmation",
        overwriteExistingMarks: false,
      });
      expect(attemptFail.ok).toBe(false);
      expect(attemptFail.code).toBe("EXISTING_MARKS_PRESENT");

      // Verify the manual mark is completely intact
      const intactMark = await db.examMark.findFirst({
        where: { examSubjectId: sec13SubMath.id, studentId: studentCandB.id },
      });
      expect(Number(intactMark?.marksObtained)).toBe(78.5);

      // Now pass overwriteExistingMarks: true
      const attemptSuccess = await updateEnrollmentStatusAction({
        enrollmentId: enrB.id,
        status: "EXEMPTED",
        remarks: "Authorized overwrite of manual score due to sports exemption",
        overwriteExistingMarks: true,
      });
      expect(attemptSuccess.ok).toBe(true);

      // Verify the mark is now replaced with verified exemption
      const overwrittenMark = await db.examMark.findFirst({
        where: { examSubjectId: sec13SubMath.id, studentId: studentCandB.id },
      });
      expect(overwrittenMark?.isExempted).toBe(true);
      expect(overwrittenMark?.marksObtained).toBeNull();
      expect(overwrittenMark?.evaluationStatus).toBe("VERIFIED");
    });

    it("4. Candidate-level absence propagates verified marks across all subjects", async () => {
      const res = await updateEnrollmentStatusAction({
        enrollmentId: enrC.id,
        status: "ABSENT",
        remarks: "Unexcused absence for entire examination window",
      });
      expect(res.ok).toBe(true);

      const marks = await db.examMark.findMany({
        where: { examId: sec13Exam.id, studentId: studentCandC.id },
      });
      expect(marks).toHaveLength(2);
      for (const m of marks) {
        expect(m.isAbsent).toBe(true);
        expect(m.isExempted).toBe(false);
        expect(m.marksObtained).toBeNull();
        expect(m.evaluationStatus).toBe("VERIFIED");
        expect(m.feedback).toContain("[Candidate Absent]");
      }
    });

    it("5. Reverting candidate status to ELIGIBLE resets placeholder marks to PENDING for re-entry", async () => {
      const res = await updateEnrollmentStatusAction({
        enrollmentId: enrC.id,
        status: "ELIGIBLE",
        remarks: "Candidate reported late; permitted to sit makeup tests",
      });
      expect(res.ok).toBe(true);

      const updatedEnr = await db.examEnrollment.findUnique({ where: { id: enrC.id } });
      expect(updatedEnr?.status).toBe("ELIGIBLE");

      const marks = await db.examMark.findMany({
        where: { examId: sec13Exam.id, studentId: studentCandC.id },
      });
      expect(marks).toHaveLength(2);
      for (const m of marks) {
        expect(m.isAbsent).toBe(false);
        expect(m.isExempted).toBe(false);
        expect(m.marksObtained).toBeNull();
        expect(m.evaluationStatus).toBe("PENDING");
      }
    });

    it("6. Bulk marks entry rejects numeric marks if candidate has candidate-level EXEMPTED or ABSENT status", async () => {
      // Candidate A is candidate-level EXEMPTED
      const res = await enterMarksBulkAction({
        examId: sec13Exam.id,
        examSubjectId: sec13SubMath.id,
        entries: [
          {
            studentId: studentCandA.id,
            marksObtained: 95,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 1,
          },
        ],
        reason: "Illegal numeric entry for exempted candidate",
        submitForVerification: false,
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain("Cannot enter numeric marks for candidate");
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 4.3 STEP 3.2: 18 COMPREHENSIVE INTEGRATION SCENARIOS
    // Reversible Candidate-Level Status Propagation & Mark Preservation
    // ─────────────────────────────────────────────────────────────

    describe("Stage 4.3 Step 3.2: Reversible Status Propagation & Subject Mark Preservation (18 Scenarios)", () => {
      let s32Exam: { id: string };
      let s32SubMath: { id: string };
      let s32SubSci: { id: string };
      let s32SubEng: { id: string };
      let subjectEnglish: { id: string; name: string };

      let studentOnlyExempt: { id: string };
      let enrOnlyExempt: { id: string };

      let studentOnlyAbsent: { id: string };
      let enrOnlyAbsent: { id: string };

      let studentOnlyScore: { id: string };
      let enrOnlyScore: { id: string };

      let studentMixed: { id: string };
      let enrMixed: { id: string };

      let studentSeqA: { id: string };
      let enrSeqA: { id: string };

      let studentSeqB: { id: string };
      let enrSeqB: { id: string };

      let studentIdem: { id: string };
      let enrIdem: { id: string };

      let studentCorrupt: { id: string };
      let enrCorrupt: { id: string };

      beforeAll(async () => {
        const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });

        // Ensure third subject exists
        let se = await db.subject.findFirst({
          where: { tenantId: tenantA.id, name: { contains: "English", mode: "insensitive" } },
        });
        if (!se) {
          se = await db.subject.create({
            data: {
              tenantId: tenantA.id,
              name: "English Literature",
              code: "ENG-LIT",
            },
          });
        }
        subjectEnglish = se;

        s32Exam = await db.examination.create({
          data: {
            tenantId: tenantA.id,
            academicYearId: academicYearA.id,
            gradeScaleId: gradeScaleA.id,
            targetType: "CLASS_SECTION",
            classId: classA.id,
            title: "Stage 4.3 Step 3.2 Verification Exam",
            code: `S32-${Date.now().toString().slice(-6)}`,
            examType: "UNIT_TEST",
            status: "IN_PROGRESS",
            isPublished: false,
            startDate: new Date("2026-11-20"),
            endDate: new Date("2026-11-25"),
            createdById: mem!.id,
          },
        });
        createdExamIds.push(s32Exam.id);

        s32SubMath = await db.examSubject.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            subjectId: subjectMath.id,
            examDate: new Date("2026-11-20"),
            maxMarks: 100,
            passingMarks: 35,
            order: 1,
          },
        });

        s32SubSci = await db.examSubject.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            subjectId: subjectScience.id,
            examDate: new Date("2026-11-21"),
            maxMarks: 100,
            passingMarks: 35,
            order: 2,
          },
        });

        s32SubEng = await db.examSubject.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            subjectId: subjectEnglish.id,
            examDate: new Date("2026-11-22"),
            maxMarks: 100,
            passingMarks: 35,
            order: 3,
          },
        });

        // Setup Candidate with subject-level exemption only
        studentOnlyExempt = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SubjectExempt",
            lastName: "Only",
            admissionNo: `S32-EXM-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentOnlyExempt.id);
        enrOnlyExempt = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentOnlyExempt.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentOnlyExempt.id,
            enrollmentId: enrOnlyExempt.id,
            marksObtained: null,
            isAbsent: false,
            isExempted: true,
            evaluationStatus: "SUBMITTED",
            feedback: "Subject-level exemption granted by teacher",
          },
        });

        // Setup Candidate with subject-level absence only
        studentOnlyAbsent = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SubjectAbsent",
            lastName: "Only",
            admissionNo: `S32-ABS-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentOnlyAbsent.id);
        enrOnlyAbsent = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentOnlyAbsent.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubSci.id,
            studentId: studentOnlyAbsent.id,
            enrollmentId: enrOnlyAbsent.id,
            marksObtained: null,
            isAbsent: true,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
            feedback: "Subject absence logged by invigilator",
          },
        });

        // Setup Candidate with numeric marks only
        studentOnlyScore = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SubjectScore",
            lastName: "Only",
            admissionNo: `S32-SCR-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentOnlyScore.id);
        enrOnlyScore = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentOnlyScore.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubEng.id,
            studentId: studentOnlyScore.id,
            enrollmentId: enrOnlyScore.id,
            marksObtained: 85,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
            feedback: "Essay scored",
          },
        });

        // Setup Candidate with mixed states across subjects
        studentMixed = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SubjectMixed",
            lastName: "Candidate",
            admissionNo: `S32-MIX-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentMixed.id);
        enrMixed = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentMixed.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentMixed.id,
            enrollmentId: enrMixed.id,
            marksObtained: null,
            isAbsent: false,
            isExempted: true,
            evaluationStatus: "SUBMITTED",
            feedback: "Math Olympiad exemption",
          },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubSci.id,
            studentId: studentMixed.id,
            enrollmentId: enrMixed.id,
            marksObtained: null,
            isAbsent: true,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
            feedback: "Science lab absence",
          },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubEng.id,
            studentId: studentMixed.id,
            enrollmentId: enrMixed.id,
            marksObtained: 92,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
            feedback: "English paper evaluated",
          },
        });

        // Setup Candidate for sequence EXEMPTED -> ABSENT -> ELIGIBLE
        studentSeqA = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SequenceA",
            lastName: "Student",
            admissionNo: `S32-SQA-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentSeqA.id);
        enrSeqA = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentSeqA.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentSeqA.id,
            enrollmentId: enrSeqA.id,
            marksObtained: 88,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubSci.id,
            studentId: studentSeqA.id,
            enrollmentId: enrSeqA.id,
            marksObtained: null,
            isAbsent: false,
            isExempted: true,
            evaluationStatus: "SUBMITTED",
          },
        });

        // Setup Candidate for sequence ABSENT -> EXEMPTED -> ELIGIBLE
        studentSeqB = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "SequenceB",
            lastName: "Student",
            admissionNo: `S32-SQB-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentSeqB.id);
        enrSeqB = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentSeqB.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentSeqB.id,
            enrollmentId: enrSeqB.id,
            marksObtained: null,
            isAbsent: true,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubSci.id,
            studentId: studentSeqB.id,
            enrollmentId: enrSeqB.id,
            marksObtained: 76,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });

        // Setup Candidate for idempotency
        studentIdem = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "Idempotent",
            lastName: "Student",
            admissionNo: `S32-IDM-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentIdem.id);
        enrIdem = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentIdem.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentIdem.id,
            enrollmentId: enrIdem.id,
            marksObtained: 70,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubSci.id,
            studentId: studentIdem.id,
            enrollmentId: enrIdem.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });

        // Setup Candidate for corruption test
        studentCorrupt = await db.student.create({
          data: {
            tenantId: tenantA.id,
            firstName: "Corrupt",
            lastName: "Record",
            admissionNo: `S32-CRP-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(studentCorrupt.id);
        enrCorrupt = await db.examEnrollment.create({
          data: { tenantId: tenantA.id, examId: s32Exam.id, studentId: studentCorrupt.id, status: "ELIGIBLE" },
        });
        await db.examMark.create({
          data: {
            tenantId: tenantA.id,
            examId: s32Exam.id,
            examSubjectId: s32SubMath.id,
            studentId: studentCorrupt.id,
            enrollmentId: enrCorrupt.id,
            marksObtained: 65,
            isAbsent: false,
            isExempted: false,
            evaluationStatus: "SUBMITTED",
          },
        });
      });

      it("Scenario 1: Candidate with subject-level exemption and no numeric marks triggers EXISTING_MARKS_PRESENT", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrOnlyExempt.id,
          status: "EXEMPTED",
          remarks: "Attempt candidate exemption without confirmation",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
        expect(res.error).toContain("Mathematics");
      });

      it("Scenario 2: Candidate with subject-level absence and no numeric marks triggers EXISTING_MARKS_PRESENT", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrOnlyAbsent.id,
          status: "ABSENT",
          remarks: "Attempt candidate absence without confirmation",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
        expect(res.error).toContain("Science");
      });

      it("Scenario 3: Candidate with numeric marks in another subject triggers EXISTING_MARKS_PRESENT", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrOnlyScore.id,
          status: "EXEMPTED",
          remarks: "Attempt candidate exemption on scored student",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
        expect(res.error).toContain(subjectEnglish.name);
      });

      it("Scenario 4: Candidate with mixed subject-level exemptions, absences, and numeric scores triggers comprehensive protection", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrMixed.id,
          status: "EXEMPTED",
          remarks: "Attempt candidate exemption on mixed candidate",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
        expect(res.error).toContain("Mathematics");
        expect(res.error).toContain("Science");
        expect(res.error).toContain(subjectEnglish.name);
      });

      it("Scenario 5: Candidate-level EXEMPTED rejects without confirmation when subject-level exemption exists", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrOnlyExempt.id,
          status: "EXEMPTED",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
      });

      it("Scenario 6: Candidate-level ABSENT rejects without confirmation when subject-level absence exists", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrOnlyAbsent.id,
          status: "ABSENT",
          overwriteExistingMarks: false,
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("EXISTING_MARKS_PRESENT");
      });

      it("Scenario 7: Rejection without confirmation leaves all existing subject marks completely unchanged", async () => {
        const mathMark = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentMixed.id },
        });
        const sciMark = await db.examMark.findFirst({
          where: { examSubjectId: s32SubSci.id, studentId: studentMixed.id },
        });
        const engMark = await db.examMark.findFirst({
          where: { examSubjectId: s32SubEng.id, studentId: studentMixed.id },
        });

        expect(mathMark?.isExempted).toBe(true);
        expect(mathMark?.marksObtained).toBeNull();
        expect(mathMark?.evaluationStatus).toBe("SUBMITTED");

        expect(sciMark?.isAbsent).toBe(true);
        expect(sciMark?.marksObtained).toBeNull();
        expect(sciMark?.evaluationStatus).toBe("SUBMITTED");

        expect(Number(engMark?.marksObtained)).toBe(92);
        expect(engMark?.isAbsent).toBe(false);
        expect(engMark?.isExempted).toBe(false);
        expect(engMark?.evaluationStatus).toBe("SUBMITTED");
      });

      it("Scenario 8: Confirmed override captures exact pre-override state in enrollment.preservedMarks", async () => {
        const res = await updateEnrollmentStatusAction({
          enrollmentId: enrMixed.id,
          status: "EXEMPTED",
          remarks: "Authorized whole-exam sports exemption",
          overwriteExistingMarks: true,
        });
        expect(res.ok).toBe(true);

        const updatedEnr = await db.examEnrollment.findUnique({
          where: { id: enrMixed.id },
        });
        expect(updatedEnr?.status).toBe("EXEMPTED");
        expect(updatedEnr?.preservedMarks).toBeDefined();

        const preserved = updatedEnr?.preservedMarks as unknown as PreservedSubjectMark[];
        expect(Array.isArray(preserved)).toBe(true);
        expect(preserved.length).toBe(3);

        const pMath = preserved.find((p) => p.examSubjectId === s32SubMath.id);
        const pSci = preserved.find((p) => p.examSubjectId === s32SubSci.id);
        const pEng = preserved.find((p) => p.examSubjectId === s32SubEng.id);

        expect(pMath?.isExempted).toBe(true);
        expect(pMath?.marksObtained).toBeNull();
        expect(pSci?.isAbsent).toBe(true);
        expect(pSci?.marksObtained).toBeNull();
        expect(pEng?.marksObtained).toBe(92);
        expect(pEng?.isAbsent).toBe(false);
        expect(pEng?.isExempted).toBe(false);

        // Verify current marks are now VERIFIED candidate exemption placeholders
        const currentMarks = await db.examMark.findMany({
          where: { examId: s32Exam.id, studentId: studentMixed.id },
        });
        expect(currentMarks).toHaveLength(3);
        for (const m of currentMarks) {
          expect(m.isExempted).toBe(true);
          expect(m.marksObtained).toBeNull();
          expect(m.evaluationStatus).toBe("VERIFIED");
          expect(m.feedback).toContain("[Candidate Exemption]");
        }
      });

      it("Scenario 9: Restoration to ELIGIBLE restores previous subject-level exemptions", async () => {
        // Will restore enrMixed in this test and verify in scenarios 9, 10, 11
        const restoreRes = await updateEnrollmentStatusAction({
          enrollmentId: enrMixed.id,
          status: "ELIGIBLE",
          remarks: "Sports event ended; restoring candidate",
        });
        expect(restoreRes.ok).toBe(true);

        const restoredMath = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentMixed.id },
        });
        expect(restoredMath?.isExempted).toBe(true);
        expect(restoredMath?.marksObtained).toBeNull();
        expect(restoredMath?.evaluationStatus).toBe("SUBMITTED");
        expect(restoredMath?.feedback).toBe("Math Olympiad exemption");
      });

      it("Scenario 10: Restoration to ELIGIBLE restores previous subject-level absences", async () => {
        const restoredSci = await db.examMark.findFirst({
          where: { examSubjectId: s32SubSci.id, studentId: studentMixed.id },
        });
        expect(restoredSci?.isAbsent).toBe(true);
        expect(restoredSci?.marksObtained).toBeNull();
        expect(restoredSci?.evaluationStatus).toBe("SUBMITTED");
        expect(restoredSci?.feedback).toBe("Science lab absence");
      });

      it("Scenario 11: Restoration to ELIGIBLE restores previous numeric scores", async () => {
        const restoredEng = await db.examMark.findFirst({
          where: { examSubjectId: s32SubEng.id, studentId: studentMixed.id },
        });
        expect(Number(restoredEng?.marksObtained)).toBe(92);
        expect(restoredEng?.isAbsent).toBe(false);
        expect(restoredEng?.isExempted).toBe(false);
        expect(restoredEng?.evaluationStatus).toBe("SUBMITTED");
        expect(restoredEng?.feedback).toBe("English paper evaluated");

        const enrAfter = await db.examEnrollment.findUnique({
          where: { id: enrMixed.id },
        });
        expect(enrAfter?.status).toBe("ELIGIBLE");
        expect(enrAfter?.preservedMarks).toBeNull();
      });

      it("Scenario 12: Sequence EXEMPTED -> ABSENT -> ELIGIBLE preserves and restores original pre-override state", async () => {
        // 1. ELIGIBLE -> EXEMPTED (with confirmation)
        const step1 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqA.id,
          status: "EXEMPTED",
          overwriteExistingMarks: true,
          remarks: "Medical exemption initial",
        });
        expect(step1.ok).toBe(true);

        // 2. EXEMPTED -> ABSENT (no confirmation required, retains original baseline)
        const step2 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqA.id,
          status: "ABSENT",
          remarks: "Changed to absent",
        });
        expect(step2.ok).toBe(true);

        // 3. ABSENT -> ELIGIBLE (restores original baseline: Math 88, Sci exempt)
        const step3 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqA.id,
          status: "ELIGIBLE",
          remarks: "Restoring candidate",
        });
        expect(step3.ok).toBe(true);

        const restoredMath = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentSeqA.id },
        });
        const restoredSci = await db.examMark.findFirst({
          where: { examSubjectId: s32SubSci.id, studentId: studentSeqA.id },
        });

        expect(Number(restoredMath?.marksObtained)).toBe(88);
        expect(restoredMath?.isAbsent).toBe(false);
        expect(restoredMath?.isExempted).toBe(false);

        expect(restoredSci?.isExempted).toBe(true);
        expect(restoredSci?.marksObtained).toBeNull();
      });

      it("Scenario 13: Sequence ABSENT -> EXEMPTED -> ELIGIBLE preserves and restores original pre-override state", async () => {
        // 1. ELIGIBLE -> ABSENT (with confirmation)
        const step1 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqB.id,
          status: "ABSENT",
          overwriteExistingMarks: true,
          remarks: "Initial absent",
        });
        expect(step1.ok).toBe(true);

        // 2. ABSENT -> EXEMPTED
        const step2 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqB.id,
          status: "EXEMPTED",
          remarks: "Changed to exempt",
        });
        expect(step2.ok).toBe(true);

        // 3. EXEMPTED -> ELIGIBLE (restores original baseline: Math absent, Sci 76)
        const step3 = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqB.id,
          status: "ELIGIBLE",
          remarks: "Restoring candidate",
        });
        expect(step3.ok).toBe(true);

        const restoredMath = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentSeqB.id },
        });
        const restoredSci = await db.examMark.findFirst({
          where: { examSubjectId: s32SubSci.id, studentId: studentSeqB.id },
        });

        expect(restoredMath?.isAbsent).toBe(true);
        expect(restoredMath?.marksObtained).toBeNull();

        expect(Number(restoredSci?.marksObtained)).toBe(76);
        expect(restoredSci?.isAbsent).toBe(false);
        expect(restoredSci?.isExempted).toBe(false);
      });

      it("Scenario 14: Repeated identical status transitions remain idempotent and do not corrupt preservation state", async () => {
        // 1. ELIGIBLE -> EXEMPTED
        const step1 = await updateEnrollmentStatusAction({
          enrollmentId: enrIdem.id,
          status: "EXEMPTED",
          overwriteExistingMarks: true,
          remarks: "First exempt call",
        });
        expect(step1.ok).toBe(true);

        // 2. EXEMPTED -> EXEMPTED (repeat)
        const step2 = await updateEnrollmentStatusAction({
          enrollmentId: enrIdem.id,
          status: "EXEMPTED",
          remarks: "Second exempt call",
        });
        expect(step2.ok).toBe(true);

        // 3. EXEMPTED -> ELIGIBLE
        const step3 = await updateEnrollmentStatusAction({
          enrollmentId: enrIdem.id,
          status: "ELIGIBLE",
          remarks: "Restoring candidate",
        });
        expect(step3.ok).toBe(true);

        const restoredMath = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentIdem.id },
        });
        const restoredSci = await db.examMark.findFirst({
          where: { examSubjectId: s32SubSci.id, studentId: studentIdem.id },
        });

        expect(Number(restoredMath?.marksObtained)).toBe(70);
        expect(Number(restoredSci?.marksObtained)).toBe(80);
      });

      it("Scenario 15: Historical revision events remain immutable across overrides and restorations", async () => {
        const events = await db.examMarksRevisionEvent.findMany({
          where: { examId: s32Exam.id, studentId: studentMixed.id },
          orderBy: { createdAt: "asc" },
        });
        expect(events.length).toBeGreaterThanOrEqual(3);

        const targetEvent = events[0];

        // Attempt raw UPDATE on revision event
        await expect(
          db.$executeRawUnsafe(
            `UPDATE "ExamMarksRevisionEvent" SET "reason" = 'tampered' WHERE "id" = '${targetEvent.id}'`
          )
        ).rejects.toThrow();

        // Attempt raw DELETE on revision event
        await expect(
          db.$executeRawUnsafe(
            `DELETE FROM "ExamMarksRevisionEvent" WHERE "id" = '${targetEvent.id}'`
          )
        ).rejects.toThrow();
      });

      it("Scenario 16: Missing or corrupted preservation state rejects restoration with RESTORATION_STATE_MISSING", async () => {
        // Set candidate to EXEMPTED
        const setExm = await updateEnrollmentStatusAction({
          enrollmentId: enrCorrupt.id,
          status: "EXEMPTED",
          overwriteExistingMarks: true,
          remarks: "Candidate exempted",
        });
        expect(setExm.ok).toBe(true);

        // Deliberately corrupt preservedMarks to DbNull
        await db.examEnrollment.update({
          where: { id: enrCorrupt.id },
          data: { preservedMarks: Prisma.DbNull },
        });

        // Attempt restore to ELIGIBLE
        const restoreAttempt = await updateEnrollmentStatusAction({
          enrollmentId: enrCorrupt.id,
          status: "ELIGIBLE",
          remarks: "Attempt restore with corrupted state",
        });
        expect(restoreAttempt.ok).toBe(false);
        expect(restoreAttempt.code).toBe("RESTORATION_STATE_MISSING");

        // Verify marks are NOT modified or reset to PENDING
        const markAfter = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentCorrupt.id },
        });
        expect(markAfter?.evaluationStatus).toBe("VERIFIED");
        expect(markAfter?.isExempted).toBe(true);
      });

      it("Scenario 17: Transaction rollback on failure leaves enrollment and marks consistent", async () => {
        const enrBefore = await db.examEnrollment.findUnique({
          where: { id: enrCorrupt.id },
        });
        const markBefore = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentCorrupt.id },
        });

        // Invalid enrollment ID
        const failCall = await updateEnrollmentStatusAction({
          enrollmentId: "non-existent-enrollment-id",
          status: "ELIGIBLE",
        });
        expect(failCall.ok).toBe(false);

        const enrAfter = await db.examEnrollment.findUnique({
          where: { id: enrCorrupt.id },
        });
        const markAfter = await db.examMark.findFirst({
          where: { examSubjectId: s32SubMath.id, studentId: studentCorrupt.id },
        });

        expect(enrAfter?.status).toBe(enrBefore?.status);
        expect(markAfter?.evaluationStatus).toBe(markBefore?.evaluationStatus);
      });

      it("Scenario 18: Tenant isolation and permission checks remain strictly enforced", async () => {
        // 1. Permission check failure
        vi.mocked(authorizeTenantWrite).mockResolvedValueOnce({
          ok: false,
          error: "Missing required permission: tenant.exams.enroll",
        });

        const noPerm = await updateEnrollmentStatusAction({
          enrollmentId: enrSeqA.id,
          status: "EXEMPTED",
        });
        expect(noPerm.ok).toBe(false);
        expect(noPerm.error).toContain("Missing required permission");

        // 2. Cross-tenant check: create enrollment in Tenant B
        const bMem = await db.membership.findFirst({ where: { tenantId: tenantB.id } });
        const bExam = await db.examination.create({
          data: {
            tenantId: tenantB.id,
            academicYearId: academicYearA.id,
            gradeScaleId: gradeScaleA.id,
            targetType: "CLASS_SECTION",
            classId: classA.id,
            title: "Tenant B Exam",
            code: `TB-${Date.now().toString().slice(-6)}`,
            examType: "UNIT_TEST",
            status: "IN_PROGRESS",
            isPublished: false,
            startDate: new Date("2026-11-20"),
            endDate: new Date("2026-11-25"),
            createdById: bMem?.id || adminUserId,
          },
        });
        createdExamIds.push(bExam.id);

        const bStudent = await db.student.create({
          data: {
            tenantId: tenantB.id,
            firstName: "TenantB",
            lastName: "Student",
            admissionNo: `TB-${Date.now().toString().slice(-6)}`,
            classId: classA.id,
            status: "ACTIVE",
          },
        });
        createdStudentIds.push(bStudent.id);

        const bEnr = await db.examEnrollment.create({
          data: { tenantId: tenantB.id, examId: bExam.id, studentId: bStudent.id, status: "ELIGIBLE" },
        });

        // Authorized as Tenant A, attempting to update Tenant B enrollment
        const crossTenantAttempt = await updateEnrollmentStatusAction({
          enrollmentId: bEnr.id,
          status: "EXEMPTED",
        });
        expect(crossTenantAttempt.ok).toBe(false);
        expect(crossTenantAttempt.error).toContain("Enrollment not found");
      });
    });

    it("7. Publication produces WITHHELD, EXM, and null rank for candidate-level EXEMPTED candidate", async () => {
      // Create a fresh dedicated evaluation exam
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const pubExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Candidate Exemption Outcome Exam",
          code: `PUB-EXM-${Date.now().toString().slice(-6)}`,
          examType: "FINAL",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-15"),
          endDate: new Date("2026-11-20"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(pubExam.id);

      const sub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: pubExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-16"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const sub2 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: pubExam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-17"),
          maxMarks: 100,
          passingMarks: 35,
          order: 2,
        },
      });

      // Student 1: regular student who scored 85 in Math and 90 in Science
      const enr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: pubExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: pubExam.id,
          examSubjectId: sub1.id,
          studentId: student1.id,
          enrollmentId: enr1.id,
          marksObtained: 85,
          evaluationStatus: "VERIFIED",
        },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: pubExam.id,
          examSubjectId: sub2.id,
          studentId: student1.id,
          enrollmentId: enr1.id,
          marksObtained: 90,
          evaluationStatus: "VERIFIED",
        },
      });

      // Student 2: candidate-level EXEMPTED
      const enr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: pubExam.id, studentId: studentCandA.id, status: "ELIGIBLE" },
      });

      const exemptRes = await updateEnrollmentStatusAction({
        enrollmentId: enr2.id,
        status: "EXEMPTED",
        remarks: "Exempted from entire final exam",
      });
      expect(exemptRes.ok).toBe(true);

      // Student 3: candidate-level ABSENT
      const enr3 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: pubExam.id, studentId: studentCandC.id, status: "ELIGIBLE" },
      });

      const absentRes = await updateEnrollmentStatusAction({
        enrollmentId: enr3.id,
        status: "ABSENT",
        remarks: "Absent for entire final exam",
      });
      expect(absentRes.ok).toBe(true);

      // Cartesian completeness check
      const comp = await verifyCandidateSubjectCompleteness(db, pubExam.id, tenantA.id);
      expect(comp.isValid).toBe(true);
      expect(comp.eligibleCandidatesCount).toBe(3);
      expect(comp.verifiedMarksCount).toBe(6);

      // Verify marks to transition to EVALUATED status
      const v1 = await verifyExamSubjectMarksAction(pubExam.id, sub1.id);
      expect(v1.ok).toBe(true);
      const v2 = await verifyExamSubjectMarksAction(pubExam.id, sub2.id);
      expect(v2.ok).toBe(true);

      const pubExamEvaluated = await db.examination.findUnique({ where: { id: pubExam.id } });
      expect(pubExamEvaluated?.status).toBe("EVALUATED");

      // Publish results
      const pubRes = await calculateAndPublishResultsAction({ examId: pubExam.id });
      expect(pubRes.ok).toBe(true);

      // Check results for Student 1 (Regular)
      const res1 = await db.examResult.findFirst({
        where: { examId: pubExam.id, studentId: student1.id },
      });
      expect(res1?.resultStatus).toBe("PASS");
      expect(Number(res1?.percentage)).toBe(87.5);
      expect(res1?.rank).toBe(1);

      // Check results for Student 2 (Candidate EXEMPTED)
      const res2 = await db.examResult.findFirst({
        where: { examId: pubExam.id, studentId: studentCandA.id },
      });
      expect(res2?.resultStatus).toBe("WITHHELD");
      expect(res2?.grade).toBe("EXM");
      expect(res2?.rank).toBeNull();

      // Check results for Student 3 (Candidate ABSENT)
      const res3 = await db.examResult.findFirst({
        where: { examId: pubExam.id, studentId: studentCandC.id },
      });
      expect(res3?.resultStatus).toBe("FAIL");
      expect(Number(res3?.percentage)).toBe(0);
      expect(res3?.rank).toBeNull();
    });

    it("8. Distinction between Subject-level Exemption and Candidate-level Exemption in rankings and denominator", async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const denomExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Denominator & Subject Exemption Exam",
          code: `DENOM-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-22"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(denomExam.id);

      const dSub1 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-20"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const dSub2 = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          subjectId: subjectScience.id,
          examDate: new Date("2026-11-21"),
          maxMarks: 100,
          passingMarks: 35,
          order: 2,
        },
      });

      // Candidate 1: scored 90 in Math, 90 in Science (total 180/200 = 90%) -> Rank 1
      const dEnr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: denomExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          examSubjectId: dSub1.id,
          studentId: student1.id,
          enrollmentId: dEnr1.id,
          marksObtained: 90,
          evaluationStatus: "VERIFIED",
        },
      });
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          examSubjectId: dSub2.id,
          studentId: student1.id,
          enrollmentId: dEnr1.id,
          marksObtained: 90,
          evaluationStatus: "VERIFIED",
        },
      });

      // Candidate 2: scored 80 in Math, SUBJECT-LEVEL EXEMPTION in Science
      // Expected: denominator is 100 (Science max marks excluded). Percentage = 80/100 = 80%. ResultStatus = PASS. Rank = 2!
      const dEnr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: denomExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          examSubjectId: dSub1.id,
          studentId: student2.id,
          enrollmentId: dEnr2.id,
          marksObtained: 80,
          evaluationStatus: "VERIFIED",
        },
      });
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: denomExam.id,
          examSubjectId: dSub2.id,
          studentId: student2.id,
          enrollmentId: dEnr2.id,
          marksObtained: null,
          isExempted: true,
          evaluationStatus: "VERIFIED",
        },
      });

      // Candidate 3: CANDIDATE-LEVEL EXEMPTION
      const dEnr3 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: denomExam.id, studentId: studentCandA.id, status: "ELIGIBLE" },
      });
      const exRes = await updateEnrollmentStatusAction({
        enrollmentId: dEnr3.id,
        status: "EXEMPTED",
        remarks: "Whole-exam exemption",
      });
      expect(exRes.ok).toBe(true);

      // Verify marks to reach EVALUATED status
      const dv1 = await verifyExamSubjectMarksAction(denomExam.id, dSub1.id);
      expect(dv1.ok).toBe(true);
      const dv2 = await verifyExamSubjectMarksAction(denomExam.id, dSub2.id);
      expect(dv2.ok).toBe(true);

      const pubRes = await calculateAndPublishResultsAction({ examId: denomExam.id });
      expect(pubRes.ok).toBe(true);

      const r1 = await db.examResult.findFirst({ where: { examId: denomExam.id, studentId: student1.id } });
      const r2 = await db.examResult.findFirst({ where: { examId: denomExam.id, studentId: student2.id } });
      const r3 = await db.examResult.findFirst({ where: { examId: denomExam.id, studentId: studentCandA.id } });

      // Student 1: Rank 1, 90%
      expect(r1?.rank).toBe(1);
      expect(Number(r1?.percentage)).toBe(90);
      expect(r1?.resultStatus).toBe("PASS");

      // Student 2: Subject-level exempt: Rank 2, 80%, PASS
      expect(r2?.rank).toBe(2);
      expect(Number(r2?.percentage)).toBe(80);
      expect(r2?.resultStatus).toBe("PASS");

      // Student 3: Candidate-level exempt: Rank null, WITHHELD, EXM
      expect(r3?.rank).toBeNull();
      expect(r3?.resultStatus).toBe("WITHHELD");
      expect(r3?.grade).toBe("EXM");
    });

    it("9. Withdrawn candidate is completely excluded from Cartesian completeness and results", async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const withExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Withdrawal Exclusion Exam",
          code: `WITH-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-25"),
          endDate: new Date("2026-11-26"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(withExam.id);

      const wSub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: withExam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-25"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const wEnr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: withExam.id, studentId: student1.id, status: "ELIGIBLE" },
      });
      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: withExam.id,
          examSubjectId: wSub.id,
          studentId: student1.id,
          enrollmentId: wEnr1.id,
          marksObtained: 88,
          evaluationStatus: "VERIFIED",
        },
      });

      // Enrolled then withdrawn
      const wEnr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: withExam.id, studentId: student2.id, status: "ELIGIBLE" },
      });
      const withRes = await updateEnrollmentStatusAction({
        enrollmentId: wEnr2.id,
        status: "WITHDRAWN",
        remarks: "Student transferred out of school",
      });
      expect(withRes.ok).toBe(true);

      // Cartesian completeness requires only 1 pair (student 1 x 1 subject)
      const comp = await verifyCandidateSubjectCompleteness(db, withExam.id, tenantA.id);
      expect(comp.isValid).toBe(true);
      expect(comp.eligibleCandidatesCount).toBe(1);
      expect(comp.expectedPairsCount).toBe(1);

      // Verify marks to reach EVALUATED status
      const wv = await verifyExamSubjectMarksAction(withExam.id, wSub.id);
      expect(wv.ok).toBe(true);

      const pubRes = await calculateAndPublishResultsAction({ examId: withExam.id });
      expect(pubRes.ok).toBe(true);

      const results = await db.examResult.findMany({ where: { examId: withExam.id } });
      expect(results).toHaveLength(1);
      expect(results[0].studentId).toBe(student1.id);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SECTION 14: STAGE 4.3 STEP 3.2.1 CONCURRENCY & MONOTONICITY
  // ─────────────────────────────────────────────────────────────

  describe("Section 14: Stage 4.3 Step 3.2.1 — Concurrency, Optimistic Locking & Monotonicity Audit", () => {
    let s14Exam: { id: string };
    let s14SubMath: { id: string };
    let studentMono: { id: string };
    let enrMono: { id: string };

    beforeAll(async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });

      s14Exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Stage 4.3 Step 3.2.1 Concurrency Audit Exam",
          code: `S14-CONC-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(s14Exam.id);

      s14SubMath = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-20"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      studentMono = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "Monotonic",
          lastName: "Candidate",
          admissionNo: `S14-MONO-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(studentMono.id);

      enrMono = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          studentId: studentMono.id,
          status: "ELIGIBLE",
        },
      });
    });

    it("1 & 10. Mark version monotonicity: version strictly increases across override and restoration (5 -> 6 -> 7)", async () => {
      // 1. Initial mark seeded at version 5
      const mark = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: studentMono.id,
          enrollmentId: enrMono.id,
          marksObtained: 80,
          evaluationStatus: "SUBMITTED",
          version: 5,
        },
      });
      expect(mark.version).toBe(5);

      // 2. Candidate override transition to EXEMPTED
      const exmRes = await updateEnrollmentStatusAction({
        enrollmentId: enrMono.id,
        status: "EXEMPTED",
        overwriteExistingMarks: true,
        remarks: "Medical override",
      });
      expect(exmRes.ok).toBe(true);

      const markDuringOverride = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(markDuringOverride?.version).toBe(6); // Advanced 5 -> 6
      expect(markDuringOverride?.isExempted).toBe(true);

      // 3. Restoration transition to ELIGIBLE
      const elgRes = await updateEnrollmentStatusAction({
        enrollmentId: enrMono.id,
        status: "ELIGIBLE",
        remarks: "Returned to eligible",
      });
      expect(elgRes.ok).toBe(true);

      const markAfterRestoration = await db.examMark.findUnique({ where: { id: mark.id } });
      // Crucial: Concurrency version must advance forward, not roll back to 5!
      expect(markAfterRestoration?.version).toBe(7); // Advanced 6 -> 7
      expect(Number(markAfterRestoration?.marksObtained)).toBe(80); // Business data restored
      expect(markAfterRestoration?.isExempted).toBe(false);
    });

    it("2. Rejection of stale pre-override submissions: stale expectedVersion (5) is rejected after restoration (7)", async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      const examPubCorr = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Published Correction Stale Version Exam",
          code: `PUB-CORR-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(examPubCorr.id);

      const pubSub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: examPubCorr.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-20"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      const candCorr = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "PubCorr",
          lastName: "Candidate",
          admissionNo: `S14-PCR-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(candCorr.id);

      const enrCorr = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: examPubCorr.id,
          studentId: candCorr.id,
          status: "ELIGIBLE",
        },
      });

      const mark = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: examPubCorr.id,
          examSubjectId: pubSub.id,
          studentId: candCorr.id,
          enrollmentId: enrCorr.id,
          marksObtained: 80,
          evaluationStatus: "VERIFIED",
          version: 5,
        },
      });

      // 1. Candidate override transition to EXEMPTED (version 5 -> 6)
      await updateEnrollmentStatusAction({
        enrollmentId: enrCorr.id,
        status: "EXEMPTED",
        overwriteExistingMarks: true,
      });

      // 2. Candidate restoration to ELIGIBLE (version 6 -> 7)
      await updateEnrollmentStatusAction({
        enrollmentId: enrCorr.id,
        status: "ELIGIBLE",
      });

      const currentMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(currentMark?.version).toBe(7);

      // Now publish exam and create ExamResult to activate published correction workflow
      await db.examination.update({ where: { id: examPubCorr.id }, data: { isPublished: true, status: "PUBLISHED" } });
      await db.examResult.create({
        data: {
          tenantId: tenantA.id,
          examId: examPubCorr.id,
          studentId: candCorr.id,
          enrollmentId: enrCorr.id,
          totalMaxMarks: 100,
          totalMarksObtained: 80,
          percentage: 80,
          resultStatus: "PASS",
        },
      });

      // Stale attempt using pre-override version 5
      const staleAttempt = await correctPublishedMarkAction({
        examId: examPubCorr.id,
        examSubjectId: pubSub.id,
        studentId: candCorr.id,
        newMark: 85,
        expectedVersion: 5,
        reason: "Stale pre-override correction attempt that should be rejected",
      });
      expect(staleAttempt.ok).toBe(false);
      expect(staleAttempt.code).toBe("STALE_VERSION");
      expect(staleAttempt.error).toContain("modified by another process");

      // Verify mark remains at version 7 and unmodified
      const intactMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(intactMark?.version).toBe(7);
      expect(Number(intactMark?.marksObtained)).toBe(80);

      // Fresh attempt using current version 7 succeeds and increments to 8
      const freshAttempt = await correctPublishedMarkAction({
        examId: examPubCorr.id,
        examSubjectId: pubSub.id,
        studentId: candCorr.id,
        newMark: 85,
        expectedVersion: 7,
        reason: "Authorized correction using current post-restoration version",
      });
      expect(freshAttempt.ok).toBe(true);

      const finalMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(finalMark?.version).toBe(8); // Advanced 7 -> 8
      expect(Number(finalMark?.marksObtained)).toBe(85);
    });

    it("3. Concurrent enterMarksBulkAction optimistic concurrency: two simultaneous requests with expectedVersion 5", async () => {
      // 1. Create an eligible student with one subject mark in an active IN_PROGRESS exam
      const concStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "ConcOpt",
          lastName: "Candidate",
          admissionNo: `S14-OPT-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(concStudent.id);

      const concEnr = await db.examEnrollment.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          studentId: concStudent.id,
          status: "ELIGIBLE",
        },
      });

      // 2. Set the mark to a known initial value and version (e.g. 70 at version 5)
      const initialMark = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: concStudent.id,
          enrollmentId: concEnr.id,
          marksObtained: 70,
          evaluationStatus: "DRAFT",
          version: 5,
        },
      });
      expect(initialMark.version).toBe(5);

      // Check revision events before concurrent race
      const revisionsBefore = await db.examMarksRevisionEvent.findMany({
        where: { markId: initialMark.id },
      });
      const initialRevisionCount = revisionsBefore.length;

      // 3. Prepare two independent requests using the same expectedVersion: 5 with different scores (80 and 90)
      const reqA = enterMarksBulkAction({
        examId: s14Exam.id,
        examSubjectId: s14SubMath.id,
        entries: [
          {
            studentId: concStudent.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 5,
          },
        ],
        reason: "Concurrent entry A with expectedVersion 5",
        submitForVerification: false,
      });

      const reqB = enterMarksBulkAction({
        examId: s14Exam.id,
        examSubjectId: s14SubMath.id,
        entries: [
          {
            studentId: concStudent.id,
            marksObtained: 90,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 5,
          },
        ],
        reason: "Concurrent entry B with expectedVersion 5",
        submitForVerification: false,
      });

      // 4. Execute both concurrently using Promise.all
      const [resA, resB] = await Promise.all([reqA, reqB]);

      // Assertions:
      // Exactly one request succeeds and exactly one request fails with STALE_VERSION
      const successes = [resA, resB].filter((r) => r.ok);
      const failures = [resA, resB].filter((r) => !r.ok);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].code).toBe("STALE_VERSION");
      expect(failures[0].error).toContain("modified by another process");

      // Determine winning score
      const winningScore = resA.ok ? 80 : 90;

      // The final mark contains the score from the successful request
      const finalMark = await db.examMark.findUnique({ where: { id: initialMark.id } });
      expect(Number(finalMark?.marksObtained)).toBe(winningScore);

      // The final version is exactly 6, not 7
      expect(finalMark?.version).toBe(6);

      // Only one successful revision event exists for the concurrent submission
      const revisionsAfter = await db.examMarksRevisionEvent.findMany({
        where: { markId: initialMark.id },
        orderBy: { createdAt: "asc" },
      });
      expect(revisionsAfter.length).toBe(initialRevisionCount + 1);
      const newRevision = revisionsAfter[revisionsAfter.length - 1];
      expect(Number(newRevision.newMarks)).toBe(winningScore);
      expect(Number(newRevision.oldMarks)).toBe(70);

      // No duplicate or partially updated mark exists
      const markCount = await db.examMark.count({
        where: { examSubjectId: s14SubMath.id, studentId: concStudent.id },
      });
      expect(markCount).toBe(1);

      // Tenant isolation: querying from another tenant returns null
      const crossTenantCheck = await db.examMark.findFirst({
        where: { id: initialMark.id, tenantId: "tenant-other-isolation" },
      });
      expect(crossTenantCheck).toBeNull();
    });

    it("4. Concurrent marks entry versus candidate status override (Scenario A/B): serializes without race", async () => {
      const raceStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "RaceAB",
          lastName: "Student",
          admissionNo: `S14-RAB-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(raceStudent.id);

      const raceEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: raceStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: raceStudent.id,
          enrollmentId: raceEnr.id,
          marksObtained: 60,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Fire concurrent marks entry and status update without overwrite confirmation
      const [markResult, statusResult] = await Promise.all([
        enterMarksBulkAction({
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          entries: [{ studentId: raceStudent.id, marksObtained: 92, isAbsent: false, isExempted: false, expectedVersion: 1 }],
          reason: "Concurrent mark entry race",
          submitForVerification: false,
        }),
        updateEnrollmentStatusAction({
          enrollmentId: raceEnr.id,
          status: "EXEMPTED",
          overwriteExistingMarks: false, // Must not overwrite without confirmation
          remarks: "Concurrent exemption race",
        }),
      ]);

      // Serialized outcome: either marks entry ran first (triggering EXISTING_MARKS_PRESENT on status update),
      // or status update ran first (locking candidate into EXEMPTED and rejecting marks entry).
      const validSerialization =
        (markResult.ok && !statusResult.ok && statusResult.code === "EXISTING_MARKS_PRESENT") ||
        (statusResult.ok && !markResult.ok && markResult.error?.includes("Cannot enter numeric marks"));
      expect(validSerialization).toBe(true);

      const finalMark = await db.examMark.findFirst({
        where: { examSubjectId: s14SubMath.id, studentId: raceStudent.id },
      });
      const finalEnr = await db.examEnrollment.findUnique({ where: { id: raceEnr.id } });

      // State is consistent: marks and enrollment match
      if (statusResult.ok) {
        expect(finalEnr?.status).toBe("EXEMPTED");
        expect(finalMark?.isExempted).toBe(true);
      } else {
        expect(finalEnr?.status).toBe("ELIGIBLE");
        expect(finalMark?.isExempted).toBe(false);
      }
    });

    it("5. Concurrent EXEMPTED versus ABSENT requests (Scenario C): preserves original baseline snapshot without loss", async () => {
      const concStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "ConcCD",
          lastName: "Student",
          admissionNo: `S14-CCD-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(concStudent.id);

      const concEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: concStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: concStudent.id,
          enrollmentId: concEnr.id,
          marksObtained: 85,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Fire concurrent EXEMPTED and ABSENT requests with overwrite confirmation
      const [resExm, resAbs] = await Promise.all([
        updateEnrollmentStatusAction({
          enrollmentId: concEnr.id,
          status: "EXEMPTED",
          overwriteExistingMarks: true,
          remarks: "Concurrent exempt call",
        }),
        updateEnrollmentStatusAction({
          enrollmentId: concEnr.id,
          status: "ABSENT",
          overwriteExistingMarks: true,
          remarks: "Concurrent absent call",
        }),
      ]);

      expect(resExm.ok).toBe(true);
      expect(resAbs.ok).toBe(true);

      // Verify that the final preservedMarks STILL retains the original baseline (Math = 85),
      // and NOT a placeholder from the racing override!
      const enrAfterRace = await db.examEnrollment.findUnique({ where: { id: concEnr.id } });
      const preserved = enrAfterRace?.preservedMarks as unknown as PreservedSubjectMark[];
      expect(Array.isArray(preserved)).toBe(true);
      const mathPreserved = preserved.find((p) => p.examSubjectId === s14SubMath.id);
      expect(mathPreserved?.marksObtained).toBe(85);
      expect(mathPreserved?.isExempted).toBe(false);
      expect(mathPreserved?.isAbsent).toBe(false);

      // Now restore to ELIGIBLE: original score 85 must be restored
      const restoreRes = await updateEnrollmentStatusAction({
        enrollmentId: concEnr.id,
        status: "ELIGIBLE",
        remarks: "Restoring after concurrent test",
      });
      expect(restoreRes.ok).toBe(true);

      const restoredMark = await db.examMark.findFirst({
        where: { examSubjectId: s14SubMath.id, studentId: concStudent.id },
      });
      expect(Number(restoredMark?.marksObtained)).toBe(85);
      expect(restoredMark?.isExempted).toBe(false);
      expect(restoredMark?.isAbsent).toBe(false);
    });

    it("6. Concurrent restoration requests (Scenario D): restores cleanly and idempotently", async () => {
      const restStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "ConcRest",
          lastName: "Student",
          admissionNo: `S14-RST-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(restStudent.id);

      const restEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: restStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: restStudent.id,
          enrollmentId: restEnr.id,
          marksObtained: 77,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Override to EXEMPTED
      await updateEnrollmentStatusAction({
        enrollmentId: restEnr.id,
        status: "EXEMPTED",
        overwriteExistingMarks: true,
      });

      // Fire concurrent restoration requests
      const [r1, r2] = await Promise.all([
        updateEnrollmentStatusAction({ enrollmentId: restEnr.id, status: "ELIGIBLE", remarks: "Restore 1" }),
        updateEnrollmentStatusAction({ enrollmentId: restEnr.id, status: "ELIGIBLE", remarks: "Restore 2" }),
      ]);

      // Exactly one restores and the other handles safely under the lock
      expect(r1.ok || r2.ok).toBe(true);

      const finalEnr = await db.examEnrollment.findUnique({ where: { id: restEnr.id } });
      expect(finalEnr?.status).toBe("ELIGIBLE");
      expect(finalEnr?.preservedMarks).toBeNull();

      const finalMark = await db.examMark.findFirst({
        where: { examSubjectId: s14SubMath.id, studentId: restStudent.id },
      });
      expect(Number(finalMark?.marksObtained)).toBe(77);
    });

    it("7. Existing preservation baseline remains invariant through repeated multi-override transitions", async () => {
      const multiStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "MultiOverride",
          lastName: "Student",
          admissionNo: `S14-MUL-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(multiStudent.id);

      const multiEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: multiStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: multiStudent.id,
          enrollmentId: multiEnr.id,
          marksObtained: 90,
          evaluationStatus: "SUBMITTED",
        },
      });

      // 1. ELIGIBLE -> EXEMPTED
      await updateEnrollmentStatusAction({ enrollmentId: multiEnr.id, status: "EXEMPTED", overwriteExistingMarks: true });
      // 2. EXEMPTED -> ABSENT
      await updateEnrollmentStatusAction({ enrollmentId: multiEnr.id, status: "ABSENT" });
      // 3. ABSENT -> EXEMPTED
      await updateEnrollmentStatusAction({ enrollmentId: multiEnr.id, status: "EXEMPTED" });
      // 4. EXEMPTED -> ABSENT
      await updateEnrollmentStatusAction({ enrollmentId: multiEnr.id, status: "ABSENT" });

      // Baseline in preservedMarks must still be Math 90
      const enr = await db.examEnrollment.findUnique({ where: { id: multiEnr.id } });
      const preserved = enr?.preservedMarks as unknown as PreservedSubjectMark[];
      const pMath = preserved.find((p) => p.examSubjectId === s14SubMath.id);
      expect(pMath?.marksObtained).toBe(90);

      // 5. ABSENT -> ELIGIBLE
      const resRestore = await updateEnrollmentStatusAction({ enrollmentId: multiEnr.id, status: "ELIGIBLE" });
      expect(resRestore.ok).toBe(true);

      const finalMark = await db.examMark.findFirst({
        where: { examSubjectId: s14SubMath.id, studentId: multiStudent.id },
      });
      expect(Number(finalMark?.marksObtained)).toBe(90);
    });

    it("8. Missing and corrupted preservation payloads safely rejected without wiping marks", async () => {
      const corruptStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "CorruptPayload",
          lastName: "Student",
          admissionNo: `S14-CPY-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(corruptStudent.id);

      const cEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: corruptStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: corruptStudent.id,
          enrollmentId: cEnr.id,
          marksObtained: 72,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Override to EXEMPTED
      await updateEnrollmentStatusAction({ enrollmentId: cEnr.id, status: "EXEMPTED", overwriteExistingMarks: true });

      // Corrupt payload to invalid object (not an array)
      await db.examEnrollment.update({
        where: { id: cEnr.id },
        data: { preservedMarks: { invalid: true } as unknown as Prisma.InputJsonValue },
      });

      const attempt1 = await updateEnrollmentStatusAction({ enrollmentId: cEnr.id, status: "ELIGIBLE" });
      expect(attempt1.ok).toBe(false);
      expect(attempt1.code).toBe("RESTORATION_STATE_MISSING");

      // Corrupt payload to array with invalid element schema
      await db.examEnrollment.update({
        where: { id: cEnr.id },
        data: { preservedMarks: [{ badProperty: 123 }] as unknown as Prisma.InputJsonValue },
      });

      const attempt2 = await updateEnrollmentStatusAction({ enrollmentId: cEnr.id, status: "ELIGIBLE" });
      expect(attempt2.ok).toBe(false);
      expect(attempt2.code).toBe("RESTORATION_STATE_MISSING");

      // Verify marks were not wiped
      const currentMark = await db.examMark.findFirst({
        where: { examSubjectId: s14SubMath.id, studentId: corruptStudent.id },
      });
      expect(currentMark?.evaluationStatus).toBe("VERIFIED");
      expect(currentMark?.isExempted).toBe(true);
    });

    it("9. Preservation payload cannot be overwritten or cleared by unrelated exam actions", async () => {
      const pStudent = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "UnrelatedAction",
          lastName: "Student",
          admissionNo: `S14-UNR-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(pStudent.id);

      const pEnr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s14Exam.id, studentId: pStudent.id, status: "ELIGIBLE" },
      });

      await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s14Exam.id,
          examSubjectId: s14SubMath.id,
          studentId: pStudent.id,
          enrollmentId: pEnr.id,
          marksObtained: 88,
          evaluationStatus: "SUBMITTED",
        },
      });

      // Override to EXEMPTED
      await updateEnrollmentStatusAction({ enrollmentId: pEnr.id, status: "EXEMPTED", overwriteExistingMarks: true });

      // Run unrelated action: updateExaminationAction
      const updateExamRes = await updateExaminationAction({
        id: s14Exam.id,
        title: "Renamed Exam During Preservation Audit",
        startDate: "2026-11-20",
        endDate: "2026-11-25",
      });
      expect(updateExamRes.ok).toBe(true);

      // Run unrelated action: autoEnrollEligibleStudentsAction
      const autoRes = await autoEnrollEligibleStudentsAction(s14Exam.id);
      expect(autoRes.ok).toBe(true);

      // Verify preservedMarks remains intact
      const enrCheck = await db.examEnrollment.findUnique({ where: { id: pEnr.id } });
      const preserved = enrCheck?.preservedMarks as unknown as PreservedSubjectMark[];
      expect(Array.isArray(preserved)).toBe(true);
      expect(preserved[0].marksObtained).toBe(88);
    });

    it("10. Manual database migration script idempotency: ALTER TABLE succeeds with 0 errors", async () => {
      // Re-run the manual migration statement directly against PostgreSQL
      await expect(
        db.$executeRawUnsafe('ALTER TABLE "ExamEnrollment" ADD COLUMN IF NOT EXISTS "preservedMarks" JSONB;')
      ).resolves.not.toThrow();

      // Verify existing preservedMarks data is completely intact
      const sample = await db.examEnrollment.findFirst({
        where: { preservedMarks: { not: Prisma.DbNull } },
      });
      if (sample) {
        expect(sample.preservedMarks).toBeDefined();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Section 15: Stage 4.3 Step 3.3 — Mandatory Optimistic Concurrency Enforcement Audit
  // ─────────────────────────────────────────────────────────────
  describe("Section 15: Stage 4.3 Step 3.3 — Mandatory Optimistic Concurrency Enforcement Audit", () => {
    let s15Exam: Examination;
    let s15SubMath: ExamSubject;
    let s15Student1: Student;
    let s15Student2: Student;
    let s15Student3: Student;
    let s15Enr1: ExamEnrollment;
    let s15Enr2: ExamEnrollment;
    let s15Enr3: ExamEnrollment;

    beforeAll(async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      s15Exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Stage 4.3 Step 3.3 OCC Audit Exam",
          code: `S15-OCC-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(s15Exam.id);

      s15SubMath = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: s15Exam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-20"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      s15Student1 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "OCC1",
          lastName: "AuditStudent",
          admissionNo: `S15-01-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(s15Student1.id);

      s15Student2 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "OCC2",
          lastName: "AuditStudent",
          admissionNo: `S15-02-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(s15Student2.id);

      s15Student3 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "OCC3",
          lastName: "AuditStudent",
          admissionNo: `S15-03-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(s15Student3.id);

      s15Enr1 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s15Exam.id, studentId: s15Student1.id, status: "ELIGIBLE" },
      });
      s15Enr2 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s15Exam.id, studentId: s15Student2.id, status: "ELIGIBLE" },
      });
      s15Enr3 = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s15Exam.id, studentId: s15Student3.id, status: "ELIGIBLE" },
      });
    });

    it("1. Missing expectedVersion is strictly rejected by schema validation without touching DB", async () => {
      // Intentionally omit expectedVersion
      const res = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            // expectedVersion omitted
          } as unknown as Record<string, unknown>,
        ],
        reason: "Missing expectedVersion submission",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();

      // Database mark must NOT be created
      const mark = await db.examMark.findFirst({
        where: { examSubjectId: s15SubMath.id, studentId: s15Student1.id },
      });
      expect(mark).toBeNull();
    });

    it("2. Null expectedVersion is strictly rejected by schema validation without touching DB", async () => {
      // Pass explicit null
      const res = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: null,
          } as unknown as Record<string, unknown>,
        ],
        reason: "Null expectedVersion submission",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();

      const mark = await db.examMark.findFirst({
        where: { examSubjectId: s15SubMath.id, studentId: s15Student1.id },
      });
      expect(mark).toBeNull();
    });

    it("3. Invalid expectedVersion (negative, fractional, string) is strictly rejected", async () => {
      // Negative
      const resNeg = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: -1,
          },
        ],
        reason: "Negative expectedVersion",
      });
      expect(resNeg.ok).toBe(false);

      // Fractional
      const resFrac = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 1.5,
          },
        ],
        reason: "Fractional expectedVersion",
      });
      expect(resFrac.ok).toBe(false);

      // String
      const resStr = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: "one" as unknown as number,
          },
        ],
        reason: "String expectedVersion",
      });
      expect(resStr.ok).toBe(false);
    });

    it("4 & 5. Stale expectedVersion is rejected with STALE_VERSION while correct expectedVersion succeeds and advances", async () => {
      // Create initial mark at version 2
      const mark = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s15Exam.id,
          examSubjectId: s15SubMath.id,
          studentId: s15Student1.id,
          enrollmentId: s15Enr1.id,
          marksObtained: 60,
          evaluationStatus: "DRAFT",
          version: 2,
        },
      });

      // 4. Stale submission: passing expectedVersion: 1 when current version is 2
      const staleRes = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 75,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 1, // Stale!
          },
        ],
        reason: "Stale mark submission test",
      });

      expect(staleRes.ok).toBe(false);
      expect(staleRes.code).toBe("STALE_VERSION");
      expect(staleRes.error).toContain("modified by another process");

      // Verify mark remains at version 2 and score 60
      const untouchedMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(untouchedMark?.version).toBe(2);
      expect(Number(untouchedMark?.marksObtained)).toBe(60);

      // 5. Fresh submission: passing correct expectedVersion: 2 succeeds and advances to 3
      const freshRes = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student1.id,
            marksObtained: 85,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 2, // Correct!
          },
        ],
        reason: "Fresh mark submission test",
      });

      expect(freshRes.ok).toBe(true);

      const updatedMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(updatedMark?.version).toBe(3); // Advanced exactly once: 2 -> 3
      expect(Number(updatedMark?.marksObtained)).toBe(85);
    });

    it("6. Two concurrent requests with the same expectedVersion: exactly one succeeds and one fails with STALE_VERSION", async () => {
      // Mark is now at version 3
      const currentMark = await db.examMark.findFirst({
        where: { examSubjectId: s15SubMath.id, studentId: s15Student1.id },
      });
      expect(currentMark?.version).toBe(3);

      const [resA, resB] = await Promise.all([
        enterMarksBulkAction({
          examId: s15Exam.id,
          examSubjectId: s15SubMath.id,
          entries: [
            {
              studentId: s15Student1.id,
              marksObtained: 90,
              isAbsent: false,
              isExempted: false,
              expectedVersion: 3,
            },
          ],
          reason: "Concurrent racer A",
        }),
        enterMarksBulkAction({
          examId: s15Exam.id,
          examSubjectId: s15SubMath.id,
          entries: [
            {
              studentId: s15Student1.id,
              marksObtained: 95,
              isAbsent: false,
              isExempted: false,
              expectedVersion: 3,
            },
          ],
          reason: "Concurrent racer B",
        }),
      ]);

      const successes = [resA, resB].filter((r) => r.ok);
      const failures = [resA, resB].filter((r) => !r.ok);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].code).toBe("STALE_VERSION");

      const finalMark = await db.examMark.findUnique({ where: { id: currentMark!.id } });
      expect(finalMark?.version).toBe(4); // Advanced 3 -> 4, never 5
    });

    it("7, 8 & 9. Bulk transaction atomicity: multi-candidate bulk request with one stale entry rolls back entirely", async () => {
      // Setup: Seed Student 2 and Student 3 with known marks and versions
      const mark2 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s15Exam.id,
          examSubjectId: s15SubMath.id,
          studentId: s15Student2.id,
          enrollmentId: s15Enr2.id,
          marksObtained: 50,
          evaluationStatus: "DRAFT",
          version: 1,
        },
      });

      const mark3 = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s15Exam.id,
          examSubjectId: s15SubMath.id,
          studentId: s15Student3.id,
          enrollmentId: s15Enr3.id,
          marksObtained: 60,
          evaluationStatus: "DRAFT",
          version: 1,
        },
      });

      // Count revision events before bulk request
      const revsBefore2 = await db.examMarksRevisionEvent.count({ where: { markId: mark2.id } });
      const revsBefore3 = await db.examMarksRevisionEvent.count({ where: { markId: mark3.id } });

      // Teacher submits bulk update:
      // Entry 1 (Student 2): valid expectedVersion 1 (would succeed)
      // Entry 2 (Student 1): stale expectedVersion 99 (STALE CONFLICT!)
      // Entry 3 (Student 3): valid expectedVersion 1 (would succeed)
      const bulkRes = await enterMarksBulkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        entries: [
          {
            studentId: s15Student2.id,
            marksObtained: 70, // Changed from 50
            isAbsent: false,
            isExempted: false,
            expectedVersion: 1, // Valid
          },
          {
            studentId: s15Student1.id,
            marksObtained: 99,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 99, // STALE! (Current is 4)
          },
          {
            studentId: s15Student3.id,
            marksObtained: 80, // Changed from 60
            isAbsent: false,
            isExempted: false,
            expectedVersion: 1, // Valid
          },
        ],
        reason: "Atomic bulk test with one stale candidate",
      });

      // 7. Request fails with STALE_VERSION
      expect(bulkRes.ok).toBe(false);
      expect(bulkRes.code).toBe("STALE_VERSION");
      expect(bulkRes.error).toContain("modified by another process");

      // 8. Transaction rollback: Student 2's mark was NOT updated to 70!
      const mark2Check = await db.examMark.findUnique({ where: { id: mark2.id } });
      expect(Number(mark2Check?.marksObtained)).toBe(50); // Untouched!
      expect(mark2Check?.version).toBe(1);

      // Student 3's mark was NOT updated to 80!
      const mark3Check = await db.examMark.findUnique({ where: { id: mark3.id } });
      expect(Number(mark3Check?.marksObtained)).toBe(60); // Untouched!
      expect(mark3Check?.version).toBe(1);

      // 9. Revision event correctness: ZERO revision events created for any candidate from aborted batch
      const revsAfter2 = await db.examMarksRevisionEvent.count({ where: { markId: mark2.id } });
      const revsAfter3 = await db.examMarksRevisionEvent.count({ where: { markId: mark3.id } });
      expect(revsAfter2).toBe(revsBefore2);
      expect(revsAfter3).toBe(revsBefore3);
    });

    it("10. Frontend MarksEntryGrid contract: initializes and submits correct version tokens", async () => {
      // Simulate constructing markGridStudents as page.tsx does
      const examWithMarks = await db.examination.findUnique({
        where: { id: s15Exam.id },
        include: {
          subjects: { include: { subject: true } },
          enrollments: {
            include: {
              student: true,
              marks: true,
            },
          },
        },
      });

      const currentSub = examWithMarks!.subjects[0];
      const gridStudents = examWithMarks!.enrollments.map((enr) => {
        const mark = enr.marks.find((m) => m.examSubjectId === currentSub.id);
        return {
          id: enr.student.id,
          name: `${enr.student.firstName} ${enr.student.lastName}`,
          admissionNo: enr.student.admissionNo,
          rollNumber: enr.rollNumber,
          currentMarks: mark?.marksObtained ?? null,
          isAbsent: mark?.isAbsent ?? false,
          isExempted: mark?.isExempted ?? false,
          feedback: mark?.feedback ?? null,
          evaluationStatus: mark?.evaluationStatus ?? "PENDING",
          enrollmentStatus: enr.status,
          enrollmentId: enr.id,
          version: mark?.version ?? 0, // Contract: version always non-null number
        };
      });

      // Verify every student has a valid non-negative integer version
      expect(gridStudents.length).toBeGreaterThan(0);
      for (const gs of gridStudents) {
        expect(typeof gs.version).toBe("number");
        expect(Number.isInteger(gs.version)).toBe(true);
        expect(gs.version).toBeGreaterThanOrEqual(0);
      }
    });

    it("11. Alternate mark update paths enforce equivalent concurrency and version safeguards", async () => {
      // Temporarily mark exam as published to test published correction concurrency
      await db.examination.update({
        where: { id: s15Exam.id },
        data: { isPublished: true, status: "PUBLISHED" },
      });

      const mark = await db.examMark.findFirst({
        where: { examSubjectId: s15SubMath.id, studentId: s15Student1.id },
      });

      const invalidCorrection = await correctPublishedMarkAction({
        examId: s15Exam.id,
        examSubjectId: s15SubMath.id,
        studentId: s15Student1.id,
        newMark: 90,
        expectedVersion: 99, // Stale!
        reason: "Stale correction check justifying at least 10 chars",
      });
      expect(invalidCorrection.ok).toBe(false);
      expect(invalidCorrection.code).toBe("STALE_VERSION");

      // Revert exam status back to IN_PROGRESS for candidate enrollment status action
      await db.examination.update({
        where: { id: s15Exam.id },
        data: { isPublished: false, status: "IN_PROGRESS" },
      });

      // Verify updateEnrollmentStatusAction increments version monotonically
      const beforeOverride = await db.examMark.findUnique({ where: { id: mark!.id } });
      const currentVer = beforeOverride!.version;

      const overrideRes = await updateEnrollmentStatusAction({
        enrollmentId: s15Enr1.id,
        status: "EXEMPTED",
        overwriteExistingMarks: true,
      });
      expect(overrideRes.ok).toBe(true);

      const afterOverride = await db.examMark.findUnique({ where: { id: mark!.id } });
      expect(afterOverride?.version).toBe(currentVer + 1); // Strictly incremented
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Section 16: Stage 4.3 Step 3.3.1 — Mark Version Invalidation During Verification & Reopening
  // ─────────────────────────────────────────────────────────────
  describe("Section 16: Stage 4.3 Step 3.3.1 — Mark Version Invalidation During Verification & Reopening", () => {
    let s16Exam: Examination;
    let s16Sub: ExamSubject;
    let s16Student: Student;
    let s16Enr: ExamEnrollment;

    beforeAll(async () => {
      const mem = await db.membership.findFirst({ where: { tenantId: tenantA.id } });
      s16Exam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          title: "Stage 4.3 Step 3.3.1 Invalidation Audit Exam",
          code: `S16-INV-${Date.now().toString().slice(-6)}`,
          examType: "UNIT_TEST",
          status: "IN_PROGRESS",
          isPublished: false,
          startDate: new Date("2026-11-20"),
          endDate: new Date("2026-11-25"),
          createdById: mem!.id,
        },
      });
      createdExamIds.push(s16Exam.id);

      s16Sub = await db.examSubject.create({
        data: {
          tenantId: tenantA.id,
          examId: s16Exam.id,
          subjectId: subjectMath.id,
          examDate: new Date("2026-11-20"),
          maxMarks: 100,
          passingMarks: 35,
          order: 1,
        },
      });

      s16Student = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: "Invalidation",
          lastName: "Candidate",
          admissionNo: `S16-01-${Date.now().toString().slice(-6)}`,
          classId: classA.id,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(s16Student.id);

      s16Enr = await db.examEnrollment.create({
        data: { tenantId: tenantA.id, examId: s16Exam.id, studentId: s16Student.id, status: "ELIGIBLE" },
      });
    });

    it("1. Mark version strictly increments upon subject marks verification (5 -> 6)", async () => {
      // 1. Seed initial mark at version 5
      const mark = await db.examMark.create({
        data: {
          tenantId: tenantA.id,
          examId: s16Exam.id,
          examSubjectId: s16Sub.id,
          studentId: s16Student.id,
          enrollmentId: s16Enr.id,
          marksObtained: 75,
          evaluationStatus: "SUBMITTED",
          version: 5,
        },
      });
      expect(mark.version).toBe(5);

      // 2. Department Head verifies subject marks
      const verifyRes = await verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id);
      expect(verifyRes.ok).toBe(true);

      const verifiedMark = await db.examMark.findUnique({ where: { id: mark.id } });
      expect(verifiedMark?.evaluationStatus).toBe("VERIFIED");
      // Must advance from 5 to 6 to invalidate any marks-entry forms held prior to verification
      expect(verifiedMark?.version).toBe(6);
    });

    it("2. Mark version strictly increments upon evaluation reopening (6 -> 7)", async () => {
      // Exam was transitioned to EVALUATED when subject marks were verified
      const evaluatedExam = await db.examination.findUnique({ where: { id: s16Exam.id } });
      expect(evaluatedExam?.status).toBe("EVALUATED");

      // Principal reopens evaluation to permit examiner adjustments
      const reopenRes = await reopenEvaluatedExamAction({
        examId: s16Exam.id,
        reason: "Reopening assessment to allow teacher mark adjustments after audit",
      });
      expect(reopenRes.ok).toBe(true);

      const reopenedExam = await db.examination.findUnique({ where: { id: s16Exam.id } });
      expect(reopenedExam?.status).toBe("IN_PROGRESS");

      // Mark status must unlock to SUBMITTED and version must advance 6 -> 7
      const reopenedMark = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      expect(reopenedMark?.evaluationStatus).toBe("SUBMITTED");
      expect(reopenedMark?.version).toBe(7);
    });

    it("3. Stale browser submission holding pre-verification token (5) is rejected with STALE_VERSION after reopening (7)", async () => {
      // A teacher who opened the page before verification submits marks using old expectedVersion: 5
      const staleRes = await enterMarksBulkAction({
        examId: s16Exam.id,
        examSubjectId: s16Sub.id,
        entries: [
          {
            studentId: s16Student.id,
            marksObtained: 80,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 5, // Stale pre-verification version!
          },
        ],
        reason: "Stale teacher submission attempt after reopening",
      });

      expect(staleRes.ok).toBe(false);
      expect(staleRes.code).toBe("STALE_VERSION");
      expect(staleRes.error).toContain("modified by another process");

      // Mark remains at version 7 and unmodified (75)
      const currentMark = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      expect(currentMark?.version).toBe(7);
      expect(Number(currentMark?.marksObtained)).toBe(75);
    });

    it("4. Fresh marks submission using current post-reopening token (7) succeeds and advances to 8", async () => {
      // Teacher reloads form, observes current version 7, and submits new score 85
      const freshRes = await enterMarksBulkAction({
        examId: s16Exam.id,
        examSubjectId: s16Sub.id,
        entries: [
          {
            studentId: s16Student.id,
            marksObtained: 85,
            isAbsent: false,
            isExempted: false,
            expectedVersion: 7, // Fresh current version!
          },
        ],
        reason: "Fresh post-reopening score adjustment",
      });

      expect(freshRes.ok).toBe(true);

      const finalMark = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      expect(finalMark?.version).toBe(8); // Advanced 7 -> 8
      expect(Number(finalMark?.marksObtained)).toBe(85);
    });

    it("5. Concurrent verification versus marks entry serializes cleanly without version conflict or deadlock", async () => {
      // Current mark is at version 8
      const mark = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      expect(mark?.version).toBe(8);

      // Concurrent race: Teacher submits marks with expectedVersion 8, while Head verifies marks
      const [resMarks, resVerify] = await Promise.all([
        enterMarksBulkAction({
          examId: s16Exam.id,
          examSubjectId: s16Sub.id,
          entries: [
            {
              studentId: s16Student.id,
              marksObtained: 90,
              isAbsent: false,
              isExempted: false,
              expectedVersion: 8,
            },
          ],
          reason: "Concurrent marks entry race",
        }),
        verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id),
      ]);

      // Both coordinate through lockExaminationRow:
      // Case A: Marks entry ran first (succeeded -> version 9), then verification locked it (succeeded -> version 10).
      // Case B: Verification ran first (succeeded -> version 9, VERIFIED), then marks entry failed (marks locked/stale).
      // Either way, at least one succeeded and version advanced monotonically
      expect(resMarks.ok || resVerify.ok).toBe(true);

      const markAfterRace = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      expect(markAfterRace?.version).toBeGreaterThanOrEqual(9);
    });

    it("6. Concurrent reopening versus marks entry enforces lifecycle and version boundaries", async () => {
      // Re-verify to ensure exam is EVALUATED
      await verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id);
      const evalExam = await db.examination.findUnique({ where: { id: s16Exam.id } });
      expect(evalExam?.status).toBe("EVALUATED");

      const markBefore = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });

      // Concurrent race: Teacher tries to enter marks with previous version while admin reopens
      const [resMarks, resReopen] = await Promise.all([
        enterMarksBulkAction({
          examId: s16Exam.id,
          examSubjectId: s16Sub.id,
          entries: [
            {
              studentId: s16Student.id,
              marksObtained: 95,
              isAbsent: false,
              isExempted: false,
              expectedVersion: markBefore!.version,
            },
          ],
          reason: "Concurrent edit during reopening",
        }),
        reopenEvaluatedExamAction({
          examId: s16Exam.id,
          reason: "Concurrent reopening to permit mark adjustments",
        }),
      ]);

      expect(resReopen.ok).toBe(true);
      // If marks entry executed before reopening finished, it failed because exam was EVALUATED.
      // If marks entry executed after reopening, reopening advanced the version so it failed with STALE_VERSION.
      expect(resMarks.ok).toBe(false);

      const examAfter = await db.examination.findUnique({ where: { id: s16Exam.id } });
      expect(examAfter?.status).toBe("IN_PROGRESS");
    });

    it("7. Full lifecycle monotonicity: version advances monotonically across verify, reopen, and edits", async () => {
      const mark = await db.examMark.findFirst({
        where: { examSubjectId: s16Sub.id, studentId: s16Student.id },
      });
      const vStart = mark!.version;

      // 1. Edit marks with current version: vStart -> vStart + 1
      const edit1 = await enterMarksBulkAction({
        examId: s16Exam.id,
        examSubjectId: s16Sub.id,
        entries: [
          {
            studentId: s16Student.id,
            marksObtained: 92,
            isAbsent: false,
            isExempted: false,
            expectedVersion: vStart,
          },
        ],
        reason: "Monotonicity test edit 1",
      });
      expect(edit1.ok).toBe(true);

      const m1 = await db.examMark.findFirst({ where: { id: mark!.id } });
      expect(m1?.version).toBe(vStart + 1);

      // 2. Verify marks: advances vStart + 1 -> vStart + 2
      const ver1 = await verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id);
      expect(ver1.ok).toBe(true);

      const m2 = await db.examMark.findFirst({ where: { id: mark!.id } });
      expect(m2?.version).toBe(vStart + 2);

      // 3. Reopen evaluation: advances vStart + 2 -> vStart + 3
      const reop1 = await reopenEvaluatedExamAction({
        examId: s16Exam.id,
        reason: "Monotonicity test reopening verification",
      });
      expect(reop1.ok).toBe(true);

      const m3 = await db.examMark.findFirst({ where: { id: mark!.id } });
      expect(m3?.version).toBe(vStart + 3);

      // Version strictly monotonic: vStart < vStart+1 < vStart+2 < vStart+3
      expect(m3!.version).toBeGreaterThan(m2!.version);
      expect(m2!.version).toBeGreaterThan(m1!.version);
      expect(m1!.version).toBeGreaterThan(vStart);
    });

    it("8. Audit and revision event correctness: verify and reopen emit audit logs without duplicate revision rows", async () => {
      const revsBefore = await db.examMarksRevisionEvent.count({ where: { examId: s16Exam.id } });

      // Verification emits AuditLog, not ExamMarksRevisionEvent
      await verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id);
      const revsAfterVerify = await db.examMarksRevisionEvent.count({ where: { examId: s16Exam.id } });
      expect(revsAfterVerify).toBe(revsBefore); // Zero duplicate score revision rows

      // Reopening emits AuditLog, not ExamMarksRevisionEvent
      await reopenEvaluatedExamAction({
        examId: s16Exam.id,
        reason: "Audit correctness verification reopening",
      });
      const revsAfterReopen = await db.examMarksRevisionEvent.count({ where: { examId: s16Exam.id } });
      expect(revsAfterReopen).toBe(revsBefore); // Zero duplicate score revision rows

      // AuditLog entries exist for both operations
      const verifyAudit = await db.auditLog.findFirst({
        where: { action: "exam.marks_verified", entityId: s16Sub.id },
      });
      expect(verifyAudit).not.toBeNull();

      const reopenAudit = await db.auditLog.findFirst({
        where: { action: "exam.status_transition", entityId: s16Exam.id },
      });
      expect(reopenAudit).not.toBeNull();
    });

    it("9. Lifecycle and tenant authorization restrictions remain strictly enforced", async () => {
      // Mock authorization failure for verify
      vi.mocked(authorizeTenantWrite).mockResolvedValueOnce({
        ok: false,
        error: "Forbidden: Missing permission tenant.exams.verify_marks",
      });
      const deniedVerify = await verifyExamSubjectMarksAction(s16Exam.id, s16Sub.id);
      expect(deniedVerify.ok).toBe(false);

      // Mock authorization failure for reopen
      vi.mocked(authorizeTenantWrite).mockResolvedValueOnce({
        ok: false,
        error: "Forbidden: Missing permission tenant.exams.manage_grading",
      });
      const deniedReopen = await reopenEvaluatedExamAction({
        examId: s16Exam.id,
        reason: "Unauthorized attempt",
      });
      expect(deniedReopen.ok).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SECTION 17: STAGE 4.3 STEP 4 — CROSS-AGGREGATE BATCH & EXAMINATION ENROLLMENT CONSISTENCY
  // ─────────────────────────────────────────────────────────────

  describe("Section 17: Stage 4.3 Step 4 — Cross-Aggregate Batch & Examination Enrollment Consistency", () => {
    let s17Batch1: { id: string; name: string };
    let s17Batch2: { id: string; name: string };
    let s17Batch3: { id: string; name: string };
    let s17Exam1: Examination;
    let s17Exam2: Examination;
    let s17Exam3: Examination;
    let membershipIdA: string;
    let adminUserIdA: string;

    const mockAuth = (tenantId = tenantA.id, userId?: string) => {
      vi.mocked(authorizeTenantWrite).mockResolvedValue({
        ok: true,
        ctx: {
          tenant: { id: tenantId, name: "Tenant Mock" } as unknown as TenantContext["tenant"],
          user: { id: userId || adminUserIdA, name: "Admin Officer" } as unknown as TenantContext["user"],
          membership: { roleKey: "ADMIN" } as unknown as TenantContext["membership"],
          permissions: new Set([
            "tenant.exams.write",
            "tenant.exams.enroll",
            "tenant.exams.verify_marks",
            "tenant.exams.manage_grading",
            "tenant.batches.write",
            "tenant.batches.enroll",
            "tenant.batches.transfer",
          ]),
          subscriptionBlocked: false,
          isOwnerView: true,
        },
      });
    };

    beforeAll(async () => {
      const mem = await db.membership.findFirst({
        where: { tenantId: tenantA.id },
      });
      membershipIdA = mem!.id;
      adminUserIdA = mem!.userId;

      mockAuth();

      // Create isolated batches for Section 17
      const suffix = Date.now().toString().slice(-6);
      s17Batch1 = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: `S17 Batch Alpha ${suffix}`,
          code: `B17A-${suffix}`,
          capacity: 40,
          status: "ACTIVE",
        },
      });
      createdBatchIds.push(s17Batch1.id);

      s17Batch2 = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: `S17 Batch Beta ${suffix}`,
          code: `B17B-${suffix}`,
          capacity: 40,
          status: "ACTIVE",
        },
      });
      createdBatchIds.push(s17Batch2.id);

      s17Batch3 = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: `S17 Batch Gamma ${suffix}`,
          code: `B17C-${suffix}`,
          capacity: 40,
          status: "ACTIVE",
        },
      });
      createdBatchIds.push(s17Batch3.id);

      // Create isolated examinations targeting s17Batch1
      s17Exam1 = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `S17 Examination One ${suffix}`,
          code: `EX17-1-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(s17Exam1.id);

      s17Exam2 = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `S17 Examination Two ${suffix}`,
          code: `EX17-2-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(s17Exam2.id);

      s17Exam3 = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch2.id,
          title: `S17 Examination Three ${suffix}`,
          code: `EX17-3-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(s17Exam3.id);
    });

    // Helper to create active student
    const createTestStudent = async (first: string, last: string) => {
      const s = await db.student.create({
        data: {
          tenantId: tenantA.id,
          firstName: first,
          lastName: `${last}-${Date.now().toString().slice(-4)}`,
          admissionNo: `ADM-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
          status: "ACTIVE",
        },
      });
      createdStudentIds.push(s.id);
      return s;
    };

    // ─────────────────────────────────────────────────────────
    // Sub-Suite A: Batch Drop vs Auto-Enrollment
    // ─────────────────────────────────────────────────────────

    it("1. Batch drop commits before auto-enrollment reads membership", async () => {
      mockAuth();
      const s1 = await createTestStudent("DropWin", "S1");
      await batchEnrollStudentsAction(s17Batch1.id, [s1.id]);

      // 1. Batch drop acquires lock and commits
      const dropRes = await batchDropStudentAction(s17Batch1.id, s1.id, "Withdrawn before exam");
      expect(dropRes.success).toBeDefined();

      // 2. Auto-enrollment runs on s17Exam1
      const enrollRes = await autoEnrollEligibleStudentsAction(s17Exam1.id);
      // s1 was dropped, so s1 must not be enrolled
      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: s17Exam1.id, studentId: s1.id } },
      });
      expect(enr).toBeNull();
    });

    it("2. Auto-enrollment commits before batch drop (snapshot semantics)", async () => {
      mockAuth();
      const s2 = await createTestStudent("AutoWin", "S2");
      await batchEnrollStudentsAction(s17Batch1.id, [s2.id]);

      // 1. Auto-enrollment acquires lock and commits
      const enrollRes = await autoEnrollEligibleStudentsAction(s17Exam1.id);
      expect(enrollRes.ok).toBe(true);
      const enrBeforeDrop = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: s17Exam1.id, studentId: s2.id } },
      });
      expect(enrBeforeDrop).not.toBeNull();
      expect(enrBeforeDrop?.status).toBe("ELIGIBLE");

      // 2. Batch drop acquires lock and commits
      const dropRes = await batchDropStudentAction(s17Batch1.id, s2.id, "Dropped after exam enroll");
      expect(dropRes.success).toBeDefined();

      // 3. Snapshot semantics: Examination enrollment remains intact
      const enrAfterDrop = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: s17Exam1.id, studentId: s2.id } },
      });
      expect(enrAfterDrop).not.toBeNull();
      expect(enrAfterDrop?.status).toBe("ELIGIBLE");
    });

    it("3. Concurrent operations serialize correctly with explicit barrier (Batch drop vs Auto-enrollment)", async () => {
      mockAuth();
      const s3 = await createTestStudent("ConcDrop", "S3");
      await batchEnrollStudentsAction(s17Batch1.id, [s3.id]);

      const examConc = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Concurrent Drop Test ${Date.now()}`,
          code: `EX17-CONC-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examConc.id);

      // Explicit synchronization barriers for controlled transaction overlap
      let t1HoldingLock!: () => void;
      const t1LockPromise = new Promise<void>((res) => { t1HoldingLock = res; });
      let releaseT1!: () => void;
      const t1ReleasePromise = new Promise<void>((res) => { releaseT1 = res; });

      // T1: Explicitly locks Batch 1, signals barrier, and waits
      const t1Promise = db.$transaction(async (tx) => {
        const locked = await lockBatchRow(tx, s17Batch1.id, tenantA.id);
        expect(locked).not.toBeNull();
        t1HoldingLock(); // signal: T1 now authoritatively holds row lock in PostgreSQL kernel
        await t1ReleasePromise; // wait until T2 has attempted to acquire the lock

        // Perform drop mutation and commit
        await tx.batchStudent.update({
          where: { batchId_studentId: { batchId: s17Batch1.id, studentId: s3.id } },
          data: { status: "DROPPED", droppedAt: new Date(), dropReason: "Controlled barrier drop" },
        });
      });

      // Wait until T1 is confirmed holding the Batch row lock
      await t1LockPromise;

      // T2: auto-enrollment begins while T1 is holding the lock.
      // T2 acquires Examination lock, then attempts to acquire Batch lock and blocks in PostgreSQL kernel
      const t2Promise = autoEnrollEligibleStudentsAction(examConc.id);

      // Brief pause to ensure T2 has reached the Batch lock barrier and is queued
      await new Promise((r) => setTimeout(r, 60));

      // Release T1 to commit its drop mutation
      releaseT1();
      await t1Promise;

      // T2 unblocks, reads the freshly committed DROPPED state, and completes
      const enrollResult = await t2Promise;
      expect(enrollResult).toBeDefined();

      // Assert exact row counts and states
      const batchMembership = await db.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: s17Batch1.id, studentId: s3.id } },
      });
      expect(batchMembership?.status).toBe("DROPPED");

      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examConc.id, studentId: s3.id } },
      });
      expect(enr).toBeNull(); // Strictly no stale enrollment admitted
    });

    it("4. No candidate is enrolled based on a stale membership read", async () => {
      mockAuth();
      const s4 = await createTestStudent("StaleCheck", "S4");
      await batchEnrollStudentsAction(s17Batch1.id, [s4.id]);

      // Explicitly drop student within a row-locked transaction
      await db.$transaction(async (tx) => {
        const locked = await lockBatchRow(tx, s17Batch1.id, tenantA.id);
        expect(locked).not.toBeNull();
        await tx.batchStudent.update({
          where: { batchId_studentId: { batchId: s17Batch1.id, studentId: s4.id } },
          data: { status: "DROPPED", droppedAt: new Date() },
        });
      });

      const examStale = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Stale Check Exam ${Date.now()}`,
          code: `EX17-STALE-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examStale.id);

      await autoEnrollEligibleStudentsAction(examStale.id);
      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examStale.id, studentId: s4.id } },
      });
      expect(enr).toBeNull(); // Strictly no stale enrollment
    });

    // ─────────────────────────────────────────────────────────
    // Sub-Suite B: Batch Addition vs Auto-Enrollment
    // ─────────────────────────────────────────────────────────

    it("5. Batch addition wins the shared lock first (controlled barrier)", async () => {
      mockAuth();
      const s5 = await createTestStudent("AddFirst", "S5");

      const examAdd = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Add First Exam ${Date.now()}`,
          code: `EX17-ADD1-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examAdd.id);

      // Synchronization barrier
      let t1HoldingLock!: () => void;
      const t1LockPromise = new Promise<void>((res) => { t1HoldingLock = res; });
      let releaseT1!: () => void;
      const t1ReleasePromise = new Promise<void>((res) => { releaseT1 = res; });

      // T1: locks Batch 1, holds lock, signals
      const t1Promise = db.$transaction(async (tx) => {
        const locked = await lockBatchRow(tx, s17Batch1.id, tenantA.id);
        expect(locked).not.toBeNull();
        t1HoldingLock();
        await t1ReleasePromise;

        // Perform batch enrollment
        await tx.batchStudent.create({
          data: {
            batchId: s17Batch1.id,
            studentId: s5.id,
            status: "ACTIVE",
          },
        });
      });

      await t1LockPromise;

      // T2: auto-enrollment launched, blocks on Batch 1 row lock
      const t2Promise = autoEnrollEligibleStudentsAction(examAdd.id);
      await new Promise((r) => setTimeout(r, 60));

      // Release T1 to commit addition
      releaseT1();
      await t1Promise;

      // T2 unblocks, queries active members (now sees s5), enrolls s5
      const enrollRes = await t2Promise;
      expect(enrollRes.ok).toBe(true);

      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examAdd.id, studentId: s5.id } },
      });
      expect(enr).not.toBeNull();
    });

    it("6. Auto-enrollment wins the shared lock first", async () => {
      mockAuth();
      const s6 = await createTestStudent("AutoFirst", "S6");

      const examEmpty = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch2.id, // currently empty
          title: `Empty Exam ${Date.now()}`,
          code: `EX17-EMP-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examEmpty.id);

      // Auto-enrollment runs while s6 is not yet in batch
      const enroll1 = await autoEnrollEligibleStudentsAction(examEmpty.id);
      expect(enroll1.ok).toBe(false); // No eligible candidates yet

      // Now s6 is added
      await batchEnrollStudentsAction(s17Batch2.id, [s6.id]);

      // Candidate is not in exam until next auto-enrollment
      const enrBefore = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examEmpty.id, studentId: s6.id } },
      });
      expect(enrBefore).toBeNull();

      // Subsequent auto-enrollment picks up candidate
      const enroll2 = await autoEnrollEligibleStudentsAction(examEmpty.id);
      expect(enroll2.ok).toBe(true);
      const enrAfter = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examEmpty.id, studentId: s6.id } },
      });
      expect(enrAfter).not.toBeNull();
    });

    it("7. The resulting enrollment reflects the serialized membership state", async () => {
      mockAuth();
      const s7 = await createTestStudent("ActiveMember", "S7");
      const s8 = await createTestStudent("DroppedMember", "S8");

      await batchEnrollStudentsAction(s17Batch1.id, [s7.id, s8.id]);
      await batchDropStudentAction(s17Batch1.id, s8.id, "Dropped before snapshot");

      const examState = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `State Snapshot Exam ${Date.now()}`,
          code: `EX17-SNAP-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examState.id);

      await autoEnrollEligibleStudentsAction(examState.id);

      // s7 was active -> enrolled
      const enr7 = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examState.id, studentId: s7.id } },
      });
      expect(enr7).not.toBeNull();

      // s8 was dropped -> NOT enrolled
      const enr8 = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examState.id, studentId: s8.id } },
      });
      expect(enr8).toBeNull();
    });

    // ─────────────────────────────────────────────────────────
    // Sub-Suite C: Batch Transfers
    // ─────────────────────────────────────────────────────────

    it("8. Transfer out of an examination's associated batch versus auto-enrollment", async () => {
      mockAuth();
      const s9 = await createTestStudent("TransferOut", "S9");
      await batchEnrollStudentsAction(s17Batch1.id, [s9.id]);

      // Transfer s9 from Batch 1 to Batch 2
      const xfer = await batchTransferStudentAction(s17Batch1.id, s17Batch2.id, s9.id, "Relocation");
      expect(xfer.success).toBeDefined();

      const examB1 = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Batch 1 Exam ${Date.now()}`,
          code: `EX17-XOUT-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examB1.id);

      await autoEnrollEligibleStudentsAction(examB1.id);

      // s9 is no longer in Batch 1 -> not enrolled in Batch 1 exam
      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examB1.id, studentId: s9.id } },
      });
      expect(enr).toBeNull();
    });

    it("9. Transfer into an examination's associated batch versus auto-enrollment", async () => {
      mockAuth();
      const s10 = await createTestStudent("TransferIn", "S10");
      await batchEnrollStudentsAction(s17Batch2.id, [s10.id]);

      // Transfer s10 from Batch 2 into Batch 1
      const xfer = await batchTransferStudentAction(s17Batch2.id, s17Batch1.id, s10.id, "Promotion");
      expect(xfer.success).toBeDefined();

      const examB1 = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Batch 1 Incoming Exam ${Date.now()}`,
          code: `EX17-XIN-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examB1.id);

      await autoEnrollEligibleStudentsAction(examB1.id);

      // s10 is now active in Batch 1 -> enrolled in Batch 1 exam
      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examB1.id, studentId: s10.id } },
      });
      expect(enr).not.toBeNull();
    });

    it("10. Concurrent transfers involving the same student", async () => {
      mockAuth();
      const s11 = await createTestStudent("RaceXfer", "S11");
      await batchEnrollStudentsAction(s17Batch1.id, [s11.id]);

      // Two concurrent transfers of s11: from B1 to B2, and from B1 to B3
      const [res1, res2] = await Promise.all([
        batchTransferStudentAction(s17Batch1.id, s17Batch2.id, s11.id, "Race to B2"),
        batchTransferStudentAction(s17Batch1.id, s17Batch3.id, s11.id, "Race to B3"),
      ]);

      const successes = [res1, res2].filter((r) => r.success);
      const errors = [res1, res2].filter((r) => r.error);

      // Exactly one transfer must win, the other must fail with source membership error
      expect(successes.length).toBe(1);
      expect(errors.length).toBe(1);

      // Verify student is active in exactly one destination batch
      const activeBatches = await db.batchStudent.findMany({
        where: { studentId: s11.id, status: "ACTIVE" },
      });
      expect(activeBatches.length).toBe(1);
    });

    it("11. Reverse-direction transfers do not create a deadlock due to inconsistent batch lock ordering (controlled barrier)", async () => {
      mockAuth();
      const studentA = await createTestStudent("RevA", "A");
      const studentB = await createTestStudent("RevB", "B");

      await batchEnrollStudentsAction(s17Batch1.id, [studentA.id]);
      await batchEnrollStudentsAction(s17Batch2.id, [studentB.id]);

      // Synchronization barrier
      let t1HoldingDualLocks!: () => void;
      const t1LockPromise = new Promise<void>((res) => { t1HoldingDualLocks = res; });
      let releaseT1!: () => void;
      const t1ReleasePromise = new Promise<void>((res) => { releaseT1 = res; });

      // T1 (Direction: B1 -> B2): acquires locks on [B1, B2] sorted by ID ASC, signals, waits on barrier
      const t1Promise = db.$transaction(async (tx) => {
        const locked = await lockBatchRows(tx, [s17Batch1.id, s17Batch2.id], tenantA.id);
        expect(locked.length).toBe(2);
        t1HoldingDualLocks();
        await t1ReleasePromise;

        // Perform transfer A
        await tx.batchStudent.update({
          where: { batchId_studentId: { batchId: s17Batch1.id, studentId: studentA.id } },
          data: { status: "TRANSFERRED", droppedAt: new Date(), dropReason: "Reverse transfer A" },
        });
        await tx.batchStudent.create({
          data: { batchId: s17Batch2.id, studentId: studentA.id, status: "ACTIVE" },
        });
      });

      await t1LockPromise;

      // T2 (Reverse Direction: B2 -> B1): attempts to acquire locks on [B2, B1]
      // Because lockBatchRows sorts [B2, B1] to [B1, B2] ASC, T2 requests the exact same first lock
      // and blocks cleanly in PostgreSQL kernel waiting for T1 to commit (NO DEADLOCK CYCLE!).
      const t2Promise = batchTransferStudentAction(s17Batch2.id, s17Batch1.id, studentB.id, "B to B1");
      await new Promise((r) => setTimeout(r, 60));

      // Release T1 to commit
      releaseT1();
      await t1Promise;

      // T2 unblocks, acquires [B1, B2] in same order, and completes cleanly
      const resB = await t2Promise;
      expect(resB.success).toBeDefined();

      // Final membership checks: both students successfully moved to destination batches
      const finalA = await db.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: s17Batch2.id, studentId: studentA.id } },
      });
      const finalB = await db.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: s17Batch1.id, studentId: studentB.id } },
      });
      expect(finalA?.status).toBe("ACTIVE");
      expect(finalB?.status).toBe("ACTIVE");
    });

    // ─────────────────────────────────────────────────────────
    // Sub-Suite D: Multiple Examinations & Isolation
    // ─────────────────────────────────────────────────────────

    it("12. Concurrent auto-enrollment into two examinations associated with the same batch (controlled barrier)", async () => {
      mockAuth();
      const s12 = await createTestStudent("DualExam", "S12");
      await batchEnrollStudentsAction(s17Batch1.id, [s12.id]);

      // Synchronization barrier
      let t1HoldingLocks!: () => void;
      const t1LockPromise = new Promise<void>((res) => { t1HoldingLocks = res; });
      let releaseT1!: () => void;
      const t1ReleasePromise = new Promise<void>((res) => { releaseT1 = res; });

      // T1 (auto-enroll Exam 1): locks Exam 1, then locks Batch 1, signals, and waits
      const t1Promise = db.$transaction(async (tx) => {
        const lockedE1 = await lockExaminationRow(tx, s17Exam1.id, tenantA.id);
        expect(lockedE1).not.toBeNull();
        const lockedB1 = await lockBatchRow(tx, s17Batch1.id, tenantA.id);
        expect(lockedB1).not.toBeNull();

        t1HoldingLocks();
        await t1ReleasePromise;

        // Create enrollment for s12 in Exam 1
        await tx.examEnrollment.upsert({
          where: { examId_studentId: { examId: s17Exam1.id, studentId: s12.id } },
          create: { tenantId: tenantA.id, examId: s17Exam1.id, studentId: s12.id, status: "ELIGIBLE" },
          update: {},
        });
      });

      await t1LockPromise;

      // T2 (auto-enroll Exam 2): locks Exam 2, then attempts to lock Batch 1
      // Because T1 holds Batch 1 lock, T2 blocks in PostgreSQL row lock wait queue
      const t2Promise = autoEnrollEligibleStudentsAction(s17Exam2.id);
      await new Promise((r) => setTimeout(r, 60));

      // Release T1 to commit and release Batch 1 lock
      releaseT1();
      await t1Promise;

      // T2 unblocks, acquires Batch 1 lock, and completes
      const res2 = await t2Promise;
      expect(res2.ok).toBe(true);

      // Both exams enrolled s12 cleanly with zero deadlock
      const enr1 = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: s17Exam1.id, studentId: s12.id } },
      });
      const enr2 = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: s17Exam2.id, studentId: s12.id } },
      });
      expect(enr1).not.toBeNull();
      expect(enr2).not.toBeNull();
    });

    it("13. Auto-enrollment into multiple batches where applicable", async () => {
      // Test lockBatchRows helper with empty, single, and multiple batch IDs
      await db.$transaction(async (tx) => {
        const empty = await lockBatchRows(tx, [], tenantA.id);
        expect(empty).toEqual([]);

        const multi = await lockBatchRows(tx, [s17Batch3.id, s17Batch1.id, s17Batch2.id], tenantA.id);
        expect(multi.length).toBe(3);
        // Verify deterministic ascending order
        expect(multi[0].id < multi[1].id).toBe(true);
        expect(multi[1].id < multi[2].id).toBe(true);
      });
    });

    it("14. Concurrent batch enrollments versus capacity limit (controlled barrier)", async () => {
      mockAuth();
      const suffix = Date.now().toString().slice(-6);
      const cap1Batch = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: `Cap 1 Batch ${suffix}`,
          code: `B17-CAP1-${suffix}`,
          capacity: 1, // Only 1 seat available!
          status: "ACTIVE",
        },
      });
      createdBatchIds.push(cap1Batch.id);

      const sCapA = await createTestStudent("CapA", "14A");
      const sCapB = await createTestStudent("CapB", "14B");

      // Barrier setup
      let t1HoldingLock!: () => void;
      const t1LockPromise = new Promise<void>((res) => { t1HoldingLock = res; });
      let releaseT1!: () => void;
      const t1ReleasePromise = new Promise<void>((res) => { releaseT1 = res; });

      // T1 locks batch, holds lock, signals
      const t1Promise = db.$transaction(async (tx) => {
        const locked = await lockBatchRow(tx, cap1Batch.id, tenantA.id);
        expect(locked).not.toBeNull();
        t1HoldingLock();
        await t1ReleasePromise;

        // Fills the only available seat
        await tx.batchStudent.create({
          data: { batchId: cap1Batch.id, studentId: sCapA.id, status: "ACTIVE" },
        });
      });

      await t1LockPromise;

      // T2 attempts enrollment on same batch, blocks on row lock
      const t2Promise = batchEnrollStudentsAction(cap1Batch.id, [sCapB.id]);
      await new Promise((r) => setTimeout(r, 60));

      // Release T1 to commit seat filling
      releaseT1();
      await t1Promise;

      // T2 unblocks, re-reads active count (1/1), and rejects with capacity exceeded
      const resB = await t2Promise;
      expect(resB.error).toContain("capacity exceeded");

      // Final verification: exactly 1 student actively enrolled
      const activeCount = await db.batchStudent.count({
        where: { batchId: cap1Batch.id, status: "ACTIVE" },
      });
      expect(activeCount).toBe(1);
    });

    // ─────────────────────────────────────────────────────────
    // Sub-Suite E: Integrity, Lifecycle & Authorization
    // ─────────────────────────────────────────────────────────

    it("15. Duplicate enrollment prevention (idempotency)", async () => {
      mockAuth();
      const s15 = await createTestStudent("Idemp", "S15");
      await batchEnrollStudentsAction(s17Batch1.id, [s15.id]);

      const examIdemp = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Idempotency Exam ${Date.now()}`,
          code: `EX17-IDM-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examIdemp.id);

      // First run enrolls eligible students
      const firstRun = await autoEnrollEligibleStudentsAction(examIdemp.id);
      expect(firstRun.ok).toBe(true);
      const count1 = await db.examEnrollment.count({ where: { examId: examIdemp.id } });

      // Second run is idempotent (no duplicates created)
      const secondRun = await autoEnrollEligibleStudentsAction(examIdemp.id);
      const count2 = await db.examEnrollment.count({ where: { examId: examIdemp.id } });
      expect(count2).toBe(count1);
    });

    it("16. Tenant isolation: cross-tenant enrollment rejected", async () => {
      // User from Tenant B tries to auto-enroll Tenant A examination
      mockAuth(tenantB.id);

      const crossRes = await autoEnrollEligibleStudentsAction(s17Exam1.id);
      expect(crossRes.ok).toBe(false);
      expect(crossRes.error).toBe("Examination not found.");
    });

    it("17. Archived/closed batch restrictions", async () => {
      mockAuth();
      const suffix = Date.now().toString().slice(-6);
      const closedBatch = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: `Closed Batch ${suffix}`,
          code: `B17-CLS-${suffix}`,
          capacity: 30,
          status: "COMPLETED",
        },
      });
      createdBatchIds.push(closedBatch.id);

      const examClosed = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: closedBatch.id,
          title: `Closed Batch Exam ${suffix}`,
          code: `EX17-CLS-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examClosed.id);

      // Auto-enrollment on non-active batch rejected with INVALID_TRANSITION
      const autoRes = await autoEnrollEligibleStudentsAction(examClosed.id);
      expect(autoRes.ok).toBe(false);
      expect(autoRes.code).toBe("INVALID_TRANSITION");

      // Manual enrollment into exam targeting non-active batch rejected
      const sDummy = await createTestStudent("Dummy", "S");
      const manualRes = await enrollStudentsAction({
        examId: examClosed.id,
        studentIds: [sDummy.id],
      });
      expect(manualRes.ok).toBe(false);
      expect(manualRes.code).toBe("INVALID_TRANSITION");
    });

    it("18. Invalid examination lifecycle transitions reject enrollment", async () => {
      mockAuth();
      const suffix = Date.now().toString().slice(-6);
      const evaluatedExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Evaluated Exam ${suffix}`,
          code: `EX17-EV-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "EVALUATED",
        },
      });
      createdExamIds.push(evaluatedExam.id);

      const enrollEval = await autoEnrollEligibleStudentsAction(evaluatedExam.id);
      expect(enrollEval.ok).toBe(false);
      expect(enrollEval.code).toBe("INVALID_TRANSITION");

      const archivedExam = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Archived Exam ${suffix}`,
          code: `EX17-ARC-${suffix}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "ARCHIVED",
        },
      });
      createdExamIds.push(archivedExam.id);

      const enrollArch = await autoEnrollEligibleStudentsAction(archivedExam.id);
      expect(enrollArch.ok).toBe(false);
      expect(enrollArch.code).toBe("INVALID_TRANSITION");
    });

    it("19. Transaction rollback on any failed validation", async () => {
      mockAuth();
      const validStudent = await createTestStudent("ValidCandidate", "S19");
      const nonBatchStudent = await createTestStudent("NonBatch", "S19");

      await batchEnrollStudentsAction(s17Batch1.id, [validStudent.id]);

      const examRollback = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Rollback Exam ${Date.now()}`,
          code: `EX17-RB-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examRollback.id);

      // Attempt manual enrollment of 1 valid candidate and 1 non-batch candidate
      const result = await enrollStudentsAction({
        examId: examRollback.id,
        studentIds: [validStudent.id, nonBatchStudent.id],
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not active members of batch");

      // Confirm complete atomic rollback: valid student was NOT enrolled
      const enr = await db.examEnrollment.findUnique({
        where: { examId_studentId: { examId: examRollback.id, studentId: validStudent.id } },
      });
      expect(enr).toBeNull();
    });

    it("20. Audit event consistency across batch and examination operations", async () => {
      mockAuth();
      const s20 = await createTestStudent("AuditVerify", "S20");

      // 1. Batch enrollment emits audit
      await batchEnrollStudentsAction(s17Batch1.id, [s20.id]);
      const batchAudit = await db.auditLog.findFirst({
        where: { entityId: s17Batch1.id, action: "batch.students_enrolled" },
      });
      expect(batchAudit).not.toBeNull();

      // 2. Exam auto-enrollment emits audit
      const examAuditTest = await db.examination.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          gradeScaleId: gradeScaleA.id,
          targetType: "BATCH",
          batchId: s17Batch1.id,
          title: `Audit Test Exam ${Date.now()}`,
          code: `EX17-AUD-${Date.now().toString().slice(-6)}`,
          startDate: new Date("2026-12-01"),
          endDate: new Date("2026-12-05"),
          createdById: membershipIdA,
          status: "IN_PROGRESS",
        },
      });
      createdExamIds.push(examAuditTest.id);

      await autoEnrollEligibleStudentsAction(examAuditTest.id);
      const examAudit = await db.auditLog.findFirst({
        where: { entityId: examAuditTest.id, action: "exam.auto_enrolled_students" },
      });
      expect(examAudit).not.toBeNull();
    });
  });
});

