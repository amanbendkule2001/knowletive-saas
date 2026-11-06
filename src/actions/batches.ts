"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, type FormState } from "@/lib/validation";
import {
  createBatchSchema,
  updateBatchSchema,
  enrollStudentsSchema,
  dropStudentSchema,
  transferStudentSchema,
} from "@/lib/batches-schema";
import type { BatchStatus } from "@prisma/client";

function toDate(val: unknown): Date | null {
  if (!val || typeof val !== "string") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export async function createBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.batches.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const rawTeacherIds = formData.getAll("teacherIds").map(String).filter(Boolean);

  const parsed = createBatchSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    academicYearId: formData.get("academicYearId"),
    subjectId: formData.get("subjectId") || null,
    capacity: formData.get("capacity") || 30,
    status: (formData.get("status") as BatchStatus) || "ACTIVE",
    startDate: formData.get("startDate") || null,
    endDate: formData.get("endDate") || null,
    schedule: formData.get("schedule") || null,
    description: formData.get("description") || null,
    teacherIds: rawTeacherIds,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // 1. Verify academic year belongs to this tenant and is valid
  const academicYear = await db.academicYear.findFirst({
    where: { id: data.academicYearId, tenantId: ctx.tenant.id },
    select: { id: true },
  });
  if (!academicYear) {
    return { error: "Selected academic year does not belong to this institute." };
  }

  // 2. Verify subject belongs to this tenant if provided
  if (data.subjectId) {
    const subject = await db.subject.findFirst({
      where: { id: data.subjectId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!subject) {
      return { error: "Selected subject does not belong to this institute." };
    }
  }

  // 3. Check unique code per tenant
  const existingCode = await db.batch.findUnique({
    where: { tenantId_code: { tenantId: ctx.tenant.id, code: data.code } },
    select: { id: true },
  });
  if (existingCode) {
    return { error: `Batch code '${data.code}' is already in use in this institute.` };
  }

  // 4. Verify teachers belong to this tenant and have authorized teaching/management role
  let validTeacherIds: string[] = [];
  if (data.teacherIds && data.teacherIds.length > 0) {
    const uniqueTeacherIds = Array.from(new Set(data.teacherIds));
    const teachers = await db.membership.findMany({
      where: {
        id: { in: uniqueTeacherIds },
        tenantId: ctx.tenant.id,
        status: "ACTIVE",
        role: { key: { in: ["TEACHER", "PRINCIPAL", "INSTITUTE_ADMIN"] } },
      },
      select: { id: true },
    });
    if (teachers.length !== uniqueTeacherIds.length) {
      return { error: "One or more selected teachers are invalid, inactive, or not authorized for teaching roles." };
    }
    validTeacherIds = teachers.map((t) => t.id);
  }

  let createdBatchId: string;

  try {
    const batch = await db.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          tenantId: ctx.tenant.id,
          academicYearId: data.academicYearId,
          subjectId: data.subjectId || null,
          name: data.name,
          code: data.code,
          capacity: data.capacity,
          status: data.status,
          startDate: toDate(data.startDate),
          endDate: toDate(data.endDate),
          schedule: data.schedule || null,
          description: data.description || null,
          teachers: {
            create: validTeacherIds.map((tid, idx) => ({
              teacherId: tid,
              isPrimary: idx === 0,
            })),
          },
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.create",
          entity: "Batch",
          entityId: b.id,
          meta: { name: b.name, code: b.code, capacity: b.capacity },
        },
        tx
      );

      return b;
    });

    createdBatchId = batch.id;
  } catch (error) {
    console.error("[createBatchAction] error:", error);
    return { error: "Failed to create batch. Please check inputs and try again." };
  }

  revalidatePath("/app/batches");
  redirect(`/app/batches/${createdBatchId}`);
}

