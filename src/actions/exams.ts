"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { getTenantContext, hasTenantPermission } from "@/lib/auth";
import {
  createExaminationSchema,
  updateExaminationSchema,
  saveExamSubjectsSchema,
  enrollStudentsSchema,
  updateEnrollmentStatusSchema,
  bulkMarksEntrySchema,
  createGradeScaleSchema,
  publishResultsSchema,
  correctPublishedMarkSchema,
  transitionExamStatusSchema,
  reopenEvaluatedExamSchema,
  cancelExaminationSchema,
  archiveExaminationSchema,
} from "@/lib/exams-schema";
import {
  lockExaminationRow,
  verifyCandidateSubjectCompleteness,
  transitionExamStatus,
} from "@/lib/exam-lifecycle";
import {
  canonicalStringify,
  computeSnapshotChecksum,
  verifySnapshotChecksum,
} from "@/lib/exam-snapshot";
import {
  Prisma,
  type ExamStatus,
  type ExamTargetType,
  type ExamEnrollmentStatus,
  type ExamEvaluationStatus,
  type ExamResultStatus,
} from "@prisma/client";

export type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  code?: string;
  data?: T;
};

// ─────────────────────────────────────────────────────────────
// 1. EXAMINATION CRUD ACTIONS
// ─────────────────────────────────────────────────────────────

export async function createExaminationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "create");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = createExaminationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const data = parsed.data;

  // Tenant scoping checks
  const [academicYear, gradeScale] = await Promise.all([
    db.academicYear.findFirst({
      where: { id: data.academicYearId, tenantId: ctx.tenant.id },
    }),
    db.gradeScale.findFirst({
      where: { id: data.gradeScaleId, tenantId: ctx.tenant.id },
    }),
  ]);

  if (!academicYear) return { ok: false, error: "Academic year not found in this institute." };
  if (!gradeScale) return { ok: false, error: "Grading scale not found in this institute." };

  if (data.targetType === "CLASS_SECTION") {
    const classLevel = await db.classLevel.findFirst({
      where: { id: data.classId!, tenantId: ctx.tenant.id },
    });
    if (!classLevel) return { ok: false, error: "Target class not found in this institute." };
    if (data.sectionId) {
      const section = await db.section.findFirst({
        where: { id: data.sectionId, classId: data.classId!, tenantId: ctx.tenant.id },
      });
      if (!section) return { ok: false, error: "Target section not found for this class." };
    }
  } else if (data.targetType === "BATCH") {
    const batch = await db.batch.findFirst({
      where: { id: data.batchId!, tenantId: ctx.tenant.id },
    });
    if (!batch) return { ok: false, error: "Target batch not found in this institute." };
    if (batch.academicYearId !== data.academicYearId) {
      return { ok: false, error: `Batch '${batch.name}' belongs to a different academic year.` };
    }
  }

  if (data.syllabusTrackId) {
    const syllabus = await db.syllabusTrack.findFirst({
      where: { id: data.syllabusTrackId, tenantId: ctx.tenant.id },
    });
    if (!syllabus) return { ok: false, error: "Linked SyllabusTrack not found in this institute." };
  }

  // Unique code check within tenant
  const existing = await db.examination.findFirst({
    where: { tenantId: ctx.tenant.id, code: data.code },
  });
  if (existing) {
    return { ok: false, error: `Examination code '${data.code}' is already in use.` };
  }

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });

  if (!membership) {
    return { ok: false, error: "Staff membership required to author an examination." };
  }

  const exam = await db.examination.create({
    data: {
      tenantId: ctx.tenant.id,
      academicYearId: data.academicYearId,
      gradeScaleId: data.gradeScaleId,
      syllabusTrackId: data.syllabusTrackId,
      targetType: data.targetType as ExamTargetType,
      classId: data.classId,
      sectionId: data.sectionId,
      batchId: data.batchId,
      title: data.title,
      code: data.code,
      examType: data.examType,
      status: "DRAFT",
      term: data.term,
      instructions: data.instructions,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      createdById: membership.id,
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.created",
    entity: "Examination",
    entityId: exam.id,
    meta: { title: exam.title, code: exam.code, targetType: exam.targetType },
  });

  revalidatePath("/app/exams");
  return { ok: true, data: { id: exam.id } };
}

export async function updateExaminationAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateExaminationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const data = parsed.data;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, data.id, ctx.tenant.id);
    if (!lockedExam) {
      return { ok: false, error: "Examination not found." };
    }

    // 2. Safeguard: ARCHIVED examinations are permanently frozen and immutable
    if (lockedExam.status === "ARCHIVED") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: "Archived examinations are permanently frozen and immutable. No modifications are permitted.",
      };
    }

    // 3. Safeguard: PUBLISHED examinations protect report-card business data
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      if (data.status && data.status !== "PUBLISHED") {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          error: "Published examination results cannot change status directly. Use correctPublishedMarkAction or archive.",
        };
      }

      // Verify that business grading, title, and curriculum parameters are not altered
      const gradeScaleChanged = data.gradeScaleId && data.gradeScaleId !== lockedExam.gradeScaleId;
      const syllabusChanged = data.syllabusTrackId !== undefined && data.syllabusTrackId !== lockedExam.syllabusTrackId;
      const titleChanged = data.title && data.title !== lockedExam.title;

      if (titleChanged) {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          error: "Cannot modify examination title for a published examination as official report cards and snapshots have already been issued with this title.",
        };
      }

      if (gradeScaleChanged || syllabusChanged) {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          error: "Cannot modify grading scales or syllabus structure for a published examination as official report cards have already been issued.",
        };
      }
    }

    // 4. Lifecycle transition handling if genuine status change is requested
    let targetStatus: ExamStatus = lockedExam.status;
    if (data.status && data.status !== lockedExam.status) {
      const transRes = await transitionExamStatus(tx, lockedExam.id, ctx, data.status as ExamStatus);
      if (!transRes.ok) {
        return { ok: false, code: transRes.code, error: transRes.error };
      }
      targetStatus = data.status as ExamStatus;
    }

    // 5. Update permitted metadata fields
    await tx.examination.update({
      where: { id: lockedExam.id },
      data: {
        title: data.title,
        term: data.term,
        instructions: data.instructions,
        ...(lockedExam.status !== "PUBLISHED"
          ? {
              gradeScaleId: data.gradeScaleId ?? lockedExam.gradeScaleId,
              syllabusTrackId: data.syllabusTrackId !== undefined ? data.syllabusTrackId : lockedExam.syllabusTrackId,
              startDate: new Date(data.startDate),
              endDate: new Date(data.endDate),
            }
          : {}),
      },
    });

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.updated",
        entity: "Examination",
        entityId: lockedExam.id,
        meta: { title: data.title, status: targetStatus },
      },
      tx
    );

    revalidatePath(`/app/exams/${lockedExam.id}`);
    revalidatePath("/app/exams");
    return { ok: true };
  });
}

export async function deleteExaminationAction(examId: string): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "delete");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) {
      return { ok: false, error: "Examination not found." };
    }

    // 2. Safeguard: Only empty DRAFT examinations can be permanently deleted
    if (lockedExam.isPublished || lockedExam.status !== "DRAFT") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: `Only draft examinations can be deleted (current status: '${lockedExam.status}'). Operational examinations must be cancelled or archived.`,
      };
    }

    // 3. Check for any operational or historical candidate/mark records
    const [enrollmentCount, markCount, revisionEventCount, resultCount] = await Promise.all([
      tx.examEnrollment.count({ where: { examId, tenantId: ctx.tenant.id } }),
      tx.examMark.count({ where: { examId, tenantId: ctx.tenant.id } }),
      tx.examMarksRevisionEvent.count({ where: { examId, tenantId: ctx.tenant.id } }),
      tx.examResult.count({ where: { examId, tenantId: ctx.tenant.id } }),
    ]);

    if (enrollmentCount > 0 || markCount > 0 || revisionEventCount > 0 || resultCount > 0) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: `Operational examinations with enrolled candidates (${enrollmentCount}), marks (${markCount}), or revision events (${revisionEventCount}) cannot be permanently deleted. Use cancellation instead.`,
      };
    }

    // 4. Safely delete subjects and draft exam record
    await tx.examSubject.deleteMany({ where: { examId, tenantId: ctx.tenant.id } });
    await tx.examination.delete({ where: { id: examId } });

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.deleted",
        entity: "Examination",
        entityId: examId,
        meta: { id: examId },
      },
      tx
    );

    revalidatePath("/app/exams");
    return { ok: true };
  });
}

