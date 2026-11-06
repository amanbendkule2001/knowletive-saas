"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, type FormState } from "@/lib/validation";
import {
  createSyllabusSchema,
  updateSyllabusSchema,
  createChapterSchema,
  updateChapterSchema,
  createTopicSchema,
  updateTopicSchema,
  createLessonPlanSchema,
  updateLessonPlanSchema,
  updateTopicProgressSchema,
} from "@/lib/syllabus-schema";
import type {
  SyllabusStatus,
  SyllabusTargetType,
  TopicProgressStatus,
  LessonPlanStatus,
  Prisma,
} from "@prisma/client";

function toDate(val: unknown): Date | null {
  if (!val || typeof val !== "string") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────
// 1. SYLLABUS STRUCTURE ACTIONS
// ─────────────────────────────────────────────────────────────

export async function createSyllabusAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const rawTeacherIds = formData.getAll("teacherIds").map(String).filter(Boolean);

  const parsed = createSyllabusSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    description: formData.get("description") || null,
    academicYearId: formData.get("academicYearId"),
    subjectId: formData.get("subjectId"),
    targetType: (formData.get("targetType") as SyllabusTargetType) || "CLASS_SECTION",
    classId: formData.get("classId") || null,
    sectionId: formData.get("sectionId") || null,
    batchId: formData.get("batchId") || null,
    startDate: formData.get("startDate") || null,
    targetDate: formData.get("targetDate") || null,
    teacherIds: rawTeacherIds,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // 1. Verify AcademicYear ownership
  const ay = await db.academicYear.findFirst({
    where: { id: data.academicYearId, tenantId: ctx.tenant.id },
  });
  if (!ay) return { error: "Academic year not found in this institute." };

  // 2. Verify Subject ownership
  const subject = await db.subject.findFirst({
    where: { id: data.subjectId, tenantId: ctx.tenant.id },
  });
  if (!subject) return { error: "Subject not found in this institute." };

  // 3. Verify Target Ownership & Integrity
  if (data.targetType === "CLASS_SECTION") {
    if (!data.classId) return { error: "Please select a target class." };
    if (data.batchId) return { error: "Batch cannot be assigned to a class syllabus." };

    const classLevel = await db.classLevel.findFirst({
      where: { id: data.classId, tenantId: ctx.tenant.id },
    });
    if (!classLevel) return { error: "Target class not found in this institute." };

    if (data.sectionId) {
      const section = await db.section.findFirst({
        where: { id: data.sectionId, classId: data.classId, tenantId: ctx.tenant.id },
      });
      if (!section) return { error: "Target section not found in this class." };
    }
  } else if (data.targetType === "BATCH") {
    if (!data.batchId) return { error: "Please select a target batch." };
    if (data.classId || data.sectionId) {
      return { error: "Class and section cannot be assigned to a batch syllabus." };
    }

    const batch = await db.batch.findFirst({
      where: { id: data.batchId, tenantId: ctx.tenant.id },
    });
    if (!batch) return { error: "Target batch not found in this institute." };

    // Academic year compatibility
    if (batch.academicYearId !== data.academicYearId) {
      return { error: "Selected batch belongs to a different academic year." };
    }

    // Subject compatibility if batch has designated subject
    if (batch.subjectId && batch.subjectId !== data.subjectId) {
      return { error: "Selected batch is designated for a different subject." };
    }
  }

  // 4. Verify unique tenant code
  const existingCode = await db.syllabusTrack.findUnique({
    where: { tenantId_code: { tenantId: ctx.tenant.id, code: data.code } },
  });
  if (existingCode) return { error: `Syllabus code "${data.code}" already exists in this institute.` };

  // 5. Verify teacher memberships belong to tenant
  if (data.teacherIds.length > 0) {
    const validTeachers = await db.membership.findMany({
      where: { id: { in: data.teacherIds }, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (validTeachers.length !== data.teacherIds.length) {
      return { error: "One or more assigned teachers do not belong to this institute." };
    }
  }

  let createdId = "";
  try {
    const created = await db.$transaction(async (tx) => {
      const syllabus = await tx.syllabusTrack.create({
        data: {
          tenantId: ctx.tenant.id,
          academicYearId: data.academicYearId,
          subjectId: data.subjectId,
          targetType: data.targetType,
          classId: data.targetType === "CLASS_SECTION" ? data.classId : null,
          sectionId: data.targetType === "CLASS_SECTION" ? data.sectionId : null,
          batchId: data.targetType === "BATCH" ? data.batchId : null,
          name: data.name,
          code: data.code,
          description: data.description,
          status: "DRAFT",
          startDate: toDate(data.startDate),
          targetDate: toDate(data.targetDate),
          teachers:
            data.teacherIds.length > 0
              ? {
                  create: data.teacherIds.map((tid, idx) => ({
                    teacherId: tid,
                    isPrimary: idx === 0,
                  })),
                }
              : undefined,
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "syllabus.create",
          entity: "SyllabusTrack",
          entityId: syllabus.id,
          meta: { name: syllabus.name, code: syllabus.code, targetType: syllabus.targetType },
        },
        tx
      );

      return syllabus;
    });

    createdId = created.id;
  } catch (err: unknown) {
    console.error("Failed to create syllabus:", err);
    return { error: "An unexpected error occurred while creating the syllabus." };
  }

  revalidatePath("/app/syllabus");
  redirect(`/app/syllabus/${createdId}`);
}

export async function updateSyllabusAction(
  syllabusId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const rawTeacherIds = formData.getAll("teacherIds").map(String).filter(Boolean);

  const parsed = updateSyllabusSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    status: (formData.get("status") as SyllabusStatus) || undefined,
    startDate: formData.get("startDate") || null,
    targetDate: formData.get("targetDate") || null,
    teacherIds: rawTeacherIds.length > 0 ? rawTeacherIds : undefined,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  const existing = await db.syllabusTrack.findFirst({
    where: { id: syllabusId, tenantId: ctx.tenant.id },
  });
  if (!existing) return { error: "Syllabus not found in this institute." };

  if (data.teacherIds && data.teacherIds.length > 0) {
    const validTeachers = await db.membership.findMany({
      where: { id: { in: data.teacherIds }, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (validTeachers.length !== data.teacherIds.length) {
      return { error: "One or more assigned teachers do not belong to this institute." };
    }
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.syllabusTrack.update({
        where: { id: syllabusId },
        data: {
          name: data.name,
          description: data.description,
          status: data.status,
          startDate: toDate(data.startDate),
          targetDate: toDate(data.targetDate),
        },
      });

      if (data.teacherIds) {
        await tx.syllabusTeacher.deleteMany({ where: { syllabusId } });
        if (data.teacherIds.length > 0) {
          await tx.syllabusTeacher.createMany({
            data: data.teacherIds.map((tid, idx) => ({
              syllabusId,
              teacherId: tid,
              isPrimary: idx === 0,
            })),
          });
        }
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "syllabus.update",
          entity: "SyllabusTrack",
          entityId: syllabusId,
          meta: { status: data.status, description: data.description },
        },
        tx
      );
    });
  } catch (err: unknown) {
    console.error("Failed to update syllabus:", err);
    return { error: "An unexpected error occurred while updating the syllabus." };
  }

  revalidatePath("/app/syllabus");
  revalidatePath(`/app/syllabus/${syllabusId}`);
  return { success: "Syllabus updated successfully." };
}

export async function archiveSyllabusAction(syllabusId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const syllabus = await db.syllabusTrack.findFirst({
    where: { id: syllabusId, tenantId: ctx.tenant.id },
  });
  if (!syllabus) return { error: "Syllabus not found." };

  await db.syllabusTrack.update({
    where: { id: syllabusId },
    data: { status: "ARCHIVED" },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "syllabus.archive",
    entity: "SyllabusTrack",
    entityId: syllabusId,
    meta: { previousStatus: syllabus.status, newStatus: "ARCHIVED" },
  });

  revalidatePath("/app/syllabus");
  revalidatePath(`/app/syllabus/${syllabusId}`);
  return { success: "Syllabus archived successfully." };
}

export async function deleteSyllabusAction(syllabusId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.write", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const syllabus = await db.syllabusTrack.findFirst({
    where: { id: syllabusId, tenantId: ctx.tenant.id },
  });
  if (!syllabus) return { error: "Syllabus not found." };

  await db.syllabusTrack.delete({
    where: { id: syllabusId },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "syllabus.delete",
    entity: "SyllabusTrack",
    entityId: syllabusId,
    meta: { name: syllabus.name, code: syllabus.code },
  });

  revalidatePath("/app/syllabus");
  redirect("/app/syllabus");
}

// ─────────────────────────────────────────────────────────────
// 2. CHAPTER ACTIONS
// ─────────────────────────────────────────────────────────────

export async function createChapterAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = createChapterSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    title: formData.get("title"),
    description: formData.get("description") || null,
    order: formData.get("order") ? Number(formData.get("order")) : 0,
    estimatedHours: formData.get("estimatedHours") ? Number(formData.get("estimatedHours")) : 1,
    plannedStartDate: formData.get("plannedStartDate") || null,
    plannedEndDate: formData.get("plannedEndDate") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  const syllabus = await db.syllabusTrack.findFirst({
    where: { id: data.syllabusId, tenantId: ctx.tenant.id },
  });
  if (!syllabus) return { error: "Syllabus not found." };

  // Calculate order if not provided or collision
  const existingChapters = await db.syllabusChapter.findMany({
    where: { syllabusId: data.syllabusId },
    select: { order: true },
    orderBy: { order: "asc" },
  });

  let order = data.order;
  const takenOrders = new Set(existingChapters.map((c) => c.order));
  if (takenOrders.has(order) || order === 0) {
    order = existingChapters.length > 0 ? Math.max(...existingChapters.map((c) => c.order)) + 1 : 1;
  }

  try {
    await db.syllabusChapter.create({
      data: {
        tenantId: ctx.tenant.id,
        syllabusId: data.syllabusId,
        title: data.title,
        description: data.description,
        order,
        estimatedHours: data.estimatedHours,
        plannedStartDate: toDate(data.plannedStartDate),
        plannedEndDate: toDate(data.plannedEndDate),
      },
    });
  } catch (err: unknown) {
    console.error("Failed to create chapter:", err);
    return { error: "Failed to create chapter." };
  }

  revalidatePath(`/app/syllabus/${data.syllabusId}`);
  return { success: "Chapter created successfully." };
}

export async function updateChapterAction(
  chapterId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateChapterSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || null,
    order: formData.get("order") ? Number(formData.get("order")) : undefined,
    estimatedHours: formData.get("estimatedHours") ? Number(formData.get("estimatedHours")) : undefined,
    plannedStartDate: formData.get("plannedStartDate") || null,
    plannedEndDate: formData.get("plannedEndDate") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  const chapter = await db.syllabusChapter.findFirst({
    where: { id: chapterId, tenantId: ctx.tenant.id },
  });
  if (!chapter) return { error: "Chapter not found." };

  await db.syllabusChapter.update({
    where: { id: chapterId },
    data: {
      title: data.title,
      description: data.description,
      order: data.order,
      estimatedHours: data.estimatedHours,
      plannedStartDate: toDate(data.plannedStartDate),
      plannedEndDate: toDate(data.plannedEndDate),
    },
  });

  revalidatePath(`/app/syllabus/${chapter.syllabusId}`);
  return { success: "Chapter updated successfully." };
}

export async function deleteChapterAction(chapterId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const chapter = await db.syllabusChapter.findFirst({
    where: { id: chapterId, tenantId: ctx.tenant.id },
  });
  if (!chapter) return { error: "Chapter not found." };

  await db.syllabusChapter.delete({ where: { id: chapterId } });

  revalidatePath(`/app/syllabus/${chapter.syllabusId}`);
  return { success: "Chapter deleted successfully." };
}

export async function reorderChaptersAction(
  syllabusId: string,
  chapterOrders: Array<{ id: string; order: number }>
): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const syllabus = await db.syllabusTrack.findFirst({
    where: { id: syllabusId, tenantId: ctx.tenant.id },
  });
  if (!syllabus) return { error: "Syllabus not found." };

  const chapterIds = chapterOrders.map((o) => o.id);
  const validChapters = await db.syllabusChapter.findMany({
    where: { id: { in: chapterIds }, syllabusId, tenantId: ctx.tenant.id },
    select: { id: true },
  });
  if (validChapters.length !== chapterIds.length) {
    return { error: "One or more chapters do not belong to this syllabus." };
  }

  await db.$transaction(async (tx) => {
    // 1. Temporarily shift orders to negative to avoid unique constraint violations
    for (const item of chapterOrders) {
      await tx.syllabusChapter.update({
        where: { id: item.id },
        data: { order: -item.order },
      });
    }
    // 2. Set final target orders
    for (const item of chapterOrders) {
      await tx.syllabusChapter.update({
        where: { id: item.id },
        data: { order: item.order },
      });
    }
  });

  revalidatePath(`/app/syllabus/${syllabusId}`);
  return { success: "Chapters reordered successfully." };
}

