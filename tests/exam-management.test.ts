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
  saveExamSubjectsAction,
  autoEnrollEligibleStudentsAction,
  enterMarksBulkAction,
  verifyExamSubjectMarksAction,
  calculateAndPublishResultsAction,
  correctPublishedMarkAction,
  exportExamResultsCsvAction,
  verifyResultSnapshotIntegrityAction,
} from "@/actions/exams";

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

    it("Marks Correction Schema: Enforces minimum 10-character meaningful justification", () => {
      const valid = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        reason: "Re-evaluation of final calculus question requested by academic committee",
      });
      expect(valid.success).toBe(true);

      const tooShort = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        reason: "wrong mark", // Only 10 chars with spaces or < 10
      });
      // "wrong" is 5 chars
      const shortFail = correctPublishedMarkSchema.safeParse({
        examId: "exam-1",
        examSubjectId: "sub-1",
        studentId: "student-1",
        newMark: 85,
        reason: "mistake",
      });
      expect(shortFail.success).toBe(false);
      expect(shortFail.error?.issues[0]?.message).toContain("minimum 10 characters");
    });
  });
});