export async function transitionExamStatusAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = transitionExamStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, requestedStatus, reason, expectedCurrentStatus } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    return await transitionExamStatus(tx, examId, ctx, requestedStatus as ExamStatus, {
      reason,
      expectedCurrentStatus: expectedCurrentStatus as ExamStatus | undefined,
    });
  });

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }

  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  return { ok: true, data: result.data };
}

export async function cancelExaminationAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = cancelExaminationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, reason } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    return await transitionExamStatus(tx, examId, ctx, "ARCHIVED", {
      reason,
    });
  });

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }

  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  return { ok: true, data: result.data };
}

export async function reopenEvaluatedExamAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.manage_grading", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = reopenEvaluatedExamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, reason } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    return await transitionExamStatus(tx, examId, ctx, "IN_PROGRESS", {
      reason,
    });
  });

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }

  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  return { ok: true, data: result.data };
}

export async function archiveExaminationAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = archiveExaminationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, reason } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    return await transitionExamStatus(tx, examId, ctx, "ARCHIVED", {
      reason,
    });
  });

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }

  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  return { ok: true, data: result.data };
}

// ─────────────────────────────────────────────────────────────
// 2. EXAM SUBJECTS & SCHEDULE CONFIGURATION
// ─────────────────────────────────────────────────────────────

export async function saveExamSubjectsAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = saveExamSubjectsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, subjects } = parsed.data;

  // Validate that all subject IDs belong to the tenant
  const subjectIds = subjects.map((s) => s.subjectId);
  const existingSubjects = await db.subject.findMany({
    where: { id: { in: subjectIds }, tenantId: ctx.tenant.id },
  });
  if (existingSubjects.length !== subjectIds.length) {
    return { ok: false, error: "One or more selected subjects do not exist in this institute." };
  }

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) {
      return { ok: false, error: "Examination not found." };
    }

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify subjects of an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify subjects of a published exam." };
    }
    if (lockedExam.status === "EVALUATED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify subjects of an evaluated examination. Reopen evaluation first." };
    }

    // For each subject, upsert
    for (const sub of subjects) {
      await tx.examSubject.upsert({
        where: {
          examId_subjectId: {
            examId,
            subjectId: sub.subjectId,
          },
        },
        create: {
          tenantId: ctx.tenant.id,
          examId,
          subjectId: sub.subjectId,
          examDate: new Date(sub.examDate),
          startTime: sub.startTime,
          endTime: sub.endTime,
          roomNo: sub.roomNo,
          maxMarks: sub.maxMarks,
          passingMarks: sub.passingMarks,
          weightage: sub.weightage,
          order: sub.order,
        },
        update: {
          examDate: new Date(sub.examDate),
          startTime: sub.startTime,
          endTime: sub.endTime,
          roomNo: sub.roomNo,
          maxMarks: sub.maxMarks,
          passingMarks: sub.passingMarks,
          weightage: sub.weightage,
          order: sub.order,
        },
      });
    }

    // If exam is in DRAFT status, move to SCHEDULED via state machine
    if (lockedExam.status === "DRAFT") {
      const transRes = await transitionExamStatus(tx, examId, ctx, "SCHEDULED");
      if (!transRes.ok) return { ok: false, code: transRes.code, error: transRes.error };
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.subjects_configured",
        entity: "Examination",
        entityId: examId,
        meta: { subjectCount: subjects.length },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    return { ok: true };
  });
}

// ─────────────────────────────────────────────────────────────
// 3. STUDENT ENROLLMENT & PARTICIPATION
// ─────────────────────────────────────────────────────────────

export async function autoEnrollEligibleStudentsAction(examId: string): Promise<ActionResult<{ enrolledCount: number }>> {
  const auth = await authorizeTenantWrite("tenant.exams.enroll", "create");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) return { ok: false, error: "Examination not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in a published exam." };
    }
    if (lockedExam.status === "EVALUATED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in an evaluated examination. Reopen evaluation first." };
    }

    const exam = await tx.examination.findUnique({
      where: { id: examId },
      select: { targetType: true, sectionId: true, classId: true, batchId: true },
    });
    if (!exam) return { ok: false, error: "Examination not found." };

    let eligibleStudentIds: string[] = [];

    if (exam.targetType === "CLASS_SECTION") {
      if (exam.sectionId) {
        const students = await tx.student.findMany({
          where: { tenantId: ctx.tenant.id, sectionId: exam.sectionId, status: "ACTIVE" },
          select: { id: true },
        });
        eligibleStudentIds = students.map((s) => s.id);
      } else if (exam.classId) {
        const students = await tx.student.findMany({
          where: { tenantId: ctx.tenant.id, classId: exam.classId, status: "ACTIVE" },
          select: { id: true },
        });
        eligibleStudentIds = students.map((s) => s.id);
      }
    } else if (exam.targetType === "BATCH" && exam.batchId) {
      const enrollments = await tx.batchStudent.findMany({
        where: { batchId: exam.batchId, status: "ACTIVE" },
        select: { studentId: true },
      });
      eligibleStudentIds = enrollments.map((e) => e.studentId);
    }

    if (eligibleStudentIds.length === 0) {
      return { ok: false, error: "No active eligible students found for this examination target." };
    }

    // Create enrollments skipping existing
    let createdCount = 0;
    for (const studentId of eligibleStudentIds) {
      const existing = await tx.examEnrollment.findUnique({
        where: {
          examId_studentId: { examId, studentId },
        },
      });
      if (!existing) {
        await tx.examEnrollment.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            studentId,
            status: "ELIGIBLE",
          },
        });
        createdCount++;
      }
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.auto_enrolled_students",
        entity: "Examination",
        entityId: examId,
        meta: { createdCount, totalEligible: eligibleStudentIds.length },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    return { ok: true, data: { enrolledCount: createdCount } };
  });
}

export async function enrollStudentsAction(input: unknown): Promise<ActionResult<{ enrolledCount: number }>> {
  const auth = await authorizeTenantWrite("tenant.exams.enroll", "create");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = enrollStudentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, studentIds } = parsed.data;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) return { ok: false, error: "Examination not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in a published exam." };
    }
    if (lockedExam.status === "EVALUATED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot enroll students in an evaluated examination. Reopen evaluation first." };
    }

    const exam = await tx.examination.findFirst({
      where: { id: examId, tenantId: ctx.tenant.id },
      include: { batch: true, class: true, section: true },
    });
    if (!exam) return { ok: false, error: "Examination not found." };

    // Phase 2 & 3: Validate candidate eligibility against target academic unit
    if (exam.targetType === "BATCH" && exam.batchId) {
      const activeBatchStudents = await tx.batchStudent.findMany({
        where: { batchId: exam.batchId, studentId: { in: studentIds }, status: "ACTIVE" },
        select: { studentId: true },
      });
      const activeSet = new Set(activeBatchStudents.map((b) => b.studentId));
      const invalidStudents = studentIds.filter((id) => !activeSet.has(id));
      if (invalidStudents.length > 0) {
        return {
          ok: false,
          error: `One or more selected students are not active members of batch '${exam.batch?.name}'.`,
        };
      }
    } else if (exam.targetType === "CLASS_SECTION" && exam.classId) {
      const classStudents = await tx.student.findMany({
        where: {
          id: { in: studentIds },
          tenantId: ctx.tenant.id,
          classId: exam.classId,
          ...(exam.sectionId ? { sectionId: exam.sectionId } : {}),
          status: "ACTIVE",
        },
        select: { id: true },
      });
      const validSet = new Set(classStudents.map((s) => s.id));
      const invalid = studentIds.filter((id) => !validSet.has(id));
      if (invalid.length > 0) {
        return {
          ok: false,
          error: "One or more selected students do not belong to the targeted class or section.",
        };
      }
    }

    let createdCount = 0;
    for (const studentId of studentIds) {
      const existing = await tx.examEnrollment.findUnique({
        where: {
          examId_studentId: { examId, studentId },
        },
      });
      if (!existing) {
        await tx.examEnrollment.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            studentId,
            status: "ELIGIBLE",
          },
        });
        createdCount++;
      }
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.students_enrolled",
        entity: "Examination",
        entityId: exam.id,
        meta: { enrolledCount: createdCount },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    return { ok: true, data: { enrolledCount: createdCount } };
  });
}

export type PreservedSubjectMark = {
  examSubjectId: string;
  markId: string | null;
  marksObtained: number | null;
  isAbsent: boolean;
  isExempted: boolean;
  evaluationStatus: ExamEvaluationStatus;
  feedback: string | null;
  enteredById: string | null;
  enteredAt: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  version: number;
};