export async function updateBatchAction(batchId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.batches.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateBatchSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    academicYearId: formData.get("academicYearId"),
    subjectId: formData.get("subjectId") || null,
    capacity: formData.get("capacity"),
    status: formData.get("status") as BatchStatus,
    startDate: formData.get("startDate") || null,
    endDate: formData.get("endDate") || null,
    schedule: formData.get("schedule") || null,
    description: formData.get("description") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // Verify academic year & subject ownership
  const academicYear = await db.academicYear.findFirst({
    where: { id: data.academicYearId, tenantId: ctx.tenant.id },
    select: { id: true },
  });
  if (!academicYear) {
    return { error: "Selected academic year does not belong to this institute." };
  }

  if (data.subjectId) {
    const subject = await db.subject.findFirst({
      where: { id: data.subjectId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!subject) {
      return { error: "Selected subject does not belong to this institute." };
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // 1. Pessimistic lock on Batch row to serialize capacity adjustments
      const lockedBatches = await tx.$queryRaw<Array<{ id: string; code: string; capacity: number }>>`
        SELECT id, code, capacity
        FROM "Batch"
        WHERE id = ${batchId} AND "tenantId" = ${ctx.tenant.id}
        FOR UPDATE
      `;
      const existingBatch = lockedBatches[0];
      if (!existingBatch) {
        throw new Error("Batch not found or access denied.");
      }

      // 2. Capacity reduction check: Cannot reduce below current active students under row lock
      const activeCount = await tx.batchStudent.count({
        where: { batchId, status: "ACTIVE" },
      });
      if (data.capacity < activeCount) {
        throw new Error(
          `Capacity cannot be reduced below the current active enrollment count (${activeCount} students).`
        );
      }

      // 3. Verify code uniqueness if changed
      if (data.code !== existingBatch.code) {
        const codeConflict = await tx.batch.findUnique({
          where: { tenantId_code: { tenantId: ctx.tenant.id, code: data.code } },
          select: { id: true },
        });
        if (codeConflict) {
          throw new Error(`Batch code '${data.code}' is already in use.`);
        }
      }

      await tx.batch.update({
        where: { id: batchId },
        data: {
          name: data.name,
          code: data.code,
          academicYearId: data.academicYearId,
          subjectId: data.subjectId || null,
          capacity: data.capacity,
          status: data.status,
          startDate: toDate(data.startDate),
          endDate: toDate(data.endDate),
          schedule: data.schedule || null,
          description: data.description || null,
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.update",
          entity: "Batch",
          entityId: batchId,
          meta: { code: data.code, status: data.status, capacity: data.capacity },
        },
        tx
      );
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update batch. Please try again.";
    return { error: message };
  }

  revalidatePath("/app/batches");
  revalidatePath(`/app/batches/${batchId}`);
  return { success: "Batch updated successfully." };
}

export async function assignTeachersAction(
  batchId: string,
  teacherIds: string[],
  primaryTeacherId?: string
): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.batches.manage_teachers", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const uniqueTeacherIds = Array.from(new Set(teacherIds.filter(Boolean)));

  // Validate teacher memberships belong to this tenant, are ACTIVE, and have teaching/admin roles
  if (uniqueTeacherIds.length > 0) {
    const validTeachers = await db.membership.findMany({
      where: {
        id: { in: uniqueTeacherIds },
        tenantId: ctx.tenant.id,
        status: "ACTIVE",
        role: { key: { in: ["TEACHER", "PRINCIPAL", "INSTITUTE_ADMIN"] } },
      },
      select: { id: true },
    });
    if (validTeachers.length !== uniqueTeacherIds.length) {
      return { error: "One or more assigned teachers are invalid, inactive, or unauthorized for teaching roles." };
    }
  }

  // Validate primary teacher is in assigned set
  if (primaryTeacherId && !uniqueTeacherIds.includes(primaryTeacherId)) {
    return { error: "Lead faculty must be one of the assigned teachers." };
  }

  try {
    await db.$transaction(async (tx) => {
      // Lock batch row to serialize teacher assignment
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Batch" WHERE id = ${batchId} AND "tenantId" = ${ctx.tenant.id} FOR UPDATE
      `;
      if (!locked || locked.length === 0) {
        throw new Error("Batch not found or access denied.");
      }

      // Remove existing assignments
      await tx.batchTeacher.deleteMany({ where: { batchId } });

      // Add new assignments
      if (uniqueTeacherIds.length > 0) {
        await tx.batchTeacher.createMany({
          data: uniqueTeacherIds.map((tid) => ({
            batchId,
            teacherId: tid,
            isPrimary: primaryTeacherId ? tid === primaryTeacherId : tid === uniqueTeacherIds[0],
          })),
        });
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.teachers_assigned",
          entity: "Batch",
          entityId: batchId,
          meta: { teacherCount: uniqueTeacherIds.length, primaryTeacherId },
        },
        tx
      );
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update teacher assignments.";
    return { error: message };
  }

  revalidatePath(`/app/batches/${batchId}`);
  return { success: "Teacher assignments updated." };
}

export async function enrollStudentsAction(
  batchId: string,
  studentIds: string[]
): Promise<{ success?: string; error?: string; enrolledCount?: number }> {
  const auth = await authorizeTenantWrite("tenant.batches.enroll", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = enrollStudentsSchema.safeParse({ batchId, studentIds });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid enrollment request." };

  // Phase 1 Requirement 3: Reject duplicate student IDs in a single request
  const uniqueStudentIds = Array.from(new Set(studentIds));
  if (uniqueStudentIds.length !== studentIds.length) {
    return { error: "Duplicate student IDs in enrollment request are not permitted." };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Concurrency-Safe Pessimistic Lock on Batch Row (FOR UPDATE)
      const lockedBatches = await tx.$queryRaw<Array<{ id: string; name: string; capacity: number; status: string }>>`
        SELECT id, name, capacity, status
        FROM "Batch"
        WHERE id = ${batchId} AND "tenantId" = ${ctx.tenant.id}
        FOR UPDATE
      `;
      const batch = lockedBatches[0];
      if (!batch) throw new Error("Batch not found or access denied.");

      // Phase 1 Requirement 6: Completed and archived batches must not accept new enrollments
      if (batch.status !== "ACTIVE") {
        throw new Error(`Enrollment is rejected. Batch is currently '${batch.status}' (only ACTIVE batches accept enrollments).`);
      }

      // 2. Verify all students belong to current tenant and are ACTIVE
      const students = await tx.student.findMany({
        where: {
          id: { in: uniqueStudentIds },
          tenantId: ctx.tenant.id,
          status: "ACTIVE",
        },
        select: { id: true, firstName: true, lastName: true },
      });
      if (students.length !== uniqueStudentIds.length) {
        throw new Error("One or more students do not belong to this institute or are inactive.");
      }

      // 3. Phase 1 Requirement 4: Reject already-active enrollments explicitly
      const existingEnrollments = await tx.batchStudent.findMany({
        where: { batchId, studentId: { in: uniqueStudentIds } },
      });
      const alreadyActive = existingEnrollments.filter((e) => e.status === "ACTIVE");
      if (alreadyActive.length > 0) {
        const activeStudent = students.find((s) => s.id === alreadyActive[0].studentId);
        const name = activeStudent ? `${activeStudent.firstName} ${activeStudent.lastName}` : "Student";
        throw new Error(`Student '${name}' is already actively enrolled in this batch.`);
      }

      // 4. Concurrency-safe capacity check: Count active students under locked batch row
      const currentActiveCount = await tx.batchStudent.count({
        where: { batchId, status: "ACTIVE" },
      });

      const requiredSlots = uniqueStudentIds.length;
      if (currentActiveCount + requiredSlots > batch.capacity) {
        const remainingCapacity = Math.max(0, batch.capacity - currentActiveCount);
        throw new Error(
          `Batch capacity exceeded. Current active: ${currentActiveCount}/${batch.capacity}. Available slots: ${remainingCapacity}. Requested: ${requiredSlots}.`
        );
      }

      // 5. Enroll / Re-enroll each student and record immutable audit event
      const existingMap = new Map(existingEnrollments.map((e) => [e.studentId, e]));
      const now = new Date();

      for (const s of students) {
        const prev = existingMap.get(s.id);
        const isReEnroll = !!prev;

        if (isReEnroll) {
          await tx.batchStudent.update({
            where: { batchId_studentId: { batchId, studentId: s.id } },
            data: {
              status: "ACTIVE",
              enrolledAt: now,
              droppedAt: null,
              dropReason: null,
              completedAt: null,
            },
          });
        } else {
          await tx.batchStudent.create({
            data: {
              batchId,
              studentId: s.id,
              status: "ACTIVE",
              enrolledAt: now,
            },
          });
        }

        await tx.batchEnrollmentEvent.create({
          data: {
            batchId,
            studentId: s.id,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            eventType: isReEnroll ? "RE_ENROLLED" : "ENROLLED",
            effectiveDate: now,
            reason: isReEnroll ? "Re-enrolled by staff" : "Initial batch enrollment",
          },
        });
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.students_enrolled",
          entity: "Batch",
          entityId: batchId,
          meta: { enrolledCount: students.length, studentIds: students.map((s) => s.id) },
        },
        tx
      );

      return { count: students.length };
    });

    revalidatePath(`/app/batches/${batchId}`);
    revalidatePath("/app/batches");
    return { success: `Successfully enrolled ${result.count} student(s).`, enrolledCount: result.count };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to enroll students.";
    return { error: message };
  }
}

export async function dropStudentAction(
  batchId: string,
  studentId: string,
  reason?: string
): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.batches.enroll", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = dropStudentSchema.safeParse({ batchId, studentId, reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid drop request." };

  try {
    await db.$transaction(async (tx) => {
      // 1. Lock batch row and verify tenant ownership
      const lockedBatches = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Batch" WHERE id = ${batchId} AND "tenantId" = ${ctx.tenant.id} FOR UPDATE
      `;
      if (!lockedBatches || lockedBatches.length === 0) {
        throw new Error("Batch not found or access denied.");
      }

      // 2. Verify student belongs to this tenant
      const student = await tx.student.findFirst({
        where: { id: studentId, tenantId: ctx.tenant.id },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!student) throw new Error("Student not found or does not belong to this institute.");

      // 3. Verify active enrollment
      const enrollment = await tx.batchStudent.findUnique({
        where: { batchId_studentId: { batchId, studentId } },
      });
      if (!enrollment || enrollment.status !== "ACTIVE") {
        throw new Error("Student is not actively enrolled in this batch.");
      }

      const now = new Date();
      await tx.batchStudent.update({
        where: { batchId_studentId: { batchId, studentId } },
        data: {
          status: "DROPPED",
          droppedAt: now,
          dropReason: reason?.trim() || "Dropped by staff",
        },
      });

      await tx.batchEnrollmentEvent.create({
        data: {
          batchId,
          studentId,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          eventType: "DROPPED",
          effectiveDate: now,
          reason: reason?.trim() || "Dropped by staff",
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.student_dropped",
          entity: "Batch",
          entityId: batchId,
          meta: { studentId, reason },
        },
        tx
      );
    });

    revalidatePath(`/app/batches/${batchId}`);
    return { success: "Student dropped from batch." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to drop student.";
    return { error: message };
  }
}

export async function transferStudentAction(
  fromBatchId: string,
  toBatchId: string,
  studentId: string,
  reason?: string
): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.batches.transfer", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  if (fromBatchId === toBatchId) {
    return { error: "Destination batch must be different from source batch." };
  }

  const parsed = transferStudentSchema.safeParse({ fromBatchId, toBatchId, studentId, reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid transfer request." };

  try {
    await db.$transaction(async (tx) => {
      // 1. Phase 1 Requirement 9: Deterministic Lock Ordering (ORDER BY id ASC) to prevent deadlocks
      const [firstId, secondId] = [fromBatchId, toBatchId].sort();
      const lockedBatches = await tx.$queryRaw<Array<{ id: string; name: string; capacity: number; status: string }>>`
        SELECT id, name, capacity, status
        FROM "Batch"
        WHERE id IN (${firstId}, ${secondId}) AND "tenantId" = ${ctx.tenant.id}
        ORDER BY id ASC
        FOR UPDATE
      `;

      const fromBatch = lockedBatches.find((b) => b.id === fromBatchId);
      const toBatch = lockedBatches.find((b) => b.id === toBatchId);

      if (!fromBatch) throw new Error("Source batch not found or access denied.");
      if (!toBatch) throw new Error("Destination batch not found or access denied.");
      if (toBatch.status !== "ACTIVE") {
        throw new Error(`Destination batch '${toBatch.name}' is not ACTIVE (status: ${toBatch.status}).`);
      }

      // 2. Verify student belongs to this tenant and is ACTIVE
      const student = await tx.student.findFirst({
        where: { id: studentId, tenantId: ctx.tenant.id, status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!student) throw new Error("Student not found or inactive in this institute.");

      // 3. Verify source enrollment is ACTIVE
      const currentEnrollment = await tx.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: fromBatchId, studentId } },
      });
      if (!currentEnrollment || currentEnrollment.status !== "ACTIVE") {
        throw new Error("Student is not actively enrolled in the source batch.");
      }

      // 4. Verify student is not already active in destination batch
      const destExisting = await tx.batchStudent.findUnique({
        where: { batchId_studentId: { batchId: toBatchId, studentId } },
      });
      if (destExisting && destExisting.status === "ACTIVE") {
        throw new Error(`Student '${student.firstName} ${student.lastName}' is already actively enrolled in destination batch '${toBatch.name}'.`);
      }

      // 5. Phase 1 Requirement 8: Validate destination capacity within the same locked transaction
      const destActiveCount = await tx.batchStudent.count({
        where: { batchId: toBatchId, status: "ACTIVE" },
      });
      if (destActiveCount >= toBatch.capacity) {
        throw new Error(
          `Destination batch '${toBatch.name}' is at full capacity (${destActiveCount}/${toBatch.capacity} seats).`
        );
      }

      const now = new Date();

      // 6. Mark source enrollment as TRANSFERRED
      await tx.batchStudent.update({
        where: { batchId_studentId: { batchId: fromBatchId, studentId } },
        data: {
          status: "TRANSFERRED",
          droppedAt: now,
          dropReason: reason?.trim() ? `Transferred to ${toBatch.name}: ${reason.trim()}` : `Transferred to ${toBatch.name}`,
        },
      });

      // Record transfer event on source batch
      await tx.batchEnrollmentEvent.create({
        data: {
          batchId: fromBatchId,
          studentId,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          eventType: "TRANSFERRED",
          fromBatchId,
          toBatchId,
          effectiveDate: now,
          reason: reason?.trim() || `Transferred to batch ${toBatch.name}`,
        },
      });

      // 7. Enroll in destination batch (Re-enroll or Create)
      if (destExisting) {
        await tx.batchStudent.update({
          where: { batchId_studentId: { batchId: toBatchId, studentId } },
          data: {
            status: "ACTIVE",
            enrolledAt: now,
            droppedAt: null,
            dropReason: null,
            completedAt: null,
          },
        });
      } else {
        await tx.batchStudent.create({
          data: {
            batchId: toBatchId,
            studentId,
            status: "ACTIVE",
            enrolledAt: now,
          },
        });
      }

      // Record enrollment event on destination batch
      await tx.batchEnrollmentEvent.create({
        data: {
          batchId: toBatchId,
          studentId,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          eventType: "ENROLLED",
          fromBatchId,
          toBatchId,
          effectiveDate: now,
          reason: reason?.trim() ? `Transferred from ${fromBatch.name}: ${reason.trim()}` : `Transferred from ${fromBatch.name}`,
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.student_transferred",
          entity: "Batch",
          entityId: toBatchId,
          meta: { fromBatchId, toBatchId, studentId, reason },
        },
        tx
      );
    });

    revalidatePath(`/app/batches/${fromBatchId}`);
    revalidatePath(`/app/batches/${toBatchId}`);
    revalidatePath("/app/batches");
    return { success: "Student successfully transferred." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to transfer student.";
    return { error: message };
  }
}

export async function completeBatchAction(batchId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.batches.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  try {
    await db.$transaction(async (tx) => {
      // Lock batch row FOR UPDATE
      const lockedBatches = await tx.$queryRaw<Array<{ id: string; name: string; status: string; endDate: Date | null }>>`
        SELECT id, name, status, "endDate"
        FROM "Batch"
        WHERE id = ${batchId} AND "tenantId" = ${ctx.tenant.id}
        FOR UPDATE
      `;
      const batch = lockedBatches[0];
      if (!batch) throw new Error("Batch not found or access denied.");
      if (batch.status === "COMPLETED") throw new Error("Batch is already completed.");
      if (batch.status === "ARCHIVED") throw new Error("Cannot complete an archived batch.");

      const now = new Date();

      // 1. Update batch status
      await tx.batch.update({
        where: { id: batchId },
        data: { status: "COMPLETED", endDate: batch.endDate ?? now },
      });

      // 2. Fetch and complete all active student enrollments
      const activeStudents = await tx.batchStudent.findMany({
        where: { batchId, status: "ACTIVE" },
        select: { studentId: true },
      });

      if (activeStudents.length > 0) {
        await tx.batchStudent.updateMany({
          where: { batchId, status: "ACTIVE" },
          data: { status: "COMPLETED", completedAt: now },
        });

        // Record completion event for each student
        await tx.batchEnrollmentEvent.createMany({
          data: activeStudents.map((s) => ({
            batchId,
            studentId: s.studentId,
            actorId: ctx.user.id,
            actorName: ctx.user.name,
            eventType: "COMPLETED",
            effectiveDate: now,
            reason: "Batch term completed",
          })),
        });
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "batch.completed",
          entity: "Batch",
          entityId: batchId,
          meta: { completedStudents: activeStudents.length },
        },
        tx
      );
    });

    revalidatePath(`/app/batches/${batchId}`);
    revalidatePath("/app/batches");
    return { success: "Batch marked as completed." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to complete batch.";
    return { error: message };
  }
}
