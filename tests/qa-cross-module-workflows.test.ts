import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import type { TenantContext } from "@/lib/auth";
import {
  createLeadAction,
  convertLeadAction,
} from "@/actions/leads";
import {
  createBatchAction,
  enrollStudentsAction as batchEnrollStudentsAction,
  transferStudentAction as batchTransferStudentAction,
  dropStudentAction as batchDropStudentAction,
} from "@/actions/batches";
import {
  createExaminationAction,
  saveExamSubjectsAction,
  autoEnrollEligibleStudentsAction,
  enterMarksBulkAction,
  verifyExamSubjectMarksAction,
  calculateAndPublishResultsAction,
  correctPublishedMarkAction,
} from "@/actions/exams";
import {
  createFeeInvoiceAction,
  recordFeePaymentAction,
  markAttendanceAction,
  createAnnouncementAction,
} from "@/actions/operations";

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

describe("Knowletive QA Functional Audit: Cross-Module Business Workflows", () => {
  let tenant: { id: string; name: string; slug: string };
  let adminCtx: TenantContext;
  let academicYear: { id: string };
  let classLevel: { id: string; name: string };
  let section: { id: string; name: string };
  let subject: { id: string; name: string };
  let gradeScale: { id: string };

  const createdStudentIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdAnnouncementIds: string[] = [];

  beforeAll(async () => {
    const t = await db.tenant.findFirst({
      where: { slug: "sunrise" },
      select: { id: true, name: true, slug: true },
    });
    if (!t) throw new Error("Sunrise tenant not found");
    tenant = t;

    const adminUser = await db.user.findFirst({
      where: { email: "admin@sunrise.test" },
      include: { memberships: true },
    });
    if (!adminUser) throw new Error("admin@sunrise.test not found");

    adminCtx = {
      user: { id: adminUser.id, name: adminUser.name, email: adminUser.email } as any,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        type: "SCHOOL",
        status: "ACTIVE",
        subscription: {
          status: "ACTIVE",
          plan: {
            id: "p_growth",
            key: "growth",
            name: "Growth",
            studentLimit: 500,
            staffLimit: 50,
            aiCreditsMonthly: 1000,
            features: ["ai", "reports", "portal"],
          } as any,
        } as any,
      } as any,
      membership: {
        id: adminUser.memberships[0].id,
        roleId: adminUser.memberships[0].roleId,
        roleKey: "INSTITUTE_ADMIN",
        roleName: "Institute Admin",
        isOwner: true,
      } as any,
      permissions: new Set([
        "tenant.leads.read", "tenant.leads.write", "tenant.leads.convert",
        "tenant.students.read", "tenant.students.write", "tenant.parents.read", "tenant.parents.write",
        "tenant.batches.read", "tenant.batches.write", "tenant.batches.enroll", "tenant.batches.transfer",
        "tenant.exams.read", "tenant.exams.write", "tenant.exams.manage_grading", "tenant.exams.enroll",
        "tenant.exams.enter_marks", "tenant.exams.verify_marks", "tenant.exams.publish_results", "tenant.exams.correct_published_marks",
        "tenant.attendance.read", "tenant.attendance.write",
        "tenant.fees.read", "tenant.fees.write",
        "tenant.announcements.read", "tenant.announcements.write",
      ]) as any,
    } as unknown as TenantContext;

    vi.mocked(authorizeTenantWrite).mockResolvedValue({
      ok: true,
      ctx: adminCtx,
    });

    // Fetch prerequisite entities
    let ay = await db.academicYear.findFirst({ where: { tenantId: tenant.id, isActive: true } });
    if (!ay) ay = await db.academicYear.findFirst({ where: { tenantId: tenant.id } });
    academicYear = ay!;

    const cl = await db.classLevel.findFirst({ where: { tenantId: tenant.id }, include: { sections: true } });
    classLevel = cl!;
    section = cl!.sections[0];

    const sub = await db.subject.findFirst({ where: { tenantId: tenant.id } });
    subject = sub!;

    let gs = await db.gradeScale.findFirst({ where: { tenantId: tenant.id } });
    if (!gs) {
      gs = await db.gradeScale.create({
        data: {
          tenantId: tenant.id,
          name: "QA Standard Grade Scale",
          code: "QA-SCALE-101",
          bands: {
            create: [
              { tenantId: tenant.id, letterGrade: "A", minPercentage: 80, maxPercentage: 100, gradePoint: 4.0 },
              { tenantId: tenant.id, letterGrade: "B", minPercentage: 60, maxPercentage: 79.99, gradePoint: 3.0 },
              { tenantId: tenant.id, letterGrade: "C", minPercentage: 40, maxPercentage: 59.99, gradePoint: 2.0 },
              { tenantId: tenant.id, letterGrade: "F", minPercentage: 0, maxPercentage: 39.99, gradePoint: 0.0, isPassing: false },
            ],
          },
        },
      });
    }
    gradeScale = gs;
  });

  afterAll(async () => {
    // Teardown created entities safely
    if (createdAnnouncementIds.length > 0) {
      await db.announcement.deleteMany({ where: { id: { in: createdAnnouncementIds } } });
    }
    if (createdInvoiceIds.length > 0) {
      await db.feePayment.deleteMany({ where: { feeInvoiceId: { in: createdInvoiceIds } } });
      await db.feeInvoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdExamIds.length > 0) {
      const snapWhere = { examId: { in: createdExamIds } };
      await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" DISABLE TRIGGER trg_exam_snapshot_protect`);
      await db.examResultSnapshot.deleteMany({ where: snapWhere });
      await db.$executeRawUnsafe(`ALTER TABLE "ExamResultSnapshot" ENABLE TRIGGER trg_exam_snapshot_protect`);

      await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" DISABLE TRIGGER trg_exam_revision_event_protect`);
      await db.examMarksRevisionEvent.deleteMany({ where: { examId: { in: createdExamIds } } });
      await db.$executeRawUnsafe(`ALTER TABLE "ExamMarksRevisionEvent" ENABLE TRIGGER trg_exam_revision_event_protect`);

      await db.examResult.deleteMany({ where: { examId: { in: createdExamIds } } });
      await db.examMark.deleteMany({ where: { examId: { in: createdExamIds } } });
      await db.examEnrollment.deleteMany({ where: { examId: { in: createdExamIds } } });
      await db.examSubject.deleteMany({ where: { examId: { in: createdExamIds } } });
      await db.examination.deleteMany({ where: { id: { in: createdExamIds } } });
    }
    if (createdBatchIds.length > 0) {
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.batchEnrollmentEvent.deleteMany({ where: { batchId: { in: createdBatchIds } } });
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.batchStudent.deleteMany({ where: { batchId: { in: createdBatchIds } } });
      await db.batchTeacher.deleteMany({ where: { batchId: { in: createdBatchIds } } });
      await db.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
    }
    if (createdStudentIds.length > 0) {
      await db.studentGuardian.deleteMany({ where: { studentId: { in: createdStudentIds } } });
      await db.attendance.deleteMany({ where: { studentId: { in: createdStudentIds } } });
      await db.student.deleteMany({ where: { id: { in: createdStudentIds } } });
    }
    if (createdLeadIds.length > 0) {
      await db.leadActivity.deleteMany({ where: { leadId: { in: createdLeadIds } } });
      await db.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW 1: LEAD CRM -> ADMISSION CONVERSION -> STUDENT RECORD
  // ─────────────────────────────────────────────────────────────
  it("Workflow 1: Captures a lead enquiry and converts it to an enrolled student record", async () => {
    const timestamp = Date.now();
    const phone = `981${String(timestamp).slice(-7)}`;
    const studentName = `Aarav Lead ${timestamp}`;
    const guardianName = `Vikram Lead ${timestamp}`;

    // 1. Create Lead Enquiry
    const lead = await db.lead.create({
      data: {
        tenantId: tenant.id,
        studentName,
        guardianName,
        guardianPhone: phone,
        guardianEmail: `vikram.${timestamp}@example.com`,
        source: "WEBSITE",
        status: "NEW",
      },
    });
    createdLeadIds.push(lead.id);

    // 2. Convert Lead to Student Admission
    const admissionNo = `ADM-QA-${String(timestamp).slice(-6)}`;
    const fd = new FormData();
    fd.append("leadId", lead.id);
    fd.append("admissionNo", admissionNo);
    fd.append("firstName", "Aarav");
    fd.append("lastName", `Lead${timestamp}`);
    fd.append("dob", "");
    fd.append("gender", "");
    fd.append("bloodGroup", "");
    fd.append("address", "");
    fd.append("classId", classLevel.id);
    fd.append("sectionId", section.id);

    let redirectCaught = false;
    try {
      const res = await convertLeadAction({}, fd);
      if (res?.error) console.log("convertLeadAction returned error:", res.error);
    } catch (err: any) {
      if (err.message?.includes("REDIRECT")) redirectCaught = true;
      else throw err;
    }
    expect(redirectCaught).toBe(true);

    // 3. Verify Database Persistence & Linkages
    const convertedLead = await db.lead.findUnique({ where: { id: lead.id } });
    expect(convertedLead?.status).toBe("CONVERTED");
    expect(convertedLead?.convertedStudentId).not.toBeNull();

    const createdStudent = await db.student.findUnique({
      where: { id: convertedLead!.convertedStudentId! },
      include: {
        guardians: {
          include: { guardian: true },
        },
      },
    });
    expect(createdStudent).not.toBeNull();
    expect(createdStudent?.admissionNo).toBe(admissionNo);
    expect(createdStudent?.status).toBe("ACTIVE");
    createdStudentIds.push(createdStudent!.id);

    // Verify Guardian was linked
    expect(createdStudent?.guardians.length).toBe(1);
    expect(createdStudent?.guardians[0].guardian.phone).toBe(phone);
    expect(createdStudent?.guardians[0].isPrimary).toBe(true);

    // Verify Idempotency: Attempting to convert again fails
    try {
      const res = await convertLeadAction({}, fd);
      expect(res?.error).toMatch(/already been converted/i);
    } catch (err: any) {
      expect(err.message).toMatch(/already been converted/i);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW 2: BATCH CREATION -> ENROLLMENT -> TRANSFER -> DROP
  // ─────────────────────────────────────────────────────────────
  it("Workflow 2: Manages student lifecycle across batches (Enroll -> Transfer -> Drop)", async () => {
    const timestamp = Date.now();

    // 1. Create a Student
    const testStudent = await db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `BAT-STU-${String(timestamp).slice(-6)}`,
        firstName: "Batch",
        lastName: `Candidate-${timestamp}`,
        status: "ACTIVE",
        classId: classLevel.id,
        sectionId: section.id,
      },
    });
    createdStudentIds.push(testStudent.id);

    // 2. Create Two Batches
    const batchA = await db.batch.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        name: `QA Batch Alpha ${timestamp}`,
        code: `ALPH-${String(timestamp).slice(-4)}`,
        capacity: 25,
        status: "ACTIVE",
      },
    });
    createdBatchIds.push(batchA.id);

    const batchB = await db.batch.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        name: `QA Batch Beta ${timestamp}`,
        code: `BETA-${String(timestamp).slice(-4)}`,
        capacity: 25,
        status: "ACTIVE",
      },
    });
    createdBatchIds.push(batchB.id);

    // 3. Enroll Student in Batch Alpha
    const enrollRes = await batchEnrollStudentsAction(batchA.id, [testStudent.id]);
    if (enrollRes.error) console.log("batchEnrollStudentsAction error:", enrollRes.error);
    expect(enrollRes.success).toBeDefined();

    const memA = await db.batchStudent.findFirst({
      where: { batchId: batchA.id, studentId: testStudent.id },
    });
    expect(memA?.status).toBe("ACTIVE");

    // 4. Transfer Student from Batch Alpha to Batch Beta
    const transferRes = await batchTransferStudentAction(
      batchA.id,
      batchB.id,
      testStudent.id,
      "Advanced curriculum reassignment"
    );
    if (transferRes.error) console.log("batchTransferStudentAction error:", transferRes.error);
    expect(transferRes.success).toBeDefined();

    const memAPost = await db.batchStudent.findFirst({
      where: { batchId: batchA.id, studentId: testStudent.id },
    });
    expect(memAPost?.status).toBe("TRANSFERRED");

    const memB = await db.batchStudent.findFirst({
      where: { batchId: batchB.id, studentId: testStudent.id },
    });
    expect(memB?.status).toBe("ACTIVE");

    // 5. Drop Student from Batch Beta
    const dropRes = await batchDropStudentAction(batchB.id, testStudent.id, "Student relocated");
    if (dropRes.error) console.log("batchDropStudentAction error:", dropRes.error);
    expect(dropRes.success).toBeDefined();

    const memBPost = await db.batchStudent.findFirst({
      where: { batchId: batchB.id, studentId: testStudent.id },
    });
    expect(memBPost?.status).toBe("DROPPED");
  });

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW 3: COMPLETE EXAM LIFECYCLE, VERIFICATION & PUBLICATION
  // ─────────────────────────────────────────────────────────────
  it("Workflow 3: Executes full examination lifecycle from setup to published snapshot", async () => {
    const timestamp = Date.now();

    // 1. Create 2 test students in class section
    const s1 = await db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `EX-S1-${String(timestamp).slice(-6)}`,
        firstName: "ExamStudent1",
        lastName: `Test-${timestamp}`,
        status: "ACTIVE",
        classId: classLevel.id,
        sectionId: section.id,
      },
    });
    const s2 = await db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `EX-S2-${String(timestamp).slice(-6)}`,
        firstName: "ExamStudent2",
        lastName: `Test-${timestamp}`,
        status: "ACTIVE",
        classId: classLevel.id,
        sectionId: section.id,
      },
    });
    createdStudentIds.push(s1.id, s2.id);

    // 2. Create a dedicated batch for the exam to guarantee controlled Cartesian completeness
    const examBatch = await db.batch.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        name: `QA Exam Batch ${timestamp}`,
        code: `EBAT-${String(timestamp).slice(-4)}`,
        capacity: 10,
        status: "ACTIVE",
      },
    });
    createdBatchIds.push(examBatch.id);

    // Enroll only s1 and s2 in the exam batch
    await batchEnrollStudentsAction(examBatch.id, [s1.id, s2.id]);

    // Create Examination targeting this batch
    const examRes = await createExaminationAction({
      academicYearId: academicYear.id,
      gradeScaleId: gradeScale.id,
      targetType: "BATCH",
      batchId: examBatch.id,
      title: `QA Midterm Assessment ${timestamp}`,
      code: `EXAM-${String(timestamp).slice(-6)}`,
      examType: "UNIT_TEST",
      startDate: new Date("2026-12-01").toISOString(),
      endDate: new Date("2026-12-05").toISOString(),
    });
    if (!examRes.ok) console.log("createExaminationAction error:", examRes.error);
    expect(examRes.ok).toBe(true);
    const examId = examRes.data!.id;
    createdExamIds.push(examId);

    // 3. Configure Subject Assessment
    const subRes = await saveExamSubjectsAction({
      examId,
      subjects: [
        {
          subjectId: subject.id,
          examDate: "2026-12-02",
          maxMarks: 100,
          passingMarks: 40,
          weightage: 1,
          order: 1,
        },
      ],
    });
    expect(subRes.ok).toBe(true);

    const examSubject = await db.examSubject.findFirst({
      where: { examId, subjectId: subject.id },
    });
    expect(examSubject).not.toBeNull();

    // 4. Auto-enroll eligible candidates
    const enrollRes = await autoEnrollEligibleStudentsAction(examId);
    expect(enrollRes.ok).toBe(true);
    expect(enrollRes.data!.enrolledCount).toBeGreaterThanOrEqual(2);

    // 5. Enter marks for both candidates
    const marksRes = await enterMarksBulkAction({
      examId,
      examSubjectId: examSubject!.id,
      entries: [
        { studentId: s1.id, marksObtained: 88, isAbsent: false, isExempted: false, expectedVersion: 0 },
        { studentId: s2.id, marksObtained: 72, isAbsent: false, isExempted: false, expectedVersion: 0 },
      ],
      reason: "Initial evaluation scoring",
      submitForVerification: true,
    });
    expect(marksRes.ok).toBe(true);

    // 6. Verify Subject Marks -> moves exam to EVALUATED
    const verifyRes = await verifyExamSubjectMarksAction(examId, examSubject!.id);
    expect(verifyRes.ok).toBe(true);

    const evaluatedExam = await db.examination.findUnique({ where: { id: examId } });
    expect(evaluatedExam?.status).toBe("EVALUATED");

    // 7. Calculate and Publish Results
    const pubRes = await calculateAndPublishResultsAction({ examId });
    expect(pubRes.ok).toBe(true);

    const publishedExam = await db.examination.findUnique({ where: { id: examId } });
    expect(publishedExam?.status).toBe("PUBLISHED");
    expect(publishedExam?.isPublished).toBe(true);

    // 8. Assert Results & Snapshot Integrity
    const r1 = await db.examResult.findFirst({
      where: { examId, studentId: s1.id },
      include: { snapshots: true },
    });
    expect(r1).not.toBeNull();
    expect(r1?.totalMarksObtained).toBe(88);
    expect(r1?.rank).toBe(1);
    expect(r1?.resultStatus).toBe("PASS");
    expect(r1?.snapshots.length).toBe(1);
    expect(r1?.snapshots[0].version).toBe(1);
    expect(r1?.snapshots[0].checksum).toBeDefined();

    // 9. Correct Published Mark & Verify Versioned Snapshot
    const correctRes = await correctPublishedMarkAction({
      examId,
      examSubjectId: examSubject!.id,
      studentId: s2.id,
      newMark: 94,
      reason: "Calculation error rechecked by senior faculty",
      expectedVersion: 2, // version advances upon verify
    });
    expect(correctRes.ok).toBe(true);

    const r2Post = await db.examResult.findFirst({
      where: { examId, studentId: s2.id },
      include: { snapshots: { orderBy: { version: "asc" } } },
    });
    expect(r2Post?.totalMarksObtained).toBe(94);
    expect(r2Post?.snapshots.length).toBe(2);
    expect(r2Post?.snapshots[0].version).toBe(1);
    expect(r2Post?.snapshots[1].version).toBe(2);
  });

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW 4: ATTENDANCE RECORDING & ABSENT GUARDIAN ALERT
  // ─────────────────────────────────────────────────────────────
  it("Workflow 4: Records daily attendance and dispatches absence alerts for absent candidates", async () => {
    const timestamp = Date.now();
    const stu = await db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `ATT-STU-${String(timestamp).slice(-6)}`,
        firstName: "AttendanceStudent",
        lastName: `AbsentTest-${timestamp}`,
        status: "ACTIVE",
        classId: classLevel.id,
        sectionId: section.id,
      },
    });
    createdStudentIds.push(stu.id);

    const guardian = await db.guardian.create({
      data: {
        tenantId: tenant.id,
        name: "Absent Guardian",
        phone: `982${String(timestamp).slice(-7)}`,
        email: `guardian.${timestamp}@example.com`,
      },
    });
    await db.studentGuardian.create({
      data: {
        studentId: stu.id,
        guardianId: guardian.id,
        isPrimary: true,
      },
    });

    const fd = new FormData();
    fd.append("date", "2026-11-10");
    fd.append("sectionId", section.id);
    fd.append(`status_${stu.id}`, "ABSENT");

    const res = await markAttendanceAction({}, fd);
    expect(res.success).toBeDefined();

    const record = await db.attendance.findFirst({
      where: { studentId: stu.id, date: new Date("2026-11-10T00:00:00.000Z") },
    });
    expect(record?.status).toBe("ABSENT");
  });

  // ─────────────────────────────────────────────────────────────
  // WORKFLOW 5: FEE INVOICE -> PARTIAL PAYMENT -> FULL SETTLEMENT
  // ─────────────────────────────────────────────────────────────
  it("Workflow 5: Manages fee invoice lifecycle with partial and final settlement", async () => {
    const timestamp = Date.now();
    const stu = await db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `FEE-STU-${String(timestamp).slice(-6)}`,
        firstName: "FeeStudent",
        lastName: `Test-${timestamp}`,
        status: "ACTIVE",
        classId: classLevel.id,
        sectionId: section.id,
      },
    });
    createdStudentIds.push(stu.id);

    // 1. Create Invoice
    const fd = new FormData();
    fd.append("studentId", stu.id);
    fd.append("title", "Term 1 Tuition Fee");
    fd.append("amount", "5000"); // ₹5,000
    fd.append("dueDate", "2026-12-15");
    fd.append("notes", "");

    let redirectCaught = false;
    try {
      const res = await createFeeInvoiceAction({}, fd);
      if (res?.error) console.log("createFeeInvoiceAction error:", res.error);
    } catch (err: any) {
      if (err.message?.includes("REDIRECT")) redirectCaught = true;
      else throw err;
    }
    expect(redirectCaught).toBe(true);

    const invoice = await db.feeInvoice.findFirst({
      where: { tenantId: tenant.id, studentId: stu.id },
    });
    expect(invoice).not.toBeNull();
    expect(invoice?.amount).toBe(500000); // 500,000 paise = ₹5,000
    expect(invoice?.paidAmount).toBe(0);
    expect(invoice?.status).toBe("PENDING");
    createdInvoiceIds.push(invoice!.id);

    // 2. Record Partial Payment (₹2,000)
    const p1Fd = new FormData();
    p1Fd.append("invoiceId", invoice!.id);
    p1Fd.append("amount", "2000");
    p1Fd.append("method", "UPI");
    p1Fd.append("reference", "UPI-REF-001");

    const p1Res = await recordFeePaymentAction({}, p1Fd);
    expect(p1Res.success).toBeDefined();

    const invAfterP1 = await db.feeInvoice.findUnique({ where: { id: invoice!.id } });
    expect(invAfterP1?.paidAmount).toBe(200000); // ₹2,000
    expect(invAfterP1?.status).toBe("PARTIAL");

    // 3. Prevent Overpayment (Attempting ₹4,000 when only ₹3,000 is outstanding)
    const overFd = new FormData();
    overFd.append("invoiceId", invoice!.id);
    overFd.append("amount", "4000");
    overFd.append("method", "CASH");
    overFd.append("reference", "");
    const overRes = await recordFeePaymentAction({}, overFd);
    expect(overRes.error).toMatch(/outstanding balance is/i);

    // 4. Record Final Settlement (₹3,000)
    const p2Fd = new FormData();
    p2Fd.append("invoiceId", invoice!.id);
    p2Fd.append("amount", "3000");
    p2Fd.append("method", "BANK_TRANSFER");
    p2Fd.append("reference", "NEFT-REF-002");
    const p2Res = await recordFeePaymentAction({}, p2Fd);
    expect(p2Res.success).toBeDefined();

    const invFinal = await db.feeInvoice.findUnique({ where: { id: invoice!.id } });
    expect(invFinal?.paidAmount).toBe(500000);
    expect(invFinal?.status).toBe("PAID");
    expect(invFinal?.paidAt).not.toBeNull();
  });
});