export async function updateEnrollmentStatusAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.enroll", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateEnrollmentStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { enrollmentId, status, remarks, overwriteExistingMarks } = parsed.data;

  return await db.$transaction(async (tx) => {
    const initialEnrollment = await tx.examEnrollment.findFirst({
      where: { id: enrollmentId, tenantId: ctx.tenant.id },
    });
    if (!initialEnrollment) return { ok: false, error: "Enrollment not found." };

    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, initialEnrollment.examId, ctx.tenant.id);
    if (!lockedExam) return { ok: false, error: "Examination not found." };

    // Re-fetch enrollment under the root Examination lock to guarantee latest committed state
    const enrollment = await tx.examEnrollment.findFirst({
      where: { id: enrollmentId, tenantId: ctx.tenant.id },
    });
    if (!enrollment) return { ok: false, error: "Enrollment not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify enrollment of an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify enrollment of a published exam." };
    }
    if (lockedExam.status === "EVALUATED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify enrollment of an evaluated examination. Reopen evaluation first." };
    }

    const membership = await tx.membership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
    });
    const membershipId = membership?.id || null;

    // Fetch configured subjects with subject name for rich reporting
    const subjects = await tx.examSubject.findMany({
      where: { examId: enrollment.examId, tenantId: ctx.tenant.id },
      include: { subject: true },
      orderBy: { order: "asc" },
    });

    // Fetch existing marks for this candidate
    const existingMarks = await tx.examMark.findMany({
      where: {
        examId: enrollment.examId,
        studentId: enrollment.studentId,
        tenantId: ctx.tenant.id,
      },
    });

    const isExempted = status === "EXEMPTED";
    const isAbsent = status === "ABSENT";

    if (isExempted || isAbsent) {
      // FIX F-02: Comprehensive overwrite protection
      // If the candidate is currently ELIGIBLE (not already in candidate-level override),
      // detect ANY existing meaningful subject-level data:
      // - Numeric scores (marksObtained !== null)
      // - Subject-level absence (isAbsent === true)
      // - Subject-level exemption (isExempted === true)
      // - Evaluated status (SUBMITTED or VERIFIED)
      // - Feedback remarks
      const isCurrentlyCandidateOverride =
        (enrollment.status === "EXEMPTED" || enrollment.status === "ABSENT") &&
        enrollment.preservedMarks !== null;

      if (!isCurrentlyCandidateOverride) {
        const meaningfulMarks = existingMarks.filter((m) => {
          const hasScore = m.marksObtained !== null;
          const isMarkAbsent = m.isAbsent;
          const isMarkExempted = m.isExempted;
          const isVerifiedOrSubmitted = m.evaluationStatus === "VERIFIED" || m.evaluationStatus === "SUBMITTED";
          const hasFeedback = Boolean(m.feedback && m.feedback.trim() !== "");
          return hasScore || isMarkAbsent || isMarkExempted || isVerifiedOrSubmitted || hasFeedback;
        });

        if (meaningfulMarks.length > 0 && !overwriteExistingMarks) {
          const affectedSubjectNames = subjects
            .filter((s) => meaningfulMarks.some((m) => m.examSubjectId === s.id))
            .map((s) => s.subject.name);

          const subjectListStr =
            affectedSubjectNames.length > 0
              ? ` (${affectedSubjectNames.join(", ")})`
              : "";

          return {
            ok: false,
            code: "EXISTING_MARKS_PRESENT",
            error: `Candidate has existing entered subject-level records in ${meaningfulMarks.length} subject(s)${subjectListStr}. Explicit confirmation is required to overwrite these marks with candidate-level ${status.toLowerCase()}.`,
          };
        }
      }

      // FIX F-03: Capture and preserve exact pre-override state before applying candidate-level override.
      // If candidate is already in candidate-level override (e.g. EXEMPTED -> ABSENT), we preserve the original
      // snapshot stored when candidate was ELIGIBLE. Otherwise, snapshot current state.
      let preservedToStore = enrollment.preservedMarks as PreservedSubjectMark[] | null;

      if (!preservedToStore || !Array.isArray(preservedToStore) || preservedToStore.length === 0) {
        preservedToStore = subjects.map((sub) => {
          const mark = existingMarks.find((m) => m.examSubjectId === sub.id);
          if (!mark) {
            return {
              examSubjectId: sub.id,
              markId: null,
              marksObtained: null,
              isAbsent: false,
              isExempted: false,
              evaluationStatus: "PENDING" as ExamEvaluationStatus,
              feedback: null,
              enteredById: null,
              enteredAt: null,
              verifiedById: null,
              verifiedAt: null,
              version: 0,
            };
          }
          return {
            examSubjectId: sub.id,
            markId: mark.id,
            marksObtained: mark.marksObtained !== null ? Number(mark.marksObtained) : null,
            isAbsent: mark.isAbsent,
            isExempted: mark.isExempted,
            evaluationStatus: mark.evaluationStatus,
            feedback: mark.feedback,
            enteredById: mark.enteredById,
            enteredAt: mark.enteredAt ? mark.enteredAt.toISOString() : null,
            verifiedById: mark.verifiedById,
            verifiedAt: mark.verifiedAt ? mark.verifiedAt.toISOString() : null,
            version: mark.version,
          };
        });
      }

      const feedbackTag = isExempted ? "[Candidate Exemption]" : "[Candidate Absent]";
      const effectiveFeedback = remarks ? `${feedbackTag} ${remarks}` : feedbackTag;

      for (const sub of subjects) {
        const mark = existingMarks.find((m) => m.examSubjectId === sub.id);
        if (mark) {
          await tx.examMark.update({
            where: { id: mark.id },
            data: {
              marksObtained: null,
              isAbsent,
              isExempted,
              evaluationStatus: "VERIFIED",
              verifiedById: membershipId,
              verifiedAt: new Date(),
              version: mark.version + 1,
              feedback: effectiveFeedback,
            },
          });

          await tx.examMarksRevisionEvent.create({
            data: {
              tenantId: ctx.tenant.id,
              examId: enrollment.examId,
              examSubjectId: sub.id,
              studentId: enrollment.studentId,
              markId: mark.id,
              actorId: ctx.user.id,
              actorName: ctx.user.name,
              oldMarks: mark.marksObtained,
              newMarks: null,
              oldStatus: mark.evaluationStatus,
              newStatus: "VERIFIED",
              reason: remarks ? `Candidate-level ${status}: ${remarks}` : `Candidate-level ${status} applied`,
            },
          });
        } else {
          const newMark = await tx.examMark.create({
            data: {
              tenantId: ctx.tenant.id,
              examId: enrollment.examId,
              examSubjectId: sub.id,
              studentId: enrollment.studentId,
              enrollmentId: enrollment.id,
              marksObtained: null,
              isAbsent,
              isExempted,
              evaluationStatus: "VERIFIED",
              version: 1,
              enteredById: membershipId,
              enteredAt: new Date(),
              verifiedById: membershipId,
              verifiedAt: new Date(),
              feedback: effectiveFeedback,
            },
          });

          await tx.examMarksRevisionEvent.create({
            data: {
              tenantId: ctx.tenant.id,
              examId: enrollment.examId,
              examSubjectId: sub.id,
              studentId: enrollment.studentId,
              markId: newMark.id,
              actorId: ctx.user.id,
              actorName: ctx.user.name,
              oldMarks: null,
              newMarks: null,
              oldStatus: null,
              newStatus: "VERIFIED",
              reason: remarks ? `Candidate-level ${status}: ${remarks}` : `Candidate-level ${status} applied`,
            },
          });
        }
      }

      await tx.examEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: status as ExamEnrollmentStatus,
          remarks,
          preservedMarks: preservedToStore as unknown as Prisma.InputJsonValue,
        },
      });
    } else if (status === "ELIGIBLE" && (enrollment.status === "EXEMPTED" || enrollment.status === "ABSENT")) {
      // FIX F-03: Reverting to ELIGIBLE restores exact pre-override state
      const preserved = enrollment.preservedMarks as PreservedSubjectMark[] | null;

      if (!preserved || !Array.isArray(preserved) || preserved.length === 0) {
        return {
          ok: false,
          code: "RESTORATION_STATE_MISSING",
          error: "Cannot safely restore candidate to ELIGIBLE: pre-override subject marks preservation record is missing or invalid.",
        };
      }

      const isValidStructure = preserved.every(
        (p) =>
          p &&
          typeof p === "object" &&
          typeof p.examSubjectId === "string" &&
          (p.marksObtained === null || typeof p.marksObtained === "number") &&
          typeof p.isAbsent === "boolean" &&
          typeof p.isExempted === "boolean"
      );

      if (!isValidStructure) {
        return {
          ok: false,
          code: "RESTORATION_STATE_MISSING",
          error: "Cannot safely restore candidate to ELIGIBLE: pre-override subject marks preservation record is corrupted.",
        };
      }

      for (const item of preserved) {
        const currentMark = existingMarks.find((m) => m.examSubjectId === item.examSubjectId);
        if (!currentMark) continue;

        // Restore exact pre-override values
        await tx.examMark.update({
          where: { id: currentMark.id },
          data: {
            marksObtained: item.marksObtained,
            isAbsent: item.isAbsent,
            isExempted: item.isExempted,
            evaluationStatus: item.evaluationStatus || "PENDING",
            feedback: item.feedback,
            enteredById: item.enteredById,
            enteredAt: item.enteredAt ? new Date(item.enteredAt) : null,
            verifiedById: item.verifiedById,
            verifiedAt: item.verifiedAt ? new Date(item.verifiedAt) : null,
            version: currentMark.version + 1,
          },
        });

        await tx.examMarksRevisionEvent.create({
          data: {
            tenantId: ctx.tenant.id,
            examId: enrollment.examId,
            examSubjectId: item.examSubjectId,
            studentId: enrollment.studentId,
            markId: currentMark.id,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            oldMarks: currentMark.marksObtained,
            newMarks: item.marksObtained,
            oldStatus: currentMark.evaluationStatus,
            newStatus: item.evaluationStatus || "PENDING",
            reason: remarks
              ? `Candidate status restored to ELIGIBLE: pre-override subject mark restored (${remarks})`
              : "Candidate status restored to ELIGIBLE: pre-override subject mark restored",
          },
        });
      }

      await tx.examEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: "ELIGIBLE",
          remarks,
          preservedMarks: Prisma.DbNull, // Clear preservation record once successfully restored
        },
      });
    } else {
      await tx.examEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: status as ExamEnrollmentStatus,
          remarks,
        },
      });
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.enrollment_updated",
        entity: "ExamEnrollment",
        entityId: enrollment.id,
        meta: {
          examId: enrollment.examId,
          previousStatus: enrollment.status,
          newStatus: status,
          remarks,
          propagatedSubjectCount: subjects.length,
        },
      },
      tx
    );

    revalidatePath(`/app/exams/${enrollment.examId}`);
    return { ok: true };
  });
}

