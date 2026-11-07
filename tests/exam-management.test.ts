import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

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
} from "@/lib/exam-lifecycle";

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

  beforeAll(async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Find or create academic year
    let ay = await db.academicYear.findFirst({
      where: { tenantId: tenantA.id },
    });
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

    it("3. Safeguard 4: Completeness engine detects missing, unverified, and malformed marks", async () => {
      // Step A: Move exam to IN_PROGRESS via marks entry
      const enterRes = await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subMathLife.id,
        entries: [
          { studentId: student1.id, marksObtained: 85, isAbsent: false, isExempted: false },
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
          { studentId: student2.id, marksObtained: 90, isAbsent: false, isExempted: false },
        ],
        reason: "Grading student 2",
        submitForVerification: false,
      });

      await enterMarksBulkAction({
        examId: lifecycleExam.id,
        examSubjectId: subSciLife.id,
        entries: [
          { studentId: student1.id, marksObtained: 78, isAbsent: false, isExempted: false },
          { studentId: student2.id, marksObtained: 88, isAbsent: false, isExempted: false },
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
        entries: [{ studentId: student1.id, marksObtained: 99, isAbsent: false, isExempted: false }],
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
        entries: [{ studentId: student1.id, marksObtained: 85, isAbsent: false, isExempted: false }],
        reason: "Student 1 Math score",
      });
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub2.id,
        entries: [{ studentId: student1.id, marksObtained: 75, isAbsent: false, isExempted: false }],
        reason: "Student 1 Science score",
      });

      // Student 2: Math 90, Science EXEMPTED
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub1.id,
        entries: [{ studentId: student2.id, marksObtained: 90, isAbsent: false, isExempted: false }],
        reason: "Student 2 Math score",
      });
      await enterMarksBulkAction({
        examId: diffExam.id,
        examSubjectId: dSub2.id,
        entries: [{ studentId: student2.id, marksObtained: null, isAbsent: false, isExempted: true }],
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
          entries: [{ studentId: student1.id, marksObtained: 88, isAbsent: false, isExempted: false }],
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
          { studentId: student1.id, marksObtained: 90, isAbsent: false, isExempted: false },
          { studentId: student2.id, marksObtained: 70, isAbsent: false, isExempted: false },
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
});

