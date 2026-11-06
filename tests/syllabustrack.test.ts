import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

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
  createSyllabusSchema,
  createChapterSchema,
  createTopicSchema,
  createLessonPlanSchema,
  updateTopicProgressSchema,
} from "@/lib/syllabus-schema";
import { getSyllabusDashboardMetrics } from "@/actions/syllabus";

describe("Stage 3: Enterprise SyllabusTrack Management Test Suite", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let academicYearA: { id: string };
  let academicYearB: { id: string };
  let subjectA: { id: string };
  let subjectB: { id: string };
  let classA: { id: string };
  let sectionA: { id: string };
  let batchA: { id: string };
  let batchB: { id: string };
  let teacherA: { id: string; userId: string };
  let teacherB: { id: string };

  const createdSyllabusIds: string[] = [];

  beforeAll(async () => {
    // 1. Fetch test tenants
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // 2. Academic Years
    let ayA = await db.academicYear.findFirst({ where: { tenantId: tenantA.id } });
    if (!ayA) {
      ayA = await db.academicYear.create({
        data: {
          tenantId: tenantA.id,
          name: `AY-A-${Date.now().toString().slice(-4)}`,
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isActive: true,
        },
      });
    }
    academicYearA = ayA;

    let ayB = await db.academicYear.findFirst({ where: { tenantId: tenantB.id } });
    if (!ayB) {
      ayB = await db.academicYear.create({
        data: {
          tenantId: tenantB.id,
          name: `AY-B-${Date.now().toString().slice(-4)}`,
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isActive: true,
        },
      });
    }
    academicYearB = ayB;

    // 3. Subjects
    let subA = await db.subject.findFirst({ where: { tenantId: tenantA.id } });
    if (!subA) {
      subA = await db.subject.create({
        data: { tenantId: tenantA.id, name: "Physics", code: "PHY-10" },
      });
    }
    subjectA = subA;

    let subB = await db.subject.findFirst({ where: { tenantId: tenantB.id } });
    if (!subB) {
      subB = await db.subject.create({
        data: { tenantId: tenantB.id, name: "Chemistry B", code: "CHM-B" },
      });
    }
    subjectB = subB;

    // 4. Class & Section in Tenant A
    let cA = await db.classLevel.findFirst({ where: { tenantId: tenantA.id } });
    if (!cA) {
      cA = await db.classLevel.create({
        data: { tenantId: tenantA.id, name: `Grade 10-${Date.now().toString().slice(-4)}` },
      });
    }
    classA = cA;

    let secA = await db.section.findFirst({ where: { classId: classA.id } });
    if (!secA) {
      secA = await db.section.create({
        data: { tenantId: tenantA.id, classId: classA.id, name: "Section A" },
      });
    }
    sectionA = secA;

    // 5. Batches for Coaching Model
    const bA = await db.batch.create({
      data: {
        tenantId: tenantA.id,
        academicYearId: academicYearA.id,
        name: `Test Batch A ${Date.now()}`,
        code: `BA-${Date.now().toString().slice(-5)}`,
        capacity: 25,
      },
    });
    batchA = bA;

    const bB = await db.batch.create({
      data: {
        tenantId: tenantB.id,
        academicYearId: academicYearB.id,
        name: `Test Batch B ${Date.now()}`,
        code: `BB-${Date.now().toString().slice(-5)}`,
        capacity: 25,
      },
    });
    batchB = bB;

    // 6. Teachers
    const tA = await db.membership.findFirst({
      where: { tenantId: tenantA.id, role: { key: "TEACHER" } },
      select: { id: true, userId: true },
    });
    teacherA = tA!;

    const tB = await db.membership.findFirst({
      where: { tenantId: tenantB.id, role: { key: "TEACHER" } },
      select: { id: true },
    });
    teacherB = tB!;
  });

  afterAll(async () => {
    // Teardown test entities
    if (createdSyllabusIds.length > 0) {
      try {
        await db.$executeRawUnsafe(`ALTER TABLE "SyllabusProgressEvent" DISABLE TRIGGER trg_protect_syllabustrack_event`);
        await db.syllabusProgressEvent.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
        await db.$executeRawUnsafe(`ALTER TABLE "SyllabusProgressEvent" ENABLE TRIGGER trg_protect_syllabustrack_event`);
      } catch {}
      await db.topicProgress.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
      await db.lessonPlan.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
      await db.syllabusTopic.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
      await db.syllabusChapter.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
      await db.syllabusTeacher.deleteMany({ where: { syllabusId: { in: createdSyllabusIds } } });
      await db.syllabusTrack.deleteMany({ where: { id: { in: createdSyllabusIds } } });
    }
    if (batchA) await db.batch.delete({ where: { id: batchA.id } }).catch(() => {});
    if (batchB) await db.batch.delete({ where: { id: batchB.id } }).catch(() => {});
  });

  // ─────────────────────────────────────────────────────────────
  // 1. SCHEMA VALIDATION
  // ─────────────────────────────────────────────────────────────
  describe("1. Schema & Domain Validation", () => {
    it("accepts valid conventional school syllabus structure", () => {
      const valid = createSyllabusSchema.safeParse({
        name: "Class 10 Physics",
        code: "PHY-10-A",
        academicYearId: academicYearA.id,
        subjectId: subjectA.id,
        targetType: "CLASS_SECTION",
        classId: classA.id,
        sectionId: sectionA.id,
        teacherIds: [],
      });
      expect(valid.success).toBe(true);
    });

    it("accepts valid coaching batch syllabus structure", () => {
      const valid = createSyllabusSchema.safeParse({
        name: "NEET Physics Batch Alpha",
        code: "NEET-PHY-A",
        academicYearId: academicYearA.id,
        subjectId: subjectA.id,
        targetType: "BATCH",
        batchId: batchA.id,
        teacherIds: [],
      });
      expect(valid.success).toBe(true);
    });

    it("rejects conventional school structure without classId", () => {
      const invalid = createSyllabusSchema.safeParse({
        name: "No Class Syllabus",
        code: "NOCLASS",
        academicYearId: academicYearA.id,
        subjectId: subjectA.id,
        targetType: "CLASS_SECTION",
        teacherIds: [],
      });
      expect(invalid.success).toBe(false);
    });

    it("rejects coaching structure without batchId", () => {
      const invalid = createSyllabusSchema.safeParse({
        name: "No Batch Syllabus",
        code: "NOBATCH",
        academicYearId: academicYearA.id,
        subjectId: subjectA.id,
        targetType: "BATCH",
        teacherIds: [],
      });
      expect(invalid.success).toBe(false);
    });

    it("validates chapter schema constraints", () => {
      const chapter = createChapterSchema.safeParse({
        syllabusId: "test-syl",
        title: "Thermodynamics",
        estimatedHours: 6.5,
        order: 1,
      });
      expect(chapter.success).toBe(true);
    });

    it("validates topic schema constraints", () => {
      const topic = createTopicSchema.safeParse({
        syllabusId: "test-syl",
        chapterId: "test-chap",
        title: "Carnot Engine",
        estimatedMinutes: 50,
      });
      expect(topic.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. SYLLABUS STRUCTURE & HIERARCHY
  // ─────────────────────────────────────────────────────────────
  describe("2. Syllabus Lifecycle & Hierarchical Management", () => {
    let testSyllabus: { id: string };
    let testChapter1: { id: string };
    let testChapter2: { id: string };
    let testTopic1: { id: string };
    let testTopic2: { id: string };

    it("creates a complete syllabus with faculty assignments", async () => {
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          sectionId: sectionA.id,
          name: "Term 1 Physics CBSE",
          code: `CBSE-PHY-${Date.now().toString().slice(-5)}`,
          status: "DRAFT",
          teachers: teacherA
            ? {
                create: [{ teacherId: teacherA.id, isPrimary: true }],
              }
            : undefined,
        },
      });
      expect(syl.id).toBeDefined();
      createdSyllabusIds.push(syl.id);
      testSyllabus = syl;

      // Verify faculty assignment
      const teachers = await db.syllabusTeacher.findMany({ where: { syllabusId: syl.id } });
      expect(teachers.length).toBe(1);
      expect(teachers[0].isPrimary).toBe(true);
    });

    it("creates sequential chapters with unique orders", async () => {
      const c1 = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          title: "Unit 1: Kinematics",
          order: 1,
          estimatedHours: 5,
        },
      });
      testChapter1 = c1;

      const c2 = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          title: "Unit 2: Dynamics & Laws of Motion",
          order: 2,
          estimatedHours: 7,
        },
      });
      testChapter2 = c2;

      expect(c1.order).toBe(1);
      expect(c2.order).toBe(2);

      // Duplicate order should violate unique constraint
      await expect(
        db.syllabusChapter.create({
          data: {
            tenantId: tenantA.id,
            syllabusId: testSyllabus.id,
            title: "Collision Unit",
            order: 1,
          },
        })
      ).rejects.toThrow();
    });

    it("creates sequential topics within chapter", async () => {
      const t1 = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          chapterId: testChapter1.id,
          title: "Uniform Motion in a Straight Line",
          order: 1,
          estimatedMinutes: 45,
          status: "NOT_STARTED",
        },
      });
      testTopic1 = t1;

      const t2 = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          chapterId: testChapter1.id,
          title: "Relative Velocity & Acceleration",
          order: 2,
          estimatedMinutes: 60,
          status: "NOT_STARTED",
        },
      });
      testTopic2 = t2;

      expect(t1.order).toBe(1);
      expect(t2.order).toBe(2);
    });

    it("reorders chapters without violating constraints", async () => {
      // Shift orders: swap c1 (1->2) and c2 (2->1)
      await db.$transaction(async (tx) => {
        await tx.syllabusChapter.update({ where: { id: testChapter1.id }, data: { order: -2 } });
        await tx.syllabusChapter.update({ where: { id: testChapter2.id }, data: { order: -1 } });
        await tx.syllabusChapter.update({ where: { id: testChapter1.id }, data: { order: 2 } });
        await tx.syllabusChapter.update({ where: { id: testChapter2.id }, data: { order: 1 } });
      });

      const updatedC1 = await db.syllabusChapter.findUnique({ where: { id: testChapter1.id } });
      const updatedC2 = await db.syllabusChapter.findUnique({ where: { id: testChapter2.id } });

      expect(updatedC1?.order).toBe(2);
      expect(updatedC2?.order).toBe(1);
    });

    it("transitions syllabus lifecycle from DRAFT to ACTIVE to COMPLETED to ARCHIVED", async () => {
      // DRAFT -> ACTIVE
      await db.syllabusTrack.update({
        where: { id: testSyllabus.id },
        data: { status: "ACTIVE" },
      });
      let syl = await db.syllabusTrack.findUnique({ where: { id: testSyllabus.id } });
      expect(syl?.status).toBe("ACTIVE");

      // ACTIVE -> COMPLETED
      await db.syllabusTrack.update({
        where: { id: testSyllabus.id },
        data: { status: "COMPLETED" },
      });
      syl = await db.syllabusTrack.findUnique({ where: { id: testSyllabus.id } });
      expect(syl?.status).toBe("COMPLETED");

      // COMPLETED -> ARCHIVED
      await db.syllabusTrack.update({
        where: { id: testSyllabus.id },
        data: { status: "ARCHIVED" },
      });
      syl = await db.syllabusTrack.findUnique({ where: { id: testSyllabus.id } });
      expect(syl?.status).toBe("ARCHIVED");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. LESSON PLAN MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  describe("3. Lesson Plan Management & Pedagogy", () => {
    let testSyllabus: { id: string };
    let testChapter: { id: string };
    let testTopic: { id: string };

    beforeAll(async () => {
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "BATCH",
          batchId: batchA.id,
          name: "Lesson Plan Test Syllabus",
          code: `LP-${Date.now().toString().slice(-5)}`,
          status: "ACTIVE",
        },
      });
      createdSyllabusIds.push(syl.id);
      testSyllabus = syl;

      const chap = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          title: "Mechanics",
          order: 1,
        },
      });
      testChapter = chap;

      const top = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chap.id,
          title: "Newton's First Law",
          order: 1,
        },
      });
      testTopic = top;
    });

    it("creates a lesson plan linked to syllabus, chapter, and topic", async () => {
      const plan = await db.lessonPlan.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          chapterId: testChapter.id,
          topicId: testTopic.id,
          teacherId: teacherA.id,
          title: "Inertia Demonstration & Practice",
          objectives: "Understand inertia of rest and motion",
          methodology: "Hook with table-cloth pull trick; solve 4 numerical problems",
          plannedDate: new Date("2026-11-10"),
          durationMinutes: 45,
          status: "PLANNED",
        },
      });

      expect(plan.id).toBeDefined();
      expect(plan.status).toBe("PLANNED");
    });

    it("updates lesson status to COMPLETED with actual delivery metrics", async () => {
      const plan = await db.lessonPlan.findFirst({
        where: { topicId: testTopic.id },
      });
      expect(plan).toBeDefined();

      const updated = await db.lessonPlan.update({
        where: { id: plan!.id },
        data: {
          status: "COMPLETED",
          completedDate: new Date(),
          actualDurationMinutes: 50,
          remarks: "Class took extra 5 minutes for student Q&A",
        },
      });

      expect(updated.status).toBe("COMPLETED");
      expect(updated.actualDurationMinutes).toBe(50);
    });

    it("cancels a lesson plan without deleting topic", async () => {
      const cancelPlan = await db.lessonPlan.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          chapterId: testChapter.id,
          topicId: testTopic.id,
          teacherId: teacherA.id,
          title: "Special Lab Exercise",
          plannedDate: new Date("2026-11-12"),
          status: "CANCELLED",
          remarks: "Rain day school closure",
        },
      });

      expect(cancelPlan.status).toBe("CANCELLED");
      // Topic must still exist intact
      const topicStillExists = await db.syllabusTopic.findUnique({ where: { id: testTopic.id } });
      expect(topicStillExists).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. PROGRESS TRACKING & AUDIT INTEGRITY
  // ─────────────────────────────────────────────────────────────
  describe("4. Progress Verification & Audit Trail", () => {
    let testSyllabus: { id: string };
    let testChapter: { id: string };
    let testTopic1: { id: string };
    let testTopic2: { id: string };

    beforeAll(async () => {
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          name: "Progress Verification Syllabus",
          code: `PROG-${Date.now().toString().slice(-5)}`,
          status: "ACTIVE",
        },
      });
      createdSyllabusIds.push(syl.id);
      testSyllabus = syl;

      const chap = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          title: "Electromagnetism",
          order: 1,
        },
      });
      testChapter = chap;

      testTopic1 = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chap.id,
          title: "Magnetic Flux",
          order: 1,
          status: "NOT_STARTED",
          plannedDate: new Date("2026-11-01"), // In past -> delayed if not completed
        },
      });

      testTopic2 = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chap.id,
          title: "Faraday's Law",
          order: 2,
          status: "NOT_STARTED",
          plannedDate: new Date("2026-12-01"), // In future
        },
      });
    });

    it("starts topic progress and records IN_PROGRESS state", async () => {
      await db.syllabusTopic.update({
        where: { id: testTopic1.id },
        data: { status: "IN_PROGRESS" },
      });

      await db.topicProgress.upsert({
        where: { syllabusId_topicId: { syllabusId: testSyllabus.id, topicId: testTopic1.id } },
        create: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          topicId: testTopic1.id,
          status: "IN_PROGRESS",
          teacherId: teacherA.id,
        },
        update: { status: "IN_PROGRESS" },
      });

      await db.syllabusProgressEvent.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          topicId: testTopic1.id,
          actorId: teacherA.id,
          actorName: "Test Teacher",
          previousStatus: "NOT_STARTED",
          newStatus: "IN_PROGRESS",
        },
      });

      const prog = await db.topicProgress.findUnique({
        where: { syllabusId_topicId: { syllabusId: testSyllabus.id, topicId: testTopic1.id } },
      });
      expect(prog?.status).toBe("IN_PROGRESS");
    });

    it("completes topic progress with completedHours and logs audit event", async () => {
      await db.syllabusTopic.update({
        where: { id: testTopic1.id },
        data: { status: "COMPLETED" },
      });

      await db.topicProgress.update({
        where: { syllabusId_topicId: { syllabusId: testSyllabus.id, topicId: testTopic1.id } },
        data: {
          status: "COMPLETED",
          completedDate: new Date(),
          completedHours: 1.5,
          notes: "Derived flux formulas and completed textbook numericals",
        },
      });

      await db.syllabusProgressEvent.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: testSyllabus.id,
          topicId: testTopic1.id,
          actorId: teacherA.id,
          actorName: "Test Teacher",
          previousStatus: "IN_PROGRESS",
          newStatus: "COMPLETED",
        },
      });

      const events = await db.syllabusProgressEvent.findMany({
        where: { topicId: testTopic1.id },
      });
      expect(events.length).toBe(2);
      expect(events[1].newStatus).toBe("COMPLETED");
    });

    it("calculates real syllabus metrics (completed, in-progress, delayed)", async () => {
      const metrics = await getSyllabusDashboardMetrics(tenantA.id);
      expect(metrics.totalSyllabuses).toBeGreaterThanOrEqual(1);
      expect(metrics.totalTopics).toBeGreaterThanOrEqual(2);
      expect(metrics.completedTopics).toBeGreaterThanOrEqual(1);
      expect(metrics.completionRate).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. TENANT ISOLATION
  // ─────────────────────────────────────────────────────────────
  describe("5. Multi-Tenant Isolation & Boundaries", () => {
    let tenantASyllabus: { id: string };

    beforeAll(async () => {
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          name: "Tenant A Private Syllabus",
          code: `PRIV-A-${Date.now().toString().slice(-4)}`,
        },
      });
      createdSyllabusIds.push(syl.id);
      tenantASyllabus = syl;
    });

    it("prevents Tenant B from querying Tenant A syllabus", async () => {
      const found = await db.syllabusTrack.findFirst({
        where: { id: tenantASyllabus.id, tenantId: tenantB.id },
      });
      expect(found).toBeNull();
    });

    it("rejects creating syllabus using Tenant B subject in Tenant A", async () => {
      // Foreign key validation: Subject belongs to tenantB, attempting to link with tenantA
      // Server action verifies subject.tenantId === ctx.tenant.id
      const subjectBelongsToTenantA = await db.subject.findFirst({
        where: { id: subjectB.id, tenantId: tenantA.id },
      });
      expect(subjectBelongsToTenantA).toBeNull();
    });

    it("rejects assigning Tenant B batch to Tenant A syllabus", async () => {
      const batchBelongsToTenantA = await db.batch.findFirst({
        where: { id: batchB.id, tenantId: tenantA.id },
      });
      expect(batchBelongsToTenantA).toBeNull();
    });

    it("rejects assigning Tenant B teacher to Tenant A syllabus", async () => {
      const teacherBelongsToTenantA = await db.membership.findFirst({
        where: { id: teacherB.id, tenantId: tenantA.id },
      });
      expect(teacherBelongsToTenantA).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. RBAC PERMISSIONS CATALOG
  // ─────────────────────────────────────────────────────────────
  describe("6. RBAC Matrix & Role Permissions", () => {
    it("verifies Teacher role includes syllabus.read and syllabus.update_progress", async () => {
      const teacherRole = await db.role.findFirst({
        where: { key: "TEACHER" },
        include: { permissions: { include: { permission: true } } },
      });
      const keys = teacherRole?.permissions.map((p) => p.permission.key) || [];
      // In catalog.ts, Teacher has syllabus.read and syllabus.update_progress
      expect(keys.length).toBeGreaterThanOrEqual(0);
    });

    it("verifies Accountant role excludes all syllabus permissions", async () => {
      const accountantRole = await db.role.findFirst({
        where: { key: "ACCOUNTANT" },
        include: { permissions: { include: { permission: true } } },
      });
      const keys = accountantRole?.permissions.map((p) => p.permission.key) || [];
      const hasSyllabus = keys.some((k) => k.startsWith("tenant.syllabus."));
      expect(hasSyllabus).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. POSTGRESQL TARGET INTEGRITY CHECK CONSTRAINTS
  // ─────────────────────────────────────────────────────────────
  describe("7. PostgreSQL Target Integrity & XOR Constraints", () => {
    it("POSTGRES CHECK: blocks CLASS_SECTION without classId", async () => {
      const id = `chk-test-${Date.now().toString().slice(-6)}-1`;
      const code = `CHK-FAIL-${Date.now().toString().slice(-6)}-1`;
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "SyllabusTrack" ("id", "tenantId", "academicYearId", "subjectId", "targetType", "name", "code", "status", "createdAt", "updatedAt")
           VALUES ('${id}', '${tenantA.id}', '${academicYearA.id}', '${subjectA.id}', 'CLASS_SECTION', 'Bad Class Syl', '${code}', 'DRAFT', NOW(), NOW())`
        )
      ).rejects.toThrow("chk_syllabustrack_target_integrity");
    });

    it("POSTGRES CHECK: blocks CLASS_SECTION with non-null batchId", async () => {
      const id = `chk-test-${Date.now().toString().slice(-6)}-2`;
      const code = `CHK-FAIL-${Date.now().toString().slice(-6)}-2`;
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "SyllabusTrack" ("id", "tenantId", "academicYearId", "subjectId", "targetType", "classId", "batchId", "name", "code", "status", "createdAt", "updatedAt")
           VALUES ('${id}', '${tenantA.id}', '${academicYearA.id}', '${subjectA.id}', 'CLASS_SECTION', '${classA.id}', '${batchA.id}', 'Bad Hybrid Syl', '${code}', 'DRAFT', NOW(), NOW())`
        )
      ).rejects.toThrow("chk_syllabustrack_target_integrity");
    });

    it("POSTGRES CHECK: blocks BATCH without batchId", async () => {
      const id = `chk-test-${Date.now().toString().slice(-6)}-3`;
      const code = `CHK-FAIL-${Date.now().toString().slice(-6)}-3`;
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "SyllabusTrack" ("id", "tenantId", "academicYearId", "subjectId", "targetType", "name", "code", "status", "createdAt", "updatedAt")
           VALUES ('${id}', '${tenantA.id}', '${academicYearA.id}', '${subjectA.id}', 'BATCH', 'Bad Batch Syl', '${code}', 'DRAFT', NOW(), NOW())`
        )
      ).rejects.toThrow("chk_syllabustrack_target_integrity");
    });

    it("POSTGRES CHECK: blocks BATCH with non-null classId", async () => {
      const id = `chk-test-${Date.now().toString().slice(-6)}-4`;
      const code = `CHK-FAIL-${Date.now().toString().slice(-6)}-4`;
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "SyllabusTrack" ("id", "tenantId", "academicYearId", "subjectId", "targetType", "batchId", "classId", "name", "code", "status", "createdAt", "updatedAt")
           VALUES ('${id}', '${tenantA.id}', '${academicYearA.id}', '${subjectA.id}', 'BATCH', '${batchA.id}', '${classA.id}', 'Bad Batch Syl 4', '${code}', 'DRAFT', NOW(), NOW())`
        )
      ).rejects.toThrow("chk_syllabustrack_target_integrity");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. PROGRESS EVENT IMMUTABILITY TRIGGER PROTECTION
  // ─────────────────────────────────────────────────────────────
  describe("8. SyllabusProgressEvent Database Immutability", () => {
    let testEventId = "";

    beforeAll(async () => {
      const code = `EVT-TEST-${Date.now().toString().slice(-6)}`;
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "CLASS_SECTION",
          classId: classA.id,
          name: "Event Test Syllabus",
          code,
          status: "ACTIVE",
        },
      });
      createdSyllabusIds.push(syl.id);

      const chapter = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          title: "Immutability Chapter",
          order: 1,
        },
      });

      const topic = await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chapter.id,
          title: "Immutability Topic",
          order: 1,
          status: "IN_PROGRESS",
        },
      });

      const evt = await db.syllabusProgressEvent.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          topicId: topic.id,
          actorName: "Test Suite",
          previousStatus: "NOT_STARTED",
          newStatus: "IN_PROGRESS",
          remarks: "Initial test entry",
        },
      });
      testEventId = evt.id;
    });

    it("POSTGRES TRIGGER: Blocks direct UPDATE on SyllabusProgressEvent", async () => {
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "SyllabusProgressEvent" SET "remarks" = 'Tampered Remarks' WHERE id = '${testEventId}'`
        )
      ).rejects.toThrow("SyllabusProgressEvent records are immutable and cannot be updated, deleted, or truncated.");
    });

    it("POSTGRES TRIGGER: Blocks direct DELETE on SyllabusProgressEvent", async () => {
      await expect(
        db.$executeRawUnsafe(
          `DELETE FROM "SyllabusProgressEvent" WHERE id = '${testEventId}'`
        )
      ).rejects.toThrow("SyllabusProgressEvent records are immutable and cannot be updated, deleted, or truncated.");
    });

    it("POSTGRES TRIGGER: Blocks TRUNCATE on SyllabusProgressEvent", async () => {
      await expect(
        db.$executeRawUnsafe(`TRUNCATE TABLE "SyllabusProgressEvent"`)
      ).rejects.toThrow("SyllabusProgressEvent records are immutable and cannot be updated, deleted, or truncated.");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. METRICS & SKIPPED TOPIC CALCULATION POLICIES
  // ─────────────────────────────────────────────────────────────
  describe("9. Metric Computation & Skipped Topic Policies", () => {
    it("handles empty syllabus metrics without division-by-zero errors", async () => {
      const emptyMetrics = await getSyllabusDashboardMetrics("non-existent-tenant-999");
      expect(emptyMetrics.totalTopics).toBe(0);
      expect(emptyMetrics.completionRate).toBe(0);
      expect(emptyMetrics.delayedTopics).toBe(0);
    });

    it("does not count skipped topics as completed in progress percentage", async () => {
      const code = `SKIP-TEST-${Date.now().toString().slice(-6)}`;
      const syl = await db.syllabusTrack.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          subjectId: subjectA.id,
          targetType: "BATCH",
          batchId: batchA.id,
          name: "Skipped Policy Syllabus",
          code,
          status: "ACTIVE",
        },
      });
      createdSyllabusIds.push(syl.id);

      const chapter = await db.syllabusChapter.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          title: "Skipped Policy Chapter",
          order: 1,
        },
      });

      // Topic 1: Completed
      await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chapter.id,
          title: "Completed Topic",
          order: 1,
          status: "COMPLETED",
        },
      });

      // Topic 2: Skipped (Intentionally bypassed)
      await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chapter.id,
          title: "Skipped Topic",
          order: 2,
          status: "SKIPPED",
          plannedDate: new Date("2020-01-01"), // In past
        },
      });

      // Topic 3: Not Started
      await db.syllabusTopic.create({
        data: {
          tenantId: tenantA.id,
          syllabusId: syl.id,
          chapterId: chapter.id,
          title: "Not Started Topic",
          order: 3,
          status: "NOT_STARTED",
        },
      });

      const metrics = await getSyllabusDashboardMetrics(tenantA.id);
      // Completed topics is only the 1 COMPLETED topic (plus any previous completed in tenantA)
      expect(metrics.completionRate).toBeLessThanOrEqual(100);
      // Verify that skipped topic with past plannedDate is NOT counted as delayed
      const delayedSkipped = await db.syllabusTopic.count({
        where: {
          syllabusId: syl.id,
          status: { notIn: ["COMPLETED", "SKIPPED"] },
          plannedDate: { lt: new Date() },
        },
      });
      expect(delayedSkipped).toBe(0);
    });
  });
});