// ─────────────────────────────────────────────────────────────
// 4. MARKS ENTRY, REVISIONS & VERIFICATION
// ─────────────────────────────────────────────────────────────

export async function enterMarksBulkAction(input: unknown): Promise<ActionResult<{ updatedCount: number }>> {
  const auth = await authorizeTenantWrite("tenant.exams.enter_marks", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = bulkMarksEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, examSubjectId, entries, reason, submitForVerification } = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      // 1. Acquire root Examination row lock
      const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
      if (!lockedExam) return { ok: false, error: "Examination not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify marks for an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: "Cannot modify marks for a published examination. Use the authorized mark correction workflow.",
      };
    }
    if (lockedExam.status === "EVALUATED") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: "Cannot enter or modify marks for an evaluated examination. Reopen evaluation first.",
      };
    }

    const [exam, examSubject] = await Promise.all([
      tx.examination.findUnique({
        where: { id: examId },
      }),
      tx.examSubject.findFirst({
        where: { id: examSubjectId, examId, tenantId: ctx.tenant.id },
        include: { subject: true },
      }),
    ]);

    if (!exam) return { ok: false, error: "Examination not found." };
    if (!examSubject) return { ok: false, error: "Subject assessment not found for this examination." };

    const membership = await tx.membership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
    });
    const membershipId = membership?.id || null;

    // Teacher Subject Assignment Authorization Check
    if (ctx.membership?.roleKey === "TEACHER" && membership) {
      let isAssigned = false;
      if (exam.targetType === "BATCH" && exam.batchId) {
        const bt = await tx.batchTeacher.findUnique({
          where: { batchId_teacherId: { batchId: exam.batchId, teacherId: membership.id } },
        });
        if (bt || examSubject.subject.teacherId === membership.id) {
          isAssigned = true;
        }
      } else if (exam.targetType === "CLASS_SECTION") {
        if (examSubject.subject.teacherId === membership.id) {
          isAssigned = true;
        }
      }
      if (!isAssigned) {
        return { ok: false, error: "Access denied: You are not assigned to evaluate this subject assessment." };
      }
    }

    // Validate maximum marks constraint
    for (const entry of entries) {
      if (entry.marksObtained !== null && entry.marksObtained !== undefined) {
        if (entry.marksObtained > examSubject.maxMarks) {
          return {
            ok: false,
            error: `Marks obtained (${entry.marksObtained}) exceeds maximum marks (${examSubject.maxMarks}) for ${examSubject.subject.name}.`,
          };
        }
      }
    }

    // Advance exam status to IN_PROGRESS if SCHEDULED or DRAFT
    if (lockedExam.status === "SCHEDULED" || lockedExam.status === "DRAFT") {
      const transRes = await transitionExamStatus(tx, examId, ctx, "IN_PROGRESS");
      if (!transRes.ok) {
        return { ok: false, code: transRes.code, error: transRes.error };
      }
    }

    const targetStatus: ExamEvaluationStatus = submitForVerification ? "SUBMITTED" : "DRAFT";
    let updatedCount = 0;

    for (const entry of entries) {
      // Find enrollment
      const enrollment = await tx.examEnrollment.findUnique({
        where: { examId_studentId: { examId, studentId: entry.studentId } },
      });

      if (!enrollment || enrollment.status === "WITHDRAWN") continue;

      // Candidate-level exemption or absence locks the candidate out of ordinary numeric marks entry
      if (
        (enrollment.status === "EXEMPTED" || enrollment.status === "ABSENT") &&
        entry.marksObtained !== null &&
        !entry.isAbsent &&
        !entry.isExempted
      ) {
        return {
          ok: false,
          error: `Cannot enter numeric marks for candidate '${entry.studentId}' with candidate-level status '${enrollment.status}'. Revert enrollment to ELIGIBLE first.`,
        };
      }

      const existingMark = await tx.examMark.findUnique({
        where: {
          examSubjectId_studentId: {
            examSubjectId,
            studentId: entry.studentId,
          },
        },
      });

      const effectiveMarks = entry.isAbsent || entry.isExempted ? null : entry.marksObtained;

      let markRecord;
      if (existingMark) {
        if (existingMark.evaluationStatus === "VERIFIED") {
          throw new Error(
            `Marks for candidate ${entry.studentId} have been verified and locked. Ordinary updates are prohibited.`
          );
        }

        // Strict optimistic concurrency: verify client's expectedVersion matches current database version
        if (existingMark.version !== entry.expectedVersion) {
          throw new Error("STALE_VERSION");
        }

        const isChanged =
          existingMark.marksObtained !== effectiveMarks ||
          existingMark.isAbsent !== entry.isAbsent ||
          existingMark.isExempted !== entry.isExempted ||
          existingMark.evaluationStatus !== targetStatus;

        if (isChanged) {
          const updateRes = await tx.examMark.updateMany({
            where: { id: existingMark.id, version: entry.expectedVersion },
            data: {
              marksObtained: effectiveMarks,
              isAbsent: entry.isAbsent,
              isExempted: entry.isExempted,
              feedback: entry.feedback,
              evaluationStatus: targetStatus,
              enteredById: membershipId,
              enteredAt: new Date(),
              version: { increment: 1 },
            },
          });

          if (updateRes.count === 0) {
            throw new Error("STALE_VERSION");
          }

          // Record auditable revision event AFTER atomic update verification
          await tx.examMarksRevisionEvent.create({
            data: {
              tenantId: ctx.tenant.id,
              examId,
              examSubjectId,
              studentId: entry.studentId,
              markId: existingMark.id,
              actorId: ctx.user.id,
              actorName: ctx.user.name,
              oldMarks: existingMark.marksObtained,
              newMarks: effectiveMarks,
              oldStatus: existingMark.evaluationStatus,
              newStatus: targetStatus,
              reason,
            },
          });

          updatedCount++;
        }
      } else {
        // For uninitialized marks, client must have read state as non-existent (expectedVersion === 0)
        if (entry.expectedVersion !== 0) {
          throw new Error("STALE_VERSION");
        }

        markRecord = await tx.examMark.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            examSubjectId,
            studentId: entry.studentId,
            enrollmentId: enrollment.id,
            marksObtained: effectiveMarks,
            isAbsent: entry.isAbsent,
            isExempted: entry.isExempted,
            feedback: entry.feedback,
            evaluationStatus: targetStatus,
            enteredById: membershipId,
            enteredAt: new Date(),
          },
        });

        // Record initial entry in revision log as well for complete auditability
        await tx.examMarksRevisionEvent.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            examSubjectId,
            studentId: entry.studentId,
            markId: markRecord.id,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            oldMarks: null,
            newMarks: effectiveMarks,
            oldStatus: null,
            newStatus: targetStatus,
            reason: `Initial mark entry: ${reason}`,
          },
        });
        updatedCount++;
      }
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.marks_entered",
        entity: "ExamSubject",
        entityId: examSubjectId,
        meta: { updatedCount, submitForVerification, reason },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    return { ok: true, data: { updatedCount } };
  });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "STALE_VERSION") {
        return {
          ok: false,
          code: "STALE_VERSION",
          error: "The mark has been modified by another process. Please refresh and try again.",
        };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "An unexpected error occurred while entering marks." };
  }
}