// ─────────────────────────────────────────────────────────────
// 3. TOPIC ACTIONS
// ─────────────────────────────────────────────────────────────

export async function createTopicAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = createTopicSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    chapterId: formData.get("chapterId"),
    title: formData.get("title"),
    description: formData.get("description") || null,
    order: formData.get("order") ? Number(formData.get("order")) : 0,
    learningObjectives: formData.get("learningObjectives") || null,
    estimatedMinutes: formData.get("estimatedMinutes") ? Number(formData.get("estimatedMinutes")) : 45,
    plannedDate: formData.get("plannedDate") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  const chapter = await db.syllabusChapter.findFirst({
    where: { id: data.chapterId, syllabusId: data.syllabusId, tenantId: ctx.tenant.id },
  });
  if (!chapter) return { error: "Chapter not found." };

  const existingTopics = await db.syllabusTopic.findMany({
    where: { chapterId: data.chapterId },
    select: { order: true },
    orderBy: { order: "asc" },
  });

  let order = data.order;
  const takenOrders = new Set(existingTopics.map((t) => t.order));
  if (takenOrders.has(order) || order === 0) {
    order = existingTopics.length > 0 ? Math.max(...existingTopics.map((t) => t.order)) + 1 : 1;
  }

  try {
    await db.$transaction(async (tx) => {
      const topic = await tx.syllabusTopic.create({
        data: {
          tenantId: ctx.tenant.id,
          syllabusId: data.syllabusId,
          chapterId: data.chapterId,
          title: data.title,
          description: data.description,
          order,
          learningObjectives: data.learningObjectives,
          estimatedMinutes: data.estimatedMinutes,
          plannedDate: toDate(data.plannedDate),
          status: "NOT_STARTED",
        },
      });

      // Initialize TopicProgress record
      await tx.topicProgress.create({
        data: {
          tenantId: ctx.tenant.id,
          syllabusId: data.syllabusId,
          topicId: topic.id,
          status: "NOT_STARTED",
          plannedDate: toDate(data.plannedDate),
        },
      });
    });
  } catch (err: unknown) {
    console.error("Failed to create topic:", err);
    return { error: "Failed to create topic." };
  }

  revalidatePath(`/app/syllabus/${data.syllabusId}`);
  return { success: "Topic created successfully." };
}

