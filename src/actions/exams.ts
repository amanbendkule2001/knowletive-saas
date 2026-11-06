"use server";

import crypto from "node:crypto";
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
} from "@/lib/exams-schema";
import { computeSnapshotChecksum, verifySnapshotChecksum } from "@/lib/exam-snapshot";
import type {
  ExamStatus,
  ExamTargetType,
  ExamEnrollmentStatus,
  ExamEvaluationStatus,
  ExamResultStatus,
  Prisma,
} from "@prisma/client";

export type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
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
  const exam = await db.examination.findFirst({
    where: { id: data.id, tenantId: ctx.tenant.id },
  });
  if (!exam) return { ok: false, error: "Examination not found." };

  if (exam.status === "PUBLISHED" && data.status && data.status !== "PUBLISHED") {
    return { ok: false, error: "Published examination results cannot change status directly." };
  }

  await db.examination.update({
    where: { id: exam.id },
    data: {
      title: data.title,
      term: data.term,
      instructions: data.instructions,
      status: (data.status as ExamStatus) ?? exam.status,
      gradeScaleId: data.gradeScaleId ?? exam.gradeScaleId,
      syllabusTrackId: data.syllabusTrackId !== undefined ? data.syllabusTrackId : exam.syllabusTrackId,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.updated",
    entity: "Examination",
    entityId: exam.id,
    meta: { title: data.title },
  });

  revalidatePath(`/app/exams/${exam.id}`);
  revalidatePath("/app/exams");
  return { ok: true };
}

