import { writeAudit } from "@/lib/audit";
import { hasTenantPermission, type TenantContext } from "@/lib/auth";
import type { ExamStatus, Prisma } from "@prisma/client";

export type TransitionResult = {
  ok: boolean;
  code?: "INVALID_TRANSITION" | "STALE_STATUS" | "UNAUTHORIZED" | "INCOMPLETE_EVALUATION" | "INVARIANT_VIOLATION";
  error?: string;
  data?: {
    previousStatus: ExamStatus;
    newStatus: ExamStatus;
    isPublished: boolean;
  };
};

export type TransitionRule = {
  allowed: boolean;
  permission?: string;
  requiresJustification?: boolean;
  description: string;
};

/**
 * Exhaustive 49-cell Exam Lifecycle Transition Matrix.
 * Maps [currentStatus][requestedStatus] to strict institutional transition rules.
 */
export const VALID_EXAM_TRANSITIONS: Record<ExamStatus, Record<ExamStatus, TransitionRule>> = {
  DRAFT: {
    DRAFT: { allowed: true, description: "Same-status metadata update" },
    SCHEDULED: { allowed: true, permission: "tenant.exams.write", description: "Assessment schedule and subjects configured" },
    IN_PROGRESS: { allowed: true, permission: "tenant.exams.enter_marks", description: "Assessment window opened and marks entry started" },
    COMPLETED: { allowed: false, description: "Cannot complete draft without scheduling and conducting assessment" },
    EVALUATED: { allowed: false, description: "Cannot evaluate draft without subject assessments and marks entry" },
    PUBLISHED: { allowed: false, description: "Cannot publish draft without conducting and evaluating assessment" },
    ARCHIVED: { allowed: true, permission: "tenant.exams.write", requiresJustification: true, description: "Cancel draft examination" },
  },
  SCHEDULED: {
    DRAFT: { allowed: true, permission: "tenant.exams.write", description: "Revert to draft to adjust schedule (0 marks entered)" },
    SCHEDULED: { allowed: true, description: "Same-status metadata update" },
    IN_PROGRESS: { allowed: true, permission: "tenant.exams.enter_marks", description: "Commence examination window and marks entry" },
    COMPLETED: { allowed: false, description: "Cannot complete without conducting assessment" },
    EVALUATED: { allowed: false, description: "Cannot jump directly from scheduled to evaluated" },
    PUBLISHED: { allowed: false, description: "Must conduct exam, enter marks, and verify before publishing" },
    ARCHIVED: { allowed: true, permission: "tenant.exams.write", requiresJustification: true, description: "Cancel scheduled examination" },
  },
  IN_PROGRESS: {
    DRAFT: { allowed: false, description: "Illegal rollback: assessment is in progress and candidate marks exist" },
    SCHEDULED: { allowed: false, description: "Illegal rollback: marks entry in progress" },
    IN_PROGRESS: { allowed: true, description: "Same-status metadata update" },
    COMPLETED: { allowed: true, permission: "tenant.exams.write", description: "Assessment period concluded; awaiting evaluation completion" },
    EVALUATED: { allowed: true, permission: "tenant.exams.verify_marks", description: "All candidate-subject marks entered and verified" },
    PUBLISHED: { allowed: false, description: "Must verify all marks and reach EVALUATED before publishing" },
    ARCHIVED: { allowed: true, permission: "tenant.exams.write", requiresJustification: true, description: "Emergency cancellation of in-progress assessment" },
  },
  COMPLETED: {
    DRAFT: { allowed: false, description: "Illegal rollback: examination assessment period has concluded" },
    SCHEDULED: { allowed: false, description: "Illegal rollback: examination assessment period has concluded" },
    IN_PROGRESS: { allowed: true, permission: "tenant.exams.write", requiresJustification: true, description: "Reopen examination assessment window for marks adjustment" },
    COMPLETED: { allowed: true, description: "Same-status metadata update" },
    EVALUATED: { allowed: true, permission: "tenant.exams.verify_marks", description: "All candidate-subject marks verified" },
    PUBLISHED: { allowed: false, description: "Must verify all marks and reach EVALUATED before publishing" },
    ARCHIVED: { allowed: true, permission: "tenant.exams.write", requiresJustification: true, description: "Cancel completed assessment prior to evaluation" },
  },
  EVALUATED: {
    DRAFT: { allowed: false, description: "Illegal rollback from evaluated status" },
    SCHEDULED: { allowed: false, description: "Illegal rollback from evaluated status" },
    IN_PROGRESS: { allowed: true, permission: "tenant.exams.manage_grading", requiresJustification: true, description: "Reopen evaluated exam to correct or un-verify marks" },
    COMPLETED: { allowed: false, description: "Evaluated supersedes completed; use reopen to IN_PROGRESS" },
    EVALUATED: { allowed: true, description: "Same-status metadata update" },
    PUBLISHED: { allowed: true, permission: "tenant.exams.publish_results", description: "Calculate results, generate immutable snapshots, and publish" },
    ARCHIVED: { allowed: false, description: "Evaluated exam must be published or reopened to IN_PROGRESS" },
  },
  PUBLISHED: {
    DRAFT: { allowed: false, description: "Published report cards cannot be reverted to draft" },
    SCHEDULED: { allowed: false, description: "Published report cards cannot be reverted to scheduled" },
    IN_PROGRESS: { allowed: false, description: "Published exam cannot be reopened; use correctPublishedMarkAction" },
    COMPLETED: { allowed: false, description: "Published exam cannot be reverted to completed" },
    EVALUATED: { allowed: false, description: "Published exam cannot be reverted to evaluated" },
    PUBLISHED: { allowed: true, description: "Same-status metadata update; isPublished remains true" },
    ARCHIVED: { allowed: true, permission: "tenant.exams.write", description: "Archive published examination at term conclusion (preserves published results)" },
  },
  ARCHIVED: {
    DRAFT: { allowed: false, description: "Archived examination is terminal and immutable" },
    SCHEDULED: { allowed: false, description: "Archived examination is terminal and immutable" },
    IN_PROGRESS: { allowed: false, description: "Archived examination is terminal and immutable" },
    COMPLETED: { allowed: false, description: "Archived examination is terminal and immutable" },
    EVALUATED: { allowed: false, description: "Archived examination is terminal and immutable" },
    PUBLISHED: { allowed: false, description: "Archived examination is terminal and immutable" },
    ARCHIVED: { allowed: true, description: "Repeated archive request is a safe no-op" },
  },
};