export async function updateTopicAction(
  topicId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateTopicSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || null,
    order: formData.get("order") ? Number(formData.get("order")) : undefined,
    learningObjectives: formData.get("learningObjectives") || null,
    estimatedMinutes: formData.get("estimatedMinutes") ? Number(formData.get("estimatedMinutes")) : undefined,
    plannedDate: formData.get("plannedDate") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  const topic = await db.syllabusTopic.findFirst({
    where: { id: topicId, tenantId: ctx.tenant.id },
  });
  if (!topic) return { error: "Topic not found." };

  await db.syllabusTopic.update({
    where: { id: topicId },
    data: {
      title: data.title,
      description: data.description,
      order: data.order,
      learningObjectives: data.learningObjectives,
      estimatedMinutes: data.estimatedMinutes,
      plannedDate: toDate(data.plannedDate),
    },
  });

  revalidatePath(`/app/syllabus/${topic.syllabusId}`);
  return { success: "Topic updated successfully." };
}

export async function deleteTopicAction(topicId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const topic = await db.syllabusTopic.findFirst({
    where: { id: topicId, tenantId: ctx.tenant.id },
  });
  if (!topic) return { error: "Topic not found." };

  await db.syllabusTopic.delete({ where: { id: topicId } });

  revalidatePath(`/app/syllabus/${topic.syllabusId}`);
  return { success: "Topic deleted successfully." };
}