export async function verifyExamSubjectMarksAction(examId: string, examSubjectId: string): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.verify_marks", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) return { ok: false, error: "Examination not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot verify marks for an archived examination." };
    }
    if (lockedExam.isPublished || lockedExam.status === "PUBLISHED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Examination is already published." };
    }

    const examSubject = await tx.examSubject.findFirst({
      where: { id: examSubjectId, examId, tenantId: ctx.tenant.id },
    });
    if (!examSubject) return { ok: false, error: "Subject assessment not found." };

    const membership = await tx.membership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
    });
    const membershipId = membership?.id || null;

    // Lock all marks for this subject to VERIFIED and increment version to invalidate stale marks-entry forms
    await tx.examMark.updateMany({
      where: { examSubjectId, tenantId: ctx.tenant.id },
      data: {
        evaluationStatus: "VERIFIED",
        verifiedById: membershipId,
        verifiedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // Check candidate-subject Cartesian completeness across the whole exam
    const completeness = await verifyCandidateSubjectCompleteness(tx, examId, ctx.tenant.id);
    if (completeness.isValid) {
      const transRes = await transitionExamStatus(tx, examId, ctx, "EVALUATED", {
        skipCompletenessCheck: true,
      });
      if (!transRes.ok) {
        return { ok: false, code: transRes.code, error: transRes.error };
      }
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.marks_verified",
        entity: "ExamSubject",
        entityId: examSubjectId,
        meta: { examId, evaluated: completeness.isValid },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    return { ok: true };
  });
}

// ─────────────────────────────────────────────────────────────
// 5. RESULT CALCULATION, SNAPSHOTS & PUBLICATION
// ─────────────────────────────────────────────────────────────

export async function calculateAndPublishResultsAction(input: unknown): Promise<ActionResult<{ publishedCount: number }>> {
  const auth = await authorizeTenantWrite("tenant.exams.publish_results", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = publishResultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId } = parsed.data;

  return await db.$transaction(async (tx) => {
    // 1. Acquire root Examination row lock
    const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
    if (!lockedExam) return { ok: false, error: "Examination not found." };

    if (lockedExam.status === "ARCHIVED") {
      return { ok: false, code: "INVALID_TRANSITION", error: "Cannot publish an archived examination." };
    }
    if (lockedExam.status !== "EVALUATED" && lockedExam.status !== "PUBLISHED") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: "Examination must be in EVALUATED status with all marks verified before publishing.",
      };
    }

    // 2. Strict candidate-subject Cartesian completeness check
    const completeness = await verifyCandidateSubjectCompleteness(tx, examId, ctx.tenant.id);
    if (!completeness.isValid) {
      return {
        ok: false,
        code: "INCOMPLETE_EVALUATION",
        error: `Cannot publish examination: ${completeness.errors[0]}`,
      };
    }

    const exam = await tx.examination.findFirst({
      where: { id: examId, tenantId: ctx.tenant.id },
      include: {
        academicYear: true,
        gradeScale: {
          include: {
            bands: {
              orderBy: { minPercentage: "desc" },
            },
          },
        },
        subjects: {
          include: { subject: true },
          orderBy: { order: "asc" },
        },
        enrollments: {
          include: {
            student: true,
            marks: {
              include: { examSubject: true },
            },
          },
        },
      },
    });

    if (!exam) return { ok: false, error: "Examination not found." };
    if (exam.subjects.length === 0) return { ok: false, error: "Cannot publish an examination with no subjects." };
    if (exam.enrollments.length === 0) return { ok: false, error: "Cannot publish an examination with no enrolled students." };

    // Intermediate computation container for students
    type StudentCalc = {
      enrollmentId: string;
      studentId: string;
      studentName: string;
      admissionNo: string;
      rollNumber: string | null;
      totalMaxMarks: number;
      totalMarksObtained: number;
      percentage: number;
      passedSubjectsCount: number;
      failedSubjectsCount: number;
      resultStatus: ExamResultStatus;
      grade: string;
      gradePoint: number;
      remarks: string | null;
      subjectBreakdown: Array<{
        subjectId: string;
        subjectName: string;
        subjectCode: string | null;
        maxMarks: number;
        passingMarks: number;
        marksObtained: number | null;
        isAbsent: boolean;
        isExempted: boolean;
        isPassed: boolean;
      }>;
    };

    const studentCalcs: StudentCalc[] = [];

    for (const enrollment of exam.enrollments) {
      // Withdrawn candidates do not receive calculated published results
      if (enrollment.status === "WITHDRAWN") {
        continue;
      }

      const isCandidateExempted = enrollment.status === "EXEMPTED";
      const isCandidateAbsent =
        enrollment.status === "ABSENT" ||
        (enrollment.marks.length > 0 && enrollment.marks.every((m) => m.isAbsent));

      let studentObtained = 0;
      let studentMaxMarks = 0;
      let passedSubjects = 0;
      let failedSubjects = 0;

      const breakdown = exam.subjects.map((es) => {
        const mark = enrollment.marks.find((m) => m.examSubjectId === es.id);
        const marksObtained = mark?.marksObtained ?? null;
        const isAbsent = isCandidateAbsent || (mark?.isAbsent ?? false);
        const isExempted = isCandidateExempted || (mark?.isExempted ?? false);

        const numericMark = isAbsent || isExempted || marksObtained === null ? 0 : marksObtained;
        studentObtained += numericMark * es.weightage;

        // Exempted marks cannot silently contribute to ordinary scored totals or denominators
        if (!isExempted) {
          studentMaxMarks += es.maxMarks * es.weightage;
        }

        const isPassed = !isAbsent && (isExempted || (marksObtained !== null && marksObtained >= es.passingMarks));
        if (isPassed) {
          passedSubjects++;
        } else {
          failedSubjects++;
        }

        return {
          subjectId: es.subjectId,
          subjectName: es.subject.name,
          subjectCode: es.subject.code,
          maxMarks: es.maxMarks,
          passingMarks: es.passingMarks,
          marksObtained,
          isAbsent,
          isExempted,
          isPassed,
        };
      });

      let percentage = 0;
      let grade = "N/A";
      let gradePoint = 0;
      let resultStatus: ExamResultStatus = "PASS";
      let remarks: string | null = null;

      if (isCandidateExempted || studentMaxMarks === 0) {
        resultStatus = "WITHHELD";
        grade = "EXM";
        remarks = "Candidate exempted from assessment";
      } else if (isCandidateAbsent) {
        resultStatus = "FAIL";
        percentage = 0;
        remarks = "Candidate absent in all assessments";
        const lowestBand = exam.gradeScale.bands[exam.gradeScale.bands.length - 1];
        if (lowestBand) {
          grade = lowestBand.letterGrade;
          gradePoint = lowestBand.gradePoint;
        }
      } else {
        const rawPercentage = studentMaxMarks > 0 ? (studentObtained / studentMaxMarks) * 100 : 0;
        percentage = Math.round((rawPercentage + Number.EPSILON) * 100) / 100;

        let matchedBand = exam.gradeScale.bands.find(
          (b) => percentage >= b.minPercentage && percentage <= b.maxPercentage
        );
        if (!matchedBand && exam.gradeScale.bands.length > 0) {
          matchedBand =
            percentage > 100
              ? exam.gradeScale.bands[0]
              : exam.gradeScale.bands[exam.gradeScale.bands.length - 1];
        }

        grade = matchedBand ? matchedBand.letterGrade : "N/A";
        gradePoint = matchedBand ? matchedBand.gradePoint : 0;
        resultStatus = failedSubjects === 0 ? "PASS" : "FAIL";
      }

      studentCalcs.push({
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        studentName: `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim(),
        admissionNo: enrollment.student.admissionNo,
        rollNumber: enrollment.rollNumber,
        totalMaxMarks: studentMaxMarks,
        totalMarksObtained: Math.round(studentObtained * 100) / 100,
        percentage,
        passedSubjectsCount: passedSubjects,
        failedSubjectsCount: failedSubjects,
        resultStatus,
        grade,
        gradePoint,
        remarks,
        subjectBreakdown: breakdown,
      });
    }

    // Rank assignment: descending by totalMarksObtained
    studentCalcs.sort((a, b) => b.totalMarksObtained - a.totalMarksObtained);

    let currentRank = 1;
    const rankedStudents = studentCalcs.map((sc, idx) => {
      if (idx > 0 && sc.totalMarksObtained < studentCalcs[idx - 1].totalMarksObtained) {
        currentRank = idx + 1;
      }
      return {
        ...sc,
        rank: sc.resultStatus === "PASS" ? currentRank : null,
      };
    });

    const publishedAt = new Date();
    const membership = await tx.membership.findFirst({
      where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
    });
    const membershipId = membership?.id || null;

    for (const student of rankedStudents) {
      // Upsert ExamResult
      const result = await tx.examResult.upsert({
        where: {
          examId_studentId: {
            examId,
            studentId: student.studentId,
          },
        },
        create: {
          tenantId: ctx.tenant.id,
          examId,
          studentId: student.studentId,
          enrollmentId: student.enrollmentId,
          totalMaxMarks: student.totalMaxMarks,
          totalMarksObtained: student.totalMarksObtained,
          percentage: student.percentage,
          grade: student.grade,
          gradePoint: student.gradePoint,
          rank: student.rank,
          processingStatus: "PUBLISHED",
          resultStatus: student.resultStatus,
          passedSubjectsCount: student.passedSubjectsCount,
          failedSubjectsCount: student.failedSubjectsCount,
          remarks: student.remarks,
          publishedAt,
          publishedById: membershipId,
        },
        update: {
          totalMaxMarks: student.totalMaxMarks,
          totalMarksObtained: student.totalMarksObtained,
          percentage: student.percentage,
          grade: student.grade,
          gradePoint: student.gradePoint,
          rank: student.rank,
          processingStatus: "PUBLISHED",
          resultStatus: student.resultStatus,
          passedSubjectsCount: student.passedSubjectsCount,
          failedSubjectsCount: student.failedSubjectsCount,
          remarks: student.remarks,
          publishedAt,
          publishedById: membershipId,
        },
      });

      // Construct Frozen Snapshot Payload
      const snapshotPayload = {
        institute: {
          id: ctx.tenant.id,
          name: ctx.tenant.name,
        },
        exam: {
          id: exam.id,
          title: exam.title,
          code: exam.code,
          examType: exam.examType,
          academicYear: exam.academicYear.name,
        },
        student: {
          id: student.studentId,
          name: student.studentName,
          admissionNo: student.admissionNo,
          rollNumber: student.rollNumber,
        },
        performance: {
          totalMaxMarks: student.totalMaxMarks,
          totalMarksObtained: student.totalMarksObtained,
          percentage: student.percentage,
          grade: student.grade,
          gradePoint: student.gradePoint,
          rank: student.rank,
          resultStatus: student.resultStatus,
          passedSubjectsCount: student.passedSubjectsCount,
          failedSubjectsCount: student.failedSubjectsCount,
        },
        subjects: student.subjectBreakdown,
        metadata: {
          publishedAt: publishedAt.toISOString(),
          publishedBy: ctx.user.name,
        },
      };

      const checksum = computeSnapshotChecksum(snapshotPayload);

      // Check if initial snapshot (version 1) exists
      const existingSnapshot = await tx.examResultSnapshot.findUnique({
        where: {
          resultId_version: {
            resultId: result.id,
            version: 1,
          },
        },
      });

      if (!existingSnapshot) {
        await tx.examResultSnapshot.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            studentId: student.studentId,
            resultId: result.id,
            version: 1,
            snapshotData: snapshotPayload as unknown as Prisma.InputJsonValue,
            checksum,
            generatedAt: publishedAt,
          },
        });
      }
    }

    // Advance exam status to PUBLISHED via transition engine
    const transRes = await transitionExamStatus(tx, examId, ctx, "PUBLISHED", {
      skipCompletenessCheck: true,
    });
    if (!transRes.ok) {
      return { ok: false, code: transRes.code, error: transRes.error };
    }

    await writeAudit(
      {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.results_published",
        entity: "Examination",
        entityId: exam.id,
        meta: { studentCount: rankedStudents.length, publishedAt: publishedAt.toISOString() },
      },
      tx
    );

    revalidatePath(`/app/exams/${examId}`);
    revalidatePath("/app/exams");
    return { ok: true, data: { publishedCount: rankedStudents.length } };
  });
}

export async function correctPublishedMarkAction(
  input: unknown
): Promise<ActionResult<{ success: boolean }>> {
  const auth = await authorizeTenantWrite("tenant.exams.correct_published_marks", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = correctPublishedMarkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { examId, examSubjectId, studentId, newMark, reason, expectedVersion } = parsed.data;

  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
    include: {
      academicYear: true,
      gradeScale: {
        include: {
          bands: {
            orderBy: { minPercentage: "desc" },
          },
        },
      },
      subjects: {
        include: { subject: true },
        orderBy: { order: "asc" },
      },
      enrollments: {
        include: {
          student: true,
          marks: {
            include: { examSubject: true },
          },
        },
      },
    },
  });

  if (!exam) return { ok: false, error: "Examination not found." };
  if (exam.status === "ARCHIVED") {
    return { ok: false, code: "INVALID_TRANSITION", error: "Cannot modify marks for an archived examination." };
  }
  if (!exam.isPublished) return { ok: false, error: "Examination is not published yet. Use regular marks entry." };

  const targetSubject = exam.subjects.find((s) => s.id === examSubjectId);
  if (!targetSubject) return { ok: false, error: "Subject assessment not found in this exam." };

  if (newMark > targetSubject.maxMarks) {
    return {
      ok: false,
      error: `New mark (${newMark}) exceeds maximum marks (${targetSubject.maxMarks}) for ${targetSubject.subject.name}.`,
    };
  }

  const existingMark = await db.examMark.findUnique({
    where: {
      examSubjectId_studentId: {
        examSubjectId,
        studentId,
      },
    },
  });

  if (!existingMark) {
    return { ok: false, error: "Mark record not found for this candidate and subject." };
  }

  // Pre-check expectedVersion before entering transaction
  if (existingMark.version !== expectedVersion) {
    return {
      ok: false,
      error: "The mark has been modified by another process. Please refresh and try again.",
      code: "STALE_VERSION",
    };
  }

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  const membershipId = membership?.id || null;

  try {
    await db.$transaction(async (tx) => {
      // 1. Examination-level row lock: serializes recalculations and ranking updates across all candidates in this exam
      const lockedExam = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Examination"
        WHERE id = ${examId} AND "tenantId" = ${ctx.tenant.id}
        FOR UPDATE
      `;

      if (lockedExam.length === 0) {
        throw new Error("EXAM_NOT_FOUND");
      }

      // 2. Candidate-level row lock on ExamResult: preserves canonical locking order (Examination -> ExamResult)
      const lockedResults = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ExamResult"
        WHERE "examId" = ${examId} AND "studentId" = ${studentId} AND "tenantId" = ${ctx.tenant.id}
        FOR UPDATE
      `;

      if (lockedResults.length === 0) {
        throw new Error("RESULT_NOT_FOUND");
      }

      // 3. Atomic optimistic check and version increment on ExamMark
      const markUpdate = await tx.examMark.updateMany({
        where: {
          id: existingMark.id,
          version: expectedVersion,
        },
        data: {
          marksObtained: newMark,
          isAbsent: false,
          isExempted: false,
          evaluationStatus: "VERIFIED",
          version: { increment: 1 },
        },
      });

      if (markUpdate.count === 0) {
        throw new Error("STALE_VERSION");
      }

      // 4. Create immutable audit revision event within the active transaction
      await tx.examMarksRevisionEvent.create({
        data: {
          tenantId: ctx.tenant.id,
          examId,
          examSubjectId,
          studentId,
          markId: existingMark.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          oldMarks: existingMark.marksObtained,
          newMarks: newMark,
          oldStatus: existingMark.evaluationStatus,
          newStatus: "VERIFIED",
          reason: `[PUBLISHED CORRECTION] ${reason}`,
        },
      });

      // 5. Recalculate all students' results and ranks with latest marks from tx
      const allMarks = await tx.examMark.findMany({
        where: { examId, tenantId: ctx.tenant.id },
      });

      type StudentCalc = {
        enrollmentId: string;
        studentId: string;
        studentName: string;
        admissionNo: string;
        rollNumber: string | null;
        totalMaxMarks: number;
        totalMarksObtained: number;
        percentage: number;
        passedSubjectsCount: number;
        failedSubjectsCount: number;
        resultStatus: ExamResultStatus;
        grade: string;
        gradePoint: number;
        remarks: string | null;
        subjectBreakdown: Array<{
          subjectId: string;
          subjectName: string;
          subjectCode: string | null;
          maxMarks: number;
          passingMarks: number;
          marksObtained: number | null;
          isAbsent: boolean;
          isExempted: boolean;
          isPassed: boolean;
        }>;
      };

      const studentCalcs: StudentCalc[] = [];

      for (const enrollment of exam.enrollments) {
        if (enrollment.status === "WITHDRAWN") continue;

        const isCandidateExempted = enrollment.status === "EXEMPTED";
        const studentMarks = allMarks.filter((m) => m.studentId === enrollment.studentId);
        const isCandidateAbsent =
          enrollment.status === "ABSENT" ||
          (studentMarks.length > 0 && studentMarks.every((m) => m.isAbsent));

        let studentObtained = 0;
        let studentMaxMarks = 0;
        let passedSubjects = 0;
        let failedSubjects = 0;

        const breakdown = exam.subjects.map((es) => {
          const mark = studentMarks.find((m) => m.examSubjectId === es.id);
          const marksObtained = mark?.marksObtained ?? null;
          const isAbsent = isCandidateAbsent || (mark?.isAbsent ?? false);
          const isExempted = isCandidateExempted || (mark?.isExempted ?? false);

          const numericMark = isAbsent || isExempted || marksObtained === null ? 0 : marksObtained;
          studentObtained += numericMark * es.weightage;

          // Exempted marks cannot silently contribute to ordinary scored totals or denominators
          if (!isExempted) {
            studentMaxMarks += es.maxMarks * es.weightage;
          }

          const isPassed = !isAbsent && (isExempted || (marksObtained !== null && marksObtained >= es.passingMarks));
          if (isPassed) {
            passedSubjects++;
          } else {
            failedSubjects++;
          }

          return {
            subjectId: es.subjectId,
            subjectName: es.subject.name,
            subjectCode: es.subject.code,
            maxMarks: es.maxMarks,
            passingMarks: es.passingMarks,
            marksObtained,
            isAbsent,
            isExempted,
            isPassed,
          };
        });

        let percentage = 0;
        let grade = "N/A";
        let gradePoint = 0;
        let resultStatus: ExamResultStatus = "PASS";
        let remarks: string | null = null;

        if (isCandidateExempted || studentMaxMarks === 0) {
          resultStatus = "WITHHELD";
          grade = "EXM";
          remarks = "Candidate exempted from assessment";
        } else if (isCandidateAbsent) {
          resultStatus = "FAIL";
          percentage = 0;
          remarks = "Candidate absent in all assessments";
          const lowestBand = exam.gradeScale.bands[exam.gradeScale.bands.length - 1];
          if (lowestBand) {
            grade = lowestBand.letterGrade;
            gradePoint = lowestBand.gradePoint;
          }
        } else {
          const rawPercentage = studentMaxMarks > 0 ? (studentObtained / studentMaxMarks) * 100 : 0;
          percentage = Math.round((rawPercentage + Number.EPSILON) * 100) / 100;

          let matchedBand = exam.gradeScale.bands.find(
            (b) => percentage >= b.minPercentage && percentage <= b.maxPercentage
          );
          if (!matchedBand && exam.gradeScale.bands.length > 0) {
            matchedBand =
              percentage > 100
                ? exam.gradeScale.bands[0]
                : exam.gradeScale.bands[exam.gradeScale.bands.length - 1];
          }

          grade = matchedBand ? matchedBand.letterGrade : "N/A";
          gradePoint = matchedBand ? matchedBand.gradePoint : 0;
          resultStatus = failedSubjects === 0 ? "PASS" : "FAIL";
        }

        studentCalcs.push({
          enrollmentId: enrollment.id,
          studentId: enrollment.student.id,
          studentName: `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim(),
          admissionNo: enrollment.student.admissionNo,
          rollNumber: enrollment.rollNumber,
          totalMaxMarks: studentMaxMarks,
          totalMarksObtained: Math.round(studentObtained * 100) / 100,
          percentage,
          passedSubjectsCount: passedSubjects,
          failedSubjectsCount: failedSubjects,
          resultStatus,
          grade,
          gradePoint,
          remarks,
          subjectBreakdown: breakdown,
        });
      }

      studentCalcs.sort((a, b) => b.totalMarksObtained - a.totalMarksObtained);

      let currentRank = 1;
      const rankedStudents = studentCalcs.map((sc, idx) => {
        if (idx > 0 && sc.totalMarksObtained < studentCalcs[idx - 1].totalMarksObtained) {
          currentRank = idx + 1;
        }
        return {
          ...sc,
          rank: sc.resultStatus === "PASS" ? currentRank : null,
        };
      });

      const now = new Date();

      for (const student of rankedStudents) {
        const result = await tx.examResult.upsert({
          where: {
            examId_studentId: {
              examId,
              studentId: student.studentId,
            },
          },
          create: {
            tenantId: ctx.tenant.id,
            examId,
            studentId: student.studentId,
            enrollmentId: student.enrollmentId,
            totalMaxMarks: student.totalMaxMarks,
            totalMarksObtained: student.totalMarksObtained,
            percentage: student.percentage,
            grade: student.grade,
            gradePoint: student.gradePoint,
            rank: student.rank,
            processingStatus: "PUBLISHED",
            resultStatus: student.resultStatus,
            passedSubjectsCount: student.passedSubjectsCount,
            failedSubjectsCount: student.failedSubjectsCount,
            remarks: student.remarks,
            publishedAt: now,
            publishedById: membershipId,
          },
          update: {
            totalMaxMarks: student.totalMaxMarks,
            totalMarksObtained: student.totalMarksObtained,
            percentage: student.percentage,
            grade: student.grade,
            gradePoint: student.gradePoint,
            rank: student.rank,
            processingStatus: "PUBLISHED",
            resultStatus: student.resultStatus,
            passedSubjectsCount: student.passedSubjectsCount,
            failedSubjectsCount: student.failedSubjectsCount,
            remarks: student.remarks,
          },
        });

        // Objective A: Rank cascade snapshot consistency & semantic business payload parity
        // Construct canonical business payload representing complete authoritative report card
        const canonicalBusinessPayload = {
          institute: {
            id: ctx.tenant.id,
            name: ctx.tenant.name,
          },
          exam: {
            id: exam.id,
            title: exam.title,
            code: exam.code,
            examType: exam.examType,
            academicYear: exam.academicYear.name,
          },
          student: {
            id: student.studentId,
            name: student.studentName,
            admissionNo: student.admissionNo,
            rollNumber: student.rollNumber,
          },
          performance: {
            totalMaxMarks: student.totalMaxMarks,
            totalMarksObtained: student.totalMarksObtained,
            percentage: student.percentage,
            grade: student.grade,
            gradePoint: student.gradePoint,
            rank: student.rank,
            resultStatus: student.resultStatus,
            passedSubjectsCount: student.passedSubjectsCount,
            failedSubjectsCount: student.failedSubjectsCount,
          },
          subjects: student.subjectBreakdown,
        };

        const latestSnapshot = await tx.examResultSnapshot.findFirst({
          where: { resultId: result.id },
          orderBy: { version: "desc" },
        });

        const storedData = latestSnapshot?.snapshotData as Record<string, unknown> | undefined;
        const storedBusinessPayload = storedData
          ? {
              institute: storedData.institute,
              exam: storedData.exam,
              student: storedData.student,
              performance: storedData.performance,
              subjects: storedData.subjects,
            }
          : null;

        const isDirectCorrection = student.studentId === studentId;
        const businessPayloadChanged =
          !storedBusinessPayload ||
          canonicalStringify(canonicalBusinessPayload) !== canonicalStringify(storedBusinessPayload);

        // Directly corrected candidate always receives an immutable version for auditability.
        // Cohort peers receive a new immutable version ONLY if their business payload semantically changed.
        const shouldCreateSnapshot = isDirectCorrection || businessPayloadChanged;

        if (shouldCreateSnapshot) {
          const snapshotPayload = {
            ...canonicalBusinessPayload,
            metadata: {
              publishedAt: now.toISOString(),
              publishedBy: ctx.user.name,
              correctionReason: isDirectCorrection
                ? reason
                : `Institutional rank recalculation resulting from mark correction for candidate ${studentId}`,
            },
          };

          const checksum = computeSnapshotChecksum(snapshotPayload);
          const nextVersion = (latestSnapshot?.version ?? 0) + 1;

          await tx.examResultSnapshot.create({
            data: {
              tenantId: ctx.tenant.id,
              examId,
              studentId: student.studentId,
              resultId: result.id,
              version: nextVersion,
              snapshotData: snapshotPayload as unknown as Prisma.InputJsonValue,
              checksum,
              generatedAt: now,
            },
          });
        }
      }

      // 6. Audit logging joins the active transaction atomically via tx
      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "exam.published_mark_corrected",
          entity: "ExamMark",
          entityId: existingMark.id,
          meta: {
            examId,
            examSubjectId,
            studentId,
            oldMarks: existingMark.marksObtained,
            newMark,
            expectedVersion,
            reason,
          },
        },
        tx
      );
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "STALE_VERSION") {
        return {
          ok: false,
          error: "The mark has been modified by another process. Please refresh and try again.",
          code: "STALE_VERSION",
        };
      }
      if (err.message === "RESULT_NOT_FOUND") {
        return {
          ok: false,
          error: "Published result record not found for this candidate.",
          code: "RESULT_NOT_FOUND",
        };
      }
      if (err.message === "EXAM_NOT_FOUND") {
        return {
          ok: false,
          error: "Examination not found or inaccessible.",
          code: "EXAM_NOT_FOUND",
        };
      }
    }
    // Handle Prisma duplicate key violation (e.g. concurrent snapshot conflict)
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return {
        ok: false,
        error: "A concurrent snapshot conflict occurred. Please refresh and try again.",
        code: "CONCURRENT_SNAPSHOT_COLLISION",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to correct published mark.",
    };
  }

  // Operations intentionally executed outside the transaction:
  // Next.js cache revalidations must only run AFTER successful database commit
  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  revalidatePath("/portal");
  return { ok: true, data: { success: true } };
}