/**
 * Validates whether an examination transition from currentStatus to requestedStatus is permitted.
 */
export function assertExamTransition(
  currentStatus: ExamStatus,
  requestedStatus: ExamStatus,
  ctx: TenantContext,
  reason?: string
): { allowed: boolean; code?: TransitionResult["code"]; error?: string; rule: TransitionRule } {
  const currentRules = VALID_EXAM_TRANSITIONS[currentStatus];
  if (!currentRules) {
    return {
      allowed: false,
      code: "INVALID_TRANSITION",
      error: `Unknown current examination status: '${currentStatus}'.`,
      rule: { allowed: false, description: "Unknown status" },
    };
  }

  const rule = currentRules[requestedStatus];
  if (!rule || !rule.allowed) {
    return {
      allowed: false,
      code: "INVALID_TRANSITION",
      error: `Illegal lifecycle transition: cannot move examination from '${currentStatus}' to '${requestedStatus}'. ${rule?.description || ""}`.trim(),
      rule: rule || { allowed: false, description: "Forbidden transition" },
    };
  }

  // Same-status update is a safe no-op for lifecycle purposes
  if (currentStatus === requestedStatus) {
    return { allowed: true, rule };
  }

  // Permission check
  if (rule.permission && !hasTenantPermission(ctx, rule.permission)) {
    return {
      allowed: false,
      code: "UNAUTHORIZED",
      error: `Missing required permission '${rule.permission}' to transition examination from '${currentStatus}' to '${requestedStatus}'.`,
      rule,
    };
  }

  // Justification requirement check
  if (rule.requiresJustification) {
    if (!reason || reason.trim().length < 10) {
      return {
        allowed: false,
        code: "INVALID_TRANSITION",
        error: `A detailed justification of at least 10 characters is required to transition from '${currentStatus}' to '${requestedStatus}'.`,
        rule,
      };
    }
  }

  return { allowed: true, rule };
}