export async function reorderTopicsAction(
  chapterId: string,
  topicOrders: Array<{ id: string; order: number }>
): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_structure", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const chapter = await db.syllabusChapter.findFirst({
    where: { id: chapterId, tenantId: ctx.tenant.id },
  });
  if (!chapter) return { error: "Chapter not found." };

  const topicIds = topicOrders.map((o) => o.id);
  const validTopics = await db.syllabusTopic.findMany({
    where: { id: { in: topicIds }, chapterId, tenantId: ctx.tenant.id },
    select: { id: true },
  });
  if (validTopics.length !== topicIds.length) {
    return { error: "One or more topics do not belong to this chapter." };
  }

  await db.$transaction(async (tx) => {
    for (const item of topicOrders) {
      await tx.syllabusTopic.update({
        where: { id: item.id },
        data: { order: -item.order },
      });
    }
    for (const item of topicOrders) {
      await tx.syllabusTopic.update({
        where: { id: item.id },
        data: { order: item.order },
      });
    }
  });

  revalidatePath(`/app/syllabus/${chapter.syllabusId}`);
  return { success: "Topics reordered successfully." };
}

// ─────────────────────────────────────────────────────────────
// 4. LESSON PLAN ACTIONS
// ─────────────────────────────────────────────────────────────

export async function createLessonPlanAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_lessons", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = createLessonPlanSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    chapterId: formData.get("chapterId"),
    topicId: formData.get("topicId"),
    title: formData.get("title"),
    objectives: formData.get("objectives") || null,
    methodology: formData.get("methodology") || null,
    materials: formData.get("materials") || null,
    plannedDate: formData.get("plannedDate"),
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : 45,
    homework: formData.get("homework") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // Verify Chapter, Topic, and Syllabus hierarchy
  const chapter = await db.syllabusChapter.findFirst({
    where: { id: data.chapterId, syllabusId: data.syllabusId, tenantId: ctx.tenant.id },
  });
  if (!chapter) return { error: "Chapter not found or does not belong to this syllabus." };

  const topic = await db.syllabusTopic.findFirst({
    where: {
      id: data.topicId,
      chapterId: data.chapterId,
      syllabusId: data.syllabusId,
      tenantId: ctx.tenant.id,
    },
  });
  if (!topic) return { error: "Topic not found or does not belong to this chapter and syllabus." };

  // Teacher Scoping: If user is TEACHER, verify assignment
  if (ctx.membership?.roleKey === "TEACHER") {
    const isAssigned = await db.syllabusTeacher.findFirst({
      where: {
        syllabusId: data.syllabusId,
        teacher: { userId: ctx.user.id },
      },
    });
    if (!isAssigned) {
      return { error: "Access denied: You are not assigned to this syllabus." };
    }
  }

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });
  if (!membership) return { error: "Staff membership not found." };

  try {
    await db.lessonPlan.create({
      data: {
        tenantId: ctx.tenant.id,
        syllabusId: data.syllabusId,
        chapterId: data.chapterId,
        topicId: data.topicId,
        teacherId: membership.id,
        title: data.title,
        objectives: data.objectives,
        methodology: data.methodology,
        materials: data.materials,
        plannedDate: new Date(data.plannedDate),
        durationMinutes: data.durationMinutes,
        homework: data.homework,
        status: "PLANNED",
      },
    });
  } catch (err: unknown) {
    console.error("Failed to create lesson plan:", err);
    return { error: "Failed to create lesson plan." };
  }

  revalidatePath(`/app/syllabus/${data.syllabusId}`);
  return { success: "Lesson plan created successfully." };
}