export async function deleteExaminationAction(examId: string): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.write", "delete");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
  });
  if (!exam) return { ok: false, error: "Examination not found." };

  if (exam.isPublished || exam.status === "PUBLISHED") {
    return { ok: false, error: "Published examinations cannot be deleted. Unpublish or archive instead." };
  }

  await db.examination.delete({
    where: { id: exam.id },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.deleted",
    entity: "Examination",
    entityId: exam.id,
    meta: { code: exam.code, title: exam.title },
  });

  revalidatePath("/app/exams");
  return { ok: true };
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
  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
  });
  if (!exam) return { ok: false, error: "Examination not found." };
  if (exam.isPublished) return { ok: false, error: "Cannot modify subjects of a published exam." };

  // Validate that all subject IDs belong to the tenant
  const subjectIds = subjects.map((s) => s.subjectId);
  const existingSubjects = await db.subject.findMany({
    where: { id: { in: subjectIds }, tenantId: ctx.tenant.id },
  });
  if (existingSubjects.length !== subjectIds.length) {
    return { ok: false, error: "One or more selected subjects do not exist in this institute." };
  }

  await db.$transaction(async (tx) => {
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

    // If exam is in DRAFT status, move to SCHEDULED
    if (exam.status === "DRAFT") {
      await tx.examination.update({
        where: { id: exam.id },
        data: { status: "SCHEDULED" },
      });
    }
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.subjects_configured",
    entity: "Examination",
    entityId: exam.id,
    meta: { subjectCount: subjects.length },
  });

  revalidatePath(`/app/exams/${examId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 3. STUDENT ENROLLMENT & PARTICIPATION
// ─────────────────────────────────────────────────────────────

export async function autoEnrollEligibleStudentsAction(examId: string): Promise<ActionResult<{ enrolledCount: number }>> {
  const auth = await authorizeTenantWrite("tenant.exams.enroll", "create");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
  });
  if (!exam) return { ok: false, error: "Examination not found." };
  if (exam.isPublished) return { ok: false, error: "Cannot enroll students in a published exam." };

  let eligibleStudentIds: string[] = [];

  if (exam.targetType === "CLASS_SECTION") {
    if (exam.sectionId) {
      const students = await db.student.findMany({
        where: { tenantId: ctx.tenant.id, sectionId: exam.sectionId, status: "ACTIVE" },
        select: { id: true },
      });
      eligibleStudentIds = students.map((s) => s.id);
    } else if (exam.classId) {
      const students = await db.student.findMany({
        where: { tenantId: ctx.tenant.id, classId: exam.classId, status: "ACTIVE" },
        select: { id: true },
      });
      eligibleStudentIds = students.map((s) => s.id);
    }
  } else if (exam.targetType === "BATCH" && exam.batchId) {
    const enrollments = await db.batchStudent.findMany({
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
    const existing = await db.examEnrollment.findUnique({
      where: {
        examId_studentId: { examId, studentId },
      },
    });
    if (!existing) {
      await db.examEnrollment.create({
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

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.auto_enrolled_students",
    entity: "Examination",
    entityId: exam.id,
    meta: { createdCount, totalEligible: eligibleStudentIds.length },
  });

  revalidatePath(`/app/exams/${examId}`);
  return { ok: true, data: { enrolledCount: createdCount } };
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
  const exam = await db.examination.findFirst({
    where: { id: examId, tenantId: ctx.tenant.id },
    include: { batch: true, class: true, section: true },
  });
  if (!exam) return { ok: false, error: "Examination not found." };
  if (exam.isPublished) return { ok: false, error: "Cannot enroll students in a published exam." };

  // Phase 2 & 3: Validate candidate eligibility against target academic unit
  if (exam.targetType === "BATCH" && exam.batchId) {
    const activeBatchStudents = await db.batchStudent.findMany({
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
    const classStudents = await db.student.findMany({
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
    const existing = await db.examEnrollment.findUnique({
      where: {
        examId_studentId: { examId, studentId },
      },
    });
    if (!existing) {
      await db.examEnrollment.create({
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

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.students_enrolled",
    entity: "Examination",
    entityId: exam.id,
    meta: { enrolledCount: createdCount },
  });

  revalidatePath(`/app/exams/${examId}`);
  return { ok: true, data: { enrolledCount: createdCount } };
}

export async function updateEnrollmentStatusAction(input: unknown): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.enroll", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateEnrollmentStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Validation failed" };
  }

  const { enrollmentId, status, remarks } = parsed.data;
  const enrollment = await db.examEnrollment.findFirst({
    where: { id: enrollmentId, tenantId: ctx.tenant.id },
    include: { exam: true },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found." };
  if (enrollment.exam.isPublished) return { ok: false, error: "Cannot modify enrollment of a published exam." };

  await db.examEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: status as ExamEnrollmentStatus,
      remarks,
    },
  });

  revalidatePath(`/app/exams/${enrollment.examId}`);
  return { ok: true };
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

  const [exam, examSubject] = await Promise.all([
    db.examination.findFirst({
      where: { id: examId, tenantId: ctx.tenant.id },
    }),
    db.examSubject.findFirst({
      where: { id: examSubjectId, examId, tenantId: ctx.tenant.id },
      include: { subject: true },
    }),
  ]);

  if (!exam) return { ok: false, error: "Examination not found." };
  if (!examSubject) return { ok: false, error: "Subject assessment not found for this examination." };
  if (exam.status === "ARCHIVED") {
    return { ok: false, error: "Cannot modify marks for an archived examination." };
  }
  if (exam.isPublished || exam.status === "PUBLISHED") {
    return {
      ok: false,
      error: "Cannot modify marks for a published examination. Use the authorized mark correction workflow.",
    };
  }

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  const membershipId = membership?.id || null;

  // Phase 12: Teacher Subject Assignment Authorization Check
  if (ctx.membership?.roleKey === "TEACHER" && membership) {
    let isAssigned = false;
    if (exam.targetType === "BATCH" && exam.batchId) {
      const bt = await db.batchTeacher.findUnique({
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

  const targetStatus: ExamEvaluationStatus = submitForVerification ? "SUBMITTED" : "DRAFT";

  let updatedCount = 0;

  await db.$transaction(async (tx) => {
    for (const entry of entries) {
      // Find enrollment
      const enrollment = await tx.examEnrollment.findUnique({
        where: { examId_studentId: { examId, studentId: entry.studentId } },
      });

      if (!enrollment) continue;

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

        const isChanged =
          existingMark.marksObtained !== effectiveMarks ||
          existingMark.isAbsent !== entry.isAbsent ||
          existingMark.isExempted !== entry.isExempted ||
          existingMark.evaluationStatus !== targetStatus;

        if (isChanged) {
          // Record auditable revision event
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

          const updateRes = await tx.examMark.updateMany({
            where: { id: existingMark.id, version: existingMark.version },
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
            throw new Error(`Concurrent modification detected for candidate ${entry.studentId}. Please reload.`);
          }
          updatedCount++;
        }
      } else {
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

    // Advance exam status to IN_PROGRESS if SCHEDULED
    if (exam.status === "SCHEDULED" || exam.status === "DRAFT") {
      await tx.examination.update({
        where: { id: exam.id },
        data: { status: "IN_PROGRESS" },
      });
    }
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.marks_entered",
    entity: "ExamSubject",
    entityId: examSubjectId,
    meta: { updatedCount, submitForVerification, reason },
  });

  revalidatePath(`/app/exams/${examId}`);
  return { ok: true, data: { updatedCount } };
}

export async function verifyExamSubjectMarksAction(examId: string, examSubjectId: string): Promise<ActionResult> {
  const auth = await authorizeTenantWrite("tenant.exams.verify_marks", "update");
  if (!auth.ok) return { ok: false, error: auth.error };
  const ctx = auth.ctx;

  const [exam, examSubject] = await Promise.all([
    db.examination.findFirst({
      where: { id: examId, tenantId: ctx.tenant.id },
      include: { subjects: true },
    }),
    db.examSubject.findFirst({
      where: { id: examSubjectId, examId, tenantId: ctx.tenant.id },
    }),
  ]);

  if (!exam) return { ok: false, error: "Examination not found." };
  if (!examSubject) return { ok: false, error: "Subject assessment not found." };
  if (exam.isPublished) return { ok: false, error: "Examination is already published." };

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  const membershipId = membership?.id || null;

  await db.$transaction(async (tx) => {
    // Lock all marks for this subject to VERIFIED
    await tx.examMark.updateMany({
      where: { examSubjectId, tenantId: ctx.tenant.id },
      data: {
        evaluationStatus: "VERIFIED",
        verifiedById: membershipId,
        verifiedAt: new Date(),
      },
    });

    // Check if ALL subjects of this exam are now verified
    const allMarks = await tx.examMark.findMany({
      where: { examId, tenantId: ctx.tenant.id },
      select: { evaluationStatus: true },
    });

    const hasUnverified = allMarks.some((m) => m.evaluationStatus !== "VERIFIED");
    if (!hasUnverified && allMarks.length > 0) {
      await tx.examination.update({
        where: { id: exam.id },
        data: { status: "EVALUATED" },
      });
    }
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.marks_verified",
    entity: "ExamSubject",
    entityId: examSubjectId,
    meta: { examId },
  });

  revalidatePath(`/app/exams/${examId}`);
  return { ok: true };
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
  if (exam.subjects.length === 0) return { ok: false, error: "Cannot publish an examination with no subjects." };
  if (exam.enrollments.length === 0) return { ok: false, error: "Cannot publish an examination with no enrolled students." };

  // Phase 1 & 8: Verify that all candidate marks for all subjects have been verified
  const unverifiedMarks = await db.examMark.findMany({
    where: {
      examId,
      tenantId: ctx.tenant.id,
      evaluationStatus: { not: "VERIFIED" },
    },
    select: { id: true },
  });
  if (unverifiedMarks.length > 0) {
    return {
      ok: false,
      error: `Cannot publish results: ${unverifiedMarks.length} candidate mark entries have not been verified and locked.`,
    };
  }

  // Calculate total maximum marks possible across all subjects
  const totalMaxMarks = exam.subjects.reduce((sum, s) => sum + s.maxMarks * s.weightage, 0);

  // Intermediate computation container for students
  type StudentCalc = {
    enrollmentId: string;
    studentId: string;
    studentName: string;
    admissionNo: string;
    rollNumber: string | null;
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
    // Phase 4 & 8: Withdrawn candidates do not receive calculated published results
    if (enrollment.status === "WITHDRAWN") {
      continue;
    }

    const isCandidateExempted = enrollment.status === "EXEMPTED";
    const isCandidateAbsent =
      enrollment.status === "ABSENT" ||
      (enrollment.marks.length > 0 && enrollment.marks.every((m) => m.isAbsent));

    let studentObtained = 0;
    let passedSubjects = 0;
    let failedSubjects = 0;

    const breakdown = exam.subjects.map((es) => {
      const mark = enrollment.marks.find((m) => m.examSubjectId === es.id);
      const marksObtained = mark?.marksObtained ?? null;
      const isAbsent = isCandidateAbsent || (mark?.isAbsent ?? false);
      const isExempted = isCandidateExempted || (mark?.isExempted ?? false);

      const numericMark = isAbsent || isExempted || marksObtained === null ? 0 : marksObtained;
      studentObtained += numericMark * es.weightage;

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

    if (isCandidateExempted) {
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
      const rawPercentage = totalMaxMarks > 0 ? (studentObtained / totalMaxMarks) * 100 : 0;
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
  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  const membershipId = membership?.id || null;

  await db.$transaction(async (tx) => {
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
          totalMaxMarks,
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
          totalMaxMarks,
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
          totalMaxMarks,
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

      // Check if snapshot exists
      const existingSnapshot = await tx.examResultSnapshot.findUnique({
        where: { resultId: result.id },
      });

      if (!existingSnapshot) {
        await tx.examResultSnapshot.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            studentId: student.studentId,
            resultId: result.id,
            snapshotData: snapshotPayload as unknown as Prisma.InputJsonValue,
            checksum,
            generatedAt: publishedAt,
          },
        });
      }
    }

    // Mark Examination as Published
    await tx.examination.update({
      where: { id: exam.id },
      data: {
        status: "PUBLISHED",
        isPublished: true,
        publishedAt,
      },
    });
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "exam.results_published",
    entity: "Examination",
    entityId: exam.id,
    meta: { studentCount: rankedStudents.length, publishedAt: publishedAt.toISOString() },
  });

  revalidatePath(`/app/exams/${examId}`);
  revalidatePath("/app/exams");
  return { ok: true, data: { publishedCount: rankedStudents.length } };
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

  const { examId, examSubjectId, studentId, newMark, reason } = parsed.data;

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

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  const membershipId = membership?.id || null;

  await db.$transaction(async (tx) => {
    // 1. Create immutable audit revision event
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

    // 2. Update ExamMark with incremented version
    await tx.examMark.update({
      where: { id: existingMark.id },
      data: {
        marksObtained: newMark,
        isAbsent: false,
        isExempted: false,
        evaluationStatus: "VERIFIED",
        version: { increment: 1 },
      },
    });

    // 3. Recalculate all students' results and ranks
    const totalMaxMarks = exam.subjects.reduce((sum, s) => sum + s.maxMarks * s.weightage, 0);

    const allMarks = await tx.examMark.findMany({
      where: { examId, tenantId: ctx.tenant.id },
    });

    type StudentCalc = {
      enrollmentId: string;
      studentId: string;
      studentName: string;
      admissionNo: string;
      rollNumber: string | null;
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
      let passedSubjects = 0;
      let failedSubjects = 0;

      const breakdown = exam.subjects.map((es) => {
        const mark = studentMarks.find((m) => m.examSubjectId === es.id);
        const marksObtained = mark?.marksObtained ?? null;
        const isAbsent = isCandidateAbsent || (mark?.isAbsent ?? false);
        const isExempted = isCandidateExempted || (mark?.isExempted ?? false);

        const numericMark = isAbsent || isExempted || marksObtained === null ? 0 : marksObtained;
        studentObtained += numericMark * es.weightage;

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

      if (isCandidateExempted) {
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
        const rawPercentage = totalMaxMarks > 0 ? (studentObtained / totalMaxMarks) * 100 : 0;
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
          totalMaxMarks,
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
          totalMaxMarks,
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

      if (student.studentId === studentId) {
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
            totalMaxMarks,
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
            publishedAt: now.toISOString(),
            publishedBy: ctx.user.name,
            correctionReason: reason,
          },
        };

        const checksum = computeSnapshotChecksum(snapshotPayload);

        await tx.examResultSnapshot.create({
          data: {
            tenantId: ctx.tenant.id,
            examId,
            studentId: student.studentId,
            resultId: result.id,
            snapshotData: snapshotPayload as unknown as Prisma.InputJsonValue,
            checksum,
            generatedAt: now,
          },
        });
      }
    }
  });

  await writeAudit({
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
      reason,
    },
  });

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