export async function exportExamResultsCsvAction(
  examId: string
): Promise<ActionResult<{ filename: string; csvContent: string }>> {
  const ctx = await getTenantContext();
  if (!ctx || !hasTenantPermission(ctx, "tenant.exams.read")) {
    return { ok: false, error: "Unauthorized access" };
  }

  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
    include: {
      academicYear: true,
      subjects: {
        include: { subject: true },
        orderBy: { order: "asc" },
      },
      results: {
        include: {
          student: true,
          enrollment: true,
        },
        orderBy: [{ rank: "asc" }, { percentage: "desc" }],
      },
    },
  });

  if (!exam) return { ok: false, error: "Examination not found." };
  if (!exam.isPublished) {
    return { ok: false, error: "Cannot export results for an unpublished examination." };
  }

  const marks = await db.examMark.findMany({
    where: { examId, tenantId: ctx.tenant.id },
  });

  const escapeCsv = (str: string | number | null | undefined): string => {
    if (str === null || str === undefined) return "";
    let s = String(str);
    // Formula Injection Defense (CSV injection / DDE prevention for =, +, -, @)
    if (/^[=+\-@]/.test(s)) {
      s = `'${s}`;
    }
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = [
    "Rank",
    "Admission No",
    "Student Name",
    "Roll Number",
    ...exam.subjects.map((s) => `${s.subject.name} (${s.maxMarks})`),
    "Total Marks Obtained",
    "Total Max Marks",
    "Percentage",
    "Grade",
    "Grade Point",
    "Result Status",
  ];

  const rows: string[] = [headers.map(escapeCsv).join(",")];

  for (const res of exam.results) {
    const studentMarks = marks.filter((m) => m.studentId === res.studentId);
    const subjectScores = exam.subjects.map((es) => {
      const m = studentMarks.find((sm) => sm.examSubjectId === es.id);
      if (!m) return "N/A";
      if (m.isAbsent) return "ABSENT";
      if (m.isExempted) return "EXEMPTED";
      return m.marksObtained !== null ? m.marksObtained : "N/A";
    });

    const studentName = `${res.student.firstName} ${res.student.lastName}`.trim();
    const row = [
      res.rank ? res.rank : "-",
      res.student.admissionNo,
      studentName,
      res.enrollment.rollNumber || "-",
      ...subjectScores,
      res.totalMarksObtained,
      res.totalMaxMarks,
      `${res.percentage}%`,
      res.grade || "N/A",
      res.gradePoint ?? "-",
      res.resultStatus,
    ];
    rows.push(row.map(escapeCsv).join(","));
  }

  const csvContent = rows.join("\r\n");
  const filename = `exam-results-${exam.code || exam.id}.csv`;

  return { ok: true, data: { filename, csvContent } };
}