export type LockedExamination = {
  id: string;
  status: ExamStatus;
  isPublished: boolean;
  publishedAt: Date | null;
  gradeScaleId: string;
  syllabusTrackId: string | null;
  title: string;
  term: string | null;
  instructions: string | null;
  startDate: Date;
  endDate: Date;
};

/**
 * Acquires the authoritative row-level lock on the Examination record inside a transaction.
 * Always run as step 1 of any operation mutating the examination aggregate.
 */
export async function lockExaminationRow(
  tx: Prisma.TransactionClient,
  examId: string,
  tenantId: string
): Promise<LockedExamination | null> {
  const locked = await tx.$queryRaw<LockedExamination[]>`
    SELECT id, status, "isPublished", "publishedAt", "gradeScaleId", "syllabusTrackId", title, term, instructions, "startDate", "endDate"
    FROM "Examination"
    WHERE id = ${examId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;

  if (!locked || locked.length === 0) {
    return null;
  }

  return locked[0];
}

export type CandidateSubjectCompletenessResult = {
  isValid: boolean;
  expectedPairsCount: number;
  verifiedMarksCount: number;
  eligibleCandidatesCount: number;
  configuredSubjectsCount: number;
  errors: string[];
};

/**
 * Strictly verifies the Cartesian completeness of eligible enrolled candidates and required subjects.
 * For each pair (candidate, subject), exactly one valid, verified ExamMark record must exist.
 * Missing marks NEVER silently default to zero.
 */
export async function verifyCandidateSubjectCompleteness(
  tx: Prisma.TransactionClient,
  examId: string,
  tenantId: string
): Promise<CandidateSubjectCompletenessResult> {
  // 1. Fetch all configured subjects
  const subjects = await tx.examSubject.findMany({
    where: { examId, tenantId },
    select: { id: true, subjectId: true, maxMarks: true, subject: { select: { name: true, code: true } } },
    orderBy: { order: "asc" },
  });

  // 2. Fetch all eligible enrolled candidates (WITHDRAWN candidates are explicitly excluded)
  const enrollments = await tx.examEnrollment.findMany({
    where: {
      examId,
      tenantId,
      status: { in: ["REGISTERED", "ELIGIBLE", "ABSENT", "EXEMPTED"] },
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      student: { select: { firstName: true, lastName: true, admissionNo: true } },
    },
  });

  const errors: string[] = [];

  if (subjects.length === 0) {
    errors.push("Examination has no configured assessment subjects.");
  }
  if (enrollments.length === 0) {
    errors.push("Examination has no active eligible candidates enrolled.");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      expectedPairsCount: 0,
      verifiedMarksCount: 0,
      eligibleCandidatesCount: enrollments.length,
      configuredSubjectsCount: subjects.length,
      errors,
    };
  }

  // 3. Query all existing marks for this examination
  const marks = await tx.examMark.findMany({
    where: { examId, tenantId },
    select: {
      id: true,
      studentId: true,
      examSubjectId: true,
      marksObtained: true,
      isAbsent: true,
      isExempted: true,
      evaluationStatus: true,
    },
  });

  // Map existing marks by composite key `${studentId}:${examSubjectId}`
  const markMap = new Map<string, typeof marks>();
  for (const m of marks) {
    const key = `${m.studentId}:${m.examSubjectId}`;
    const list = markMap.get(key) || [];
    list.push(m);
    markMap.set(key, list);
  }

  let verifiedCount = 0;
  const expectedPairsCount = enrollments.length * subjects.length;

  for (const enr of enrollments) {
    const candName = `${enr.student.firstName} ${enr.student.lastName}`.trim();
    for (const sub of subjects) {
      const key = `${enr.studentId}:${sub.id}`;
      const candidateMarks = markMap.get(key) || [];

      if (candidateMarks.length === 0) {
        errors.push(
          `Missing mark record: Candidate '${candName}' (${enr.student.admissionNo}) has no evaluation entry for subject '${sub.subject.name}'. Missing marks cannot silently default to zero.`
        );
        continue;
      }

      if (candidateMarks.length > 1) {
        errors.push(
          `Integrity defect: Candidate '${candName}' (${enr.student.admissionNo}) has duplicate evaluation records (${candidateMarks.length}) for subject '${sub.subject.name}'.`
        );
        continue;
      }

      const mark = candidateMarks[0];

      // Mark must be VERIFIED
      if (mark.evaluationStatus !== "VERIFIED") {
        errors.push(
          `Unverified mark: Candidate '${candName}' (${enr.student.admissionNo}) in subject '${sub.subject.name}' has status '${mark.evaluationStatus}' (must be VERIFIED).`
        );
        continue;
      }

      // Check conflicting absent and exempted flags
      if (mark.isAbsent && mark.isExempted) {
        errors.push(
          `Malformed mark: Candidate '${candName}' in subject '${sub.subject.name}' cannot be both ABSENT and EXEMPTED simultaneously.`
        );
        continue;
      }

      // Check valid score range if numeric
      if (!mark.isAbsent && !mark.isExempted) {
        if (mark.marksObtained === null || typeof mark.marksObtained !== "number" || isNaN(mark.marksObtained)) {
          errors.push(
            `Malformed mark: Candidate '${candName}' in subject '${sub.subject.name}' has null numeric marks without being flagged ABSENT or EXEMPTED.`
          );
          continue;
        }
        if (mark.marksObtained < 0 || mark.marksObtained > sub.maxMarks) {
          errors.push(
            `Invalid score bounds: Candidate '${candName}' in subject '${sub.subject.name}' has score ${mark.marksObtained}, which violates bounds [0, ${sub.maxMarks}].`
          );
          continue;
        }
      } else {
        if (mark.marksObtained !== null) {
          errors.push(
            `Malformed mark: Candidate '${candName}' in subject '${sub.subject.name}' cannot have numeric marks (${mark.marksObtained}) while flagged ${mark.isAbsent ? "ABSENT" : "EXEMPTED"}.`
          );
          continue;
        }
      }

      verifiedCount++;
    }
  }

  return {
    isValid: errors.length === 0,
    expectedPairsCount,
    verifiedMarksCount: verifiedCount,
    eligibleCandidatesCount: enrollments.length,
    configuredSubjectsCount: subjects.length,
    errors,
  };
}

/**
 * Central transactional state transition executor with pessimistic row-locking and publication consistency.
 */
export async function transitionExamStatus(
  tx: Prisma.TransactionClient,
  examId: string,
  ctx: TenantContext,
  requestedStatus: ExamStatus,
  options?: {
    reason?: string;
    expectedCurrentStatus?: ExamStatus;
    skipCompletenessCheck?: boolean;
  }
): Promise<TransitionResult> {
  // 1. Acquire Examination FOR UPDATE lock
  const lockedExam = await lockExaminationRow(tx, examId, ctx.tenant.id);
  if (!lockedExam) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      error: "Examination not found.",
    };
  }

  // 2. Optimistic concurrency pre-check if caller specified expectedCurrentStatus
  if (options?.expectedCurrentStatus && lockedExam.status !== options.expectedCurrentStatus) {
    return {
      ok: false,
      code: "STALE_STATUS",
      error: `Examination status was concurrently modified from '${options.expectedCurrentStatus}' to '${lockedExam.status}'. Please refresh the view.`,
    };
  }

  // 3. Same-status request: safe no-op
  if (lockedExam.status === requestedStatus) {
    return {
      ok: true,
      data: {
        previousStatus: lockedExam.status,
        newStatus: requestedStatus,
        isPublished: lockedExam.isPublished,
      },
    };
  }

  // 4. Assert transition validity
  const transitionCheck = assertExamTransition(lockedExam.status, requestedStatus, ctx, options?.reason);
  if (!transitionCheck.allowed) {
    return {
      ok: false,
      code: transitionCheck.code,
      error: transitionCheck.error,
    };
  }

  // 5. Enforce prerequisites based on target status
  if (requestedStatus === "EVALUATED" && !options?.skipCompletenessCheck) {
    const completeness = await verifyCandidateSubjectCompleteness(tx, examId, ctx.tenant.id);
    if (!completeness.isValid) {
      return {
        ok: false,
        code: "INCOMPLETE_EVALUATION",
        error: `Cannot transition examination to EVALUATED: ${completeness.errors[0]} (${completeness.verifiedMarksCount}/${completeness.expectedPairsCount} verified).`,
      };
    }
  }

  if (requestedStatus === "PUBLISHED") {
    if (lockedExam.status !== "EVALUATED") {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        error: `Cannot publish examination: current status is '${lockedExam.status}'. Examination must be in EVALUATED status with all marks locked and verified.`,
      };
    }
    const completeness = await verifyCandidateSubjectCompleteness(tx, examId, ctx.tenant.id);
    if (!completeness.isValid) {
      return {
        ok: false,
        code: "INCOMPLETE_EVALUATION",
        error: `Cannot publish examination: ${completeness.errors[0]}`,
      };
    }
  }

  // 6. Compute new publication flags
  let newIsPublished = lockedExam.isPublished;
  let newPublishedAt = lockedExam.publishedAt;

  if (requestedStatus === "PUBLISHED") {
    newIsPublished = true;
    newPublishedAt = lockedExam.publishedAt || new Date();
  } else if (requestedStatus === "ARCHIVED") {
    // Preserve original isPublished and publishedAt if previously published
    newIsPublished = lockedExam.isPublished;
    newPublishedAt = lockedExam.publishedAt;
  } else {
    // Pre-publication statuses MUST have isPublished = false
    newIsPublished = false;
    newPublishedAt = null;
  }

  // 7. Update Examination row atomically
  await tx.examination.update({
    where: { id: examId },
    data: {
      status: requestedStatus,
      isPublished: newIsPublished,
      publishedAt: newPublishedAt,
    },
  });

  // 8. If reopening an EVALUATED exam to IN_PROGRESS, unlock marks so teachers can adjust scores
  if (lockedExam.status === "EVALUATED" && requestedStatus === "IN_PROGRESS") {
    await tx.examMark.updateMany({
      where: { examId, tenantId: ctx.tenant.id },
      data: {
        evaluationStatus: "SUBMITTED",
      },
    });
  }

  // 9. Write audit record atomically inside the transaction
  await writeAudit(
    {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: requestedStatus === "ARCHIVED" ? "exam.archived" : "exam.status_transition",
      entity: "Examination",
      entityId: examId,
      meta: {
        previousStatus: lockedExam.status,
        newStatus: requestedStatus,
        isPublished: newIsPublished,
        reason: options?.reason || transitionCheck.rule.description,
      },
    },
    tx
  );

  return {
    ok: true,
    data: {
      previousStatus: lockedExam.status,
      newStatus: requestedStatus,
      isPublished: newIsPublished,
    },
  };
}