export async function updateLessonPlanAction(
  planId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_lessons", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const plan = await db.lessonPlan.findFirst({
    where: { id: planId, tenantId: ctx.tenant.id },
  });
  if (!plan) return { error: "Lesson plan not found." };

  // Teacher Scoping: Verify assigned teacher
  if (ctx.membership?.roleKey === "TEACHER") {
    const isAssigned = await db.syllabusTeacher.findFirst({
      where: {
        syllabusId: plan.syllabusId,
        teacher: { userId: ctx.user.id },
      },
    });
    if (!isAssigned) {
      return { error: "Access denied: You are not assigned to this syllabus." };
    }
  }

  const parsed = updateLessonPlanSchema.safeParse({
    title: formData.get("title"),
    objectives: formData.get("objectives") || null,
    methodology: formData.get("methodology") || null,
    materials: formData.get("materials") || null,
    plannedDate: formData.get("plannedDate") || undefined,
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : undefined,
    completedDate: formData.get("completedDate") || null,
    actualDurationMinutes: formData.get("actualDurationMinutes") ? Number(formData.get("actualDurationMinutes")) : null,
    status: (formData.get("status") as LessonPlanStatus) || undefined,
    remarks: formData.get("remarks") || null,
    homework: formData.get("homework") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // Validate lifecycle transitions if status is being updated
  if (data.status && data.status !== plan.status) {
    const allowedTransitions: Record<LessonPlanStatus, LessonPlanStatus[]> = {
      DRAFT: ["PLANNED", "CANCELLED"],
      PLANNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: [],
    };

    if (!allowedTransitions[plan.status]?.includes(data.status)) {
      return {
        error: `Invalid status transition: Cannot change lesson plan from ${plan.status} to ${data.status}.`,
      };
    }
  }

  // Consistent duration and completion date handling
  const targetStatus = data.status ?? plan.status;
  let finalCompletedDate = toDate(data.completedDate);
  let finalActualMinutes = data.actualDurationMinutes;

  if (targetStatus === "CANCELLED" || targetStatus === "DRAFT" || targetStatus === "PLANNED") {
    finalCompletedDate = null;
    finalActualMinutes = null;
  } else if (targetStatus === "COMPLETED") {
    finalCompletedDate = finalCompletedDate ?? new Date();
    finalActualMinutes = finalActualMinutes ?? plan.durationMinutes;
  }

  await db.lessonPlan.update({
    where: { id: planId },
    data: {
      title: data.title,
      objectives: data.objectives,
      methodology: data.methodology,
      materials: data.materials,
      plannedDate: data.plannedDate ? new Date(data.plannedDate) : undefined,
      durationMinutes: data.durationMinutes,
      completedDate: finalCompletedDate,
      actualDurationMinutes: finalActualMinutes,
      status: data.status,
      remarks: data.remarks,
      homework: data.homework,
    },
  });

  revalidatePath(`/app/syllabus/${plan.syllabusId}`);
  return { success: "Lesson plan updated successfully." };
}

export async function deleteLessonPlanAction(planId: string): Promise<{ success?: string; error?: string }> {
  const auth = await authorizeTenantWrite("tenant.syllabus.manage_lessons", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const plan = await db.lessonPlan.findFirst({
    where: { id: planId, tenantId: ctx.tenant.id },
  });
  if (!plan) return { error: "Lesson plan not found." };

  // Teacher Scoping
  if (ctx.membership?.roleKey === "TEACHER") {
    const isAssigned = await db.syllabusTeacher.findFirst({
      where: { syllabusId: plan.syllabusId, teacher: { userId: ctx.user.id } },
    });
    if (!isAssigned) return { error: "Access denied: You are not assigned to this syllabus." };
  }

  await db.lessonPlan.delete({ where: { id: planId } });

  revalidatePath(`/app/syllabus/${plan.syllabusId}`);
  return { success: "Lesson plan deleted." };
}

// ─────────────────────────────────────────────────────────────
// 5. PROGRESS TRACKING ACTIONS
// ─────────────────────────────────────────────────────────────

export async function updateTopicProgressAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.syllabus.update_progress", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = updateTopicProgressSchema.safeParse({
    syllabusId: formData.get("syllabusId"),
    topicId: formData.get("topicId"),
    status: (formData.get("status") as TopicProgressStatus) || "NOT_STARTED",
    plannedDate: formData.get("plannedDate") || null,
    completedDate: formData.get("completedDate") || null,
    completedHours: formData.get("completedHours") ? Number(formData.get("completedHours")) : 0,
    notes: formData.get("notes") || null,
  });

  if (!parsed.success) return fieldErrors(parsed.error);
  const data = parsed.data;

  // Verify topic ownership
  const topic = await db.syllabusTopic.findFirst({
    where: { id: data.topicId, syllabusId: data.syllabusId, tenantId: ctx.tenant.id },
  });
  if (!topic) return { error: "Topic not found." };

  // Teacher Scoping
  if (ctx.membership?.roleKey === "TEACHER") {
    const isAssigned = await db.syllabusTeacher.findFirst({
      where: { syllabusId: data.syllabusId, teacher: { userId: ctx.user.id } },
    });
    if (!isAssigned) {
      return { error: "Access denied: You are not assigned to this syllabus." };
    }
  }

  const membership = await db.membership.findFirst({
    where: { userId: ctx.user.id, tenantId: ctx.tenant.id },
  });

  const prevStatus = topic.status;
  const newStatus = data.status;

  try {
    await db.$transaction(async (tx) => {
      // 1. Update topic status
      await tx.syllabusTopic.update({
        where: { id: data.topicId },
        data: {
          status: newStatus,
          plannedDate: toDate(data.plannedDate) ?? topic.plannedDate,
        },
      });

      // 2. Upsert TopicProgress
      await tx.topicProgress.upsert({
        where: { syllabusId_topicId: { syllabusId: data.syllabusId, topicId: data.topicId } },
        create: {
          tenantId: ctx.tenant.id,
          syllabusId: data.syllabusId,
          topicId: data.topicId,
          teacherId: membership?.id,
          status: newStatus,
          plannedDate: toDate(data.plannedDate) ?? topic.plannedDate,
          completedDate: newStatus === "COMPLETED" ? toDate(data.completedDate) || new Date() : null,
          completedHours: data.completedHours,
          notes: data.notes,
        },
        update: {
          status: newStatus,
          teacherId: membership?.id,
          plannedDate: toDate(data.plannedDate) ?? topic.plannedDate,
          completedDate: newStatus === "COMPLETED" ? toDate(data.completedDate) || new Date() : null,
          completedHours: data.completedHours,
          notes: data.notes,
        },
      });

      // 3. Log historical progress event
      await tx.syllabusProgressEvent.create({
        data: {
          tenantId: ctx.tenant.id,
          syllabusId: data.syllabusId,
          topicId: data.topicId,
          actorId: membership?.id,
          actorName: ctx.user.name,
          previousStatus: prevStatus,
          newStatus,
          remarks: data.notes,
        },
      });

      // 4. Audit Log
      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "syllabus.progress_update",
          entity: "SyllabusProgress",
          entityId: data.topicId,
          meta: { previousStatus: prevStatus, newStatus },
        },
        tx
      );
    });
  } catch (err: unknown) {
    console.error("Failed to update topic progress:", err);
    return { error: "Failed to update topic progress." };
  }

  revalidatePath(`/app/syllabus/${data.syllabusId}`);
  return { success: "Progress updated successfully." };
}