export async function verifyResultSnapshotIntegrityAction(
  snapshotId: string
): Promise<ActionResult<{ isValid: boolean; computedChecksum: string; storedChecksum: string }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, error: "Unauthorized access" };

  const snapshot = await db.examResultSnapshot.findFirst({
    where: { id: snapshotId, tenantId: ctx.tenant.id },
  });
  if (!snapshot) return { ok: false, error: "Snapshot not found." };

  const res = verifySnapshotChecksum(snapshot.snapshotData, snapshot.checksum);
  return { ok: true, data: res };
}

// ─────────────────────────────────────────────────────────────
// 6. GRADING SCALE CONFIGURATION
// ─────────────────────────────────────────────────────────────

export async function createGradeScaleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeTenantWrite("tenant.exams.manage_grading", "create");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = createGradeScaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const data = parsed.data;

  // Check unique code in tenant
  const existing = await db.gradeScale.findFirst({
    where: { tenantId: ctx.tenant.id, code: data.code },
  });
  if (existing) {
    return { ok: false, error: `Grade scale code '${data.code}' is already in use.` };
  }

  const created = await db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.gradeScale.updateMany({
        where: { tenantId: ctx.tenant.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const scale = await tx.gradeScale.create({
      data: {
        tenantId: ctx.tenant.id,
        name: data.name,
        code: data.code,
        description: data.description,
        isDefault: data.isDefault,
        bands: {
          create: data.bands.map((b, idx) => ({
            tenantId: ctx.tenant.id,
            letterGrade: b.letterGrade,
            gradePoint: b.gradePoint,
            minPercentage: b.minPercentage,
            maxPercentage: b.maxPercentage,
            isPassing: b.isPassing,
            remarks: b.remarks,
            order: b.order || idx,
          })),
        },
      },
    });

    return scale;
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.grade_scale_created",
    entity: "GradeScale",
    entityId: created.id,
    meta: { name: created.name, code: created.code },
  });

  revalidatePath("/app/exams/grading");
  return { ok: true, data: { id: created.id } };
}

export async function deleteGradeScaleAction(scaleId: string): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.manage_grading", "delete");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const scale = await db.gradeScale.findFirst({
    where: { id: scaleId, tenantId: ctx.tenant.id },
    include: { examinations: { select: { id: true } } },
  });
  if (!scale) return { ok: false, error: "Grading scale not found." };
  if (scale.isSystem) return { ok: false, error: "System grading scales cannot be deleted." };
  if (scale.examinations.length > 0) {
    return { ok: false, error: `Grading scale is used by ${scale.examinations.length} examinations and cannot be deleted.` };
  }

  await db.gradeScale.delete({
    where: { id: scale.id },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.grade_scale_deleted",
    entity: "GradeScale",
    entityId: scale.id,
    meta: { code: scale.code, name: scale.name },
  });

  revalidatePath("/app/exams/grading");
  return { ok: true };
}

export async function getExamCompletenessAction(examId: string): Promise<ActionResult<{
  isValid: boolean;
  expectedPairsCount: number;
  verifiedMarksCount: number;
  eligibleCandidatesCount: number;
  configuredSubjectsCount: number;
  errors: string[];
}>> {
  const ctx = await getTenantContext();
  if (!ctx || !hasTenantPermission(ctx, "tenant.exams.read")) {
    return { ok: false, error: "Unauthorized" };
  }

  const res = await verifyCandidateSubjectCompleteness(db, examId, ctx.tenant.id);
  return { ok: true, data: res };
}