// ─────────────────────────────────────────────────────────────
// 6. METRICS & REPORTS (READ-ONLY)
// ─────────────────────────────────────────────────────────────

export type SyllabusDashboardMetrics = {
  totalSyllabuses: number;
  activeSyllabuses: number;
  completedSyllabuses: number;
  totalChapters: number;
  totalTopics: number;
  completedTopics: number;
  inProgressTopics: number;
  pendingTopics: number;
  delayedTopics: number;
  completionRate: number;
};

export async function getSyllabusDashboardMetrics(
  tenantId: string,
  teacherUserId?: string
): Promise<SyllabusDashboardMetrics> {
  const syllabusWhere: Prisma.SyllabusTrackWhereInput = {
    tenantId,
    ...(teacherUserId ? { teachers: { some: { teacher: { userId: teacherUserId } } } } : {}),
  };

  const chapterWhere: Prisma.SyllabusChapterWhereInput = {
    tenantId,
    ...(teacherUserId ? { syllabus: { teachers: { some: { teacher: { userId: teacherUserId } } } } } : {}),
  };

  const topicWhere: Prisma.SyllabusTopicWhereInput = {
    tenantId,
    ...(teacherUserId ? { syllabus: { teachers: { some: { teacher: { userId: teacherUserId } } } } } : {}),
  };

  const [totalSyllabuses, activeSyllabuses, completedSyllabuses, totalChapters, totalTopics, topicsByStatus] =
    await Promise.all([
      db.syllabusTrack.count({ where: syllabusWhere }),
      db.syllabusTrack.count({ where: { ...syllabusWhere, status: "ACTIVE" } }),
      db.syllabusTrack.count({ where: { ...syllabusWhere, status: "COMPLETED" } }),
      db.syllabusChapter.count({ where: chapterWhere }),
      db.syllabusTopic.count({ where: topicWhere }),
      db.syllabusTopic.groupBy({
        by: ["status"],
        where: topicWhere,
        _count: { id: true },
      }),
    ]);

  const statusMap: Record<string, number> = {};
  for (const row of topicsByStatus) {
    statusMap[row.status] = row._count.id;
  }

  const completedTopics = statusMap["COMPLETED"] || 0;
  const inProgressTopics = statusMap["IN_PROGRESS"] || 0;
  const pendingTopics = (statusMap["NOT_STARTED"] || 0) + (statusMap["SKIPPED"] || 0);

  // Delayed topics: plannedDate < today and status neither COMPLETED nor SKIPPED
  const now = new Date();
  const delayedTopics = await db.syllabusTopic.count({
    where: {
      ...topicWhere,
      status: { notIn: ["COMPLETED", "SKIPPED"] },
      plannedDate: { lt: now },
    },
  });

  const completionRate = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

  return {
    totalSyllabuses,
    activeSyllabuses,
    completedSyllabuses,
    totalChapters,
    totalTopics,
    completedTopics,
    inProgressTopics,
    pendingTopics,
    delayedTopics,
    completionRate,
  };
}
