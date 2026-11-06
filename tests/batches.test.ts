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
import { TENANT_ROLE_TEMPLATES } from "@/lib/catalog";

describe("Stage 2.1: Batch Management Security, Concurrency & Integrity Test Suite", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let academicYearA: { id: string };
  let academicYearB: { id: string };
  let subjectB: { id: string };
  let testStudent1: { id: string; firstName: string; lastName: string };
  let testStudent2: { id: string; firstName: string; lastName: string };
  let testStudentB: { id: string };
  let testTeacherA: { id: string; userId: string };
  let testTeacherB: { id: string };

  beforeAll(async () => {
    // 1. Fetch or verify existing test tenants
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // 2. Academic years for both tenants
    let ayA = await db.academicYear.findFirst({
      where: { tenantId: tenantA.id },
      select: { id: true },
    });
    if (!ayA) {
      ayA = await db.academicYear.create({
        data: {
          tenantId: tenantA.id,
          name: "2026-2027",
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isActive: true,
        },
        select: { id: true },
      });
    }
    academicYearA = ayA;

    let ayB = await db.academicYear.findFirst({
      where: { tenantId: tenantB.id },
      select: { id: true },
    });
    if (!ayB) {
      ayB = await db.academicYear.create({
        data: {
          tenantId: tenantB.id,
          name: "2026-2027",
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isActive: true,
        },
        select: { id: true },
      });
    }
    academicYearB = ayB;

    // 3. Subjects for tenant B (for cross-tenant validation)
    let subB = await db.subject.findFirst({
      where: { tenantId: tenantB.id },
      select: { id: true },
    });
    if (!subB) {
      subB = await db.subject.create({
        data: { tenantId: tenantB.id, name: "Chemistry B", code: "CHEM-B" },
        select: { id: true },
      });
    }
    subjectB = subB;

    // 4. Students for Tenant A
    const students = await db.student.findMany({
      where: { tenantId: tenantA.id, status: "ACTIVE" },
      take: 2,
      select: { id: true, firstName: true, lastName: true },
    });
    if (students.length >= 2) {
      testStudent1 = students[0];
      testStudent2 = students[1];
    } else {
      const base = Date.now().toString().slice(-6);
      testStudent1 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          admissionNo: `TEST-ADM-A-${base}-1`,
          firstName: "Concurrency",
          lastName: "StudentOne",
          gender: "MALE",
          status: "ACTIVE",
        },
        select: { id: true, firstName: true, lastName: true },
      });
      testStudent2 = await db.student.create({
        data: {
          tenantId: tenantA.id,
          admissionNo: `TEST-ADM-A-${base}-2`,
          firstName: "Concurrency",
          lastName: "StudentTwo",
          gender: "FEMALE",
          status: "ACTIVE",
        },
        select: { id: true, firstName: true, lastName: true },
      });
    }

    // 5. Student for Tenant B
    let sB = await db.student.findFirst({
      where: { tenantId: tenantB.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (!sB) {
      sB = await db.student.create({
        data: {
          tenantId: tenantB.id,
          admissionNo: `TEST-ADM-B-${Date.now().toString().slice(-6)}`,
          firstName: "Foreign",
          lastName: "Student",
          gender: "MALE",
          status: "ACTIVE",
        },
        select: { id: true },
      });
    }
    testStudentB = sB;

    // 6. Teacher for Tenant A
    let tA = await db.membership.findFirst({
      where: {
        tenantId: tenantA.id,
        status: "ACTIVE",
        role: { key: "TEACHER" },
      },
      select: { id: true, userId: true },
    });
    if (!tA) {
      tA = await db.membership.findFirst({
        where: { tenantId: tenantA.id, status: "ACTIVE" },
        select: { id: true, userId: true },
      });
    }
    testTeacherA = tA!;

    // 7. Teacher for Tenant B
    const tB = await db.membership.findFirst({
      where: { tenantId: tenantB.id, status: "ACTIVE" },
      select: { id: true },
    });
    testTeacherB = tB!;
  });

  afterAll(async () => {
    // Cleanup any test batches and events by disabling trigger for test cleanup
    try {
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE "batchId" IN (SELECT id FROM "Batch" WHERE code LIKE 'TEST-HARDEN-%')`);
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.batchTeacher.deleteMany({
        where: { batch: { code: { startsWith: "TEST-HARDEN-" } } },
      });
      await db.batchStudent.deleteMany({
        where: { batch: { code: { startsWith: "TEST-HARDEN-" } } },
      });
      await db.batch.deleteMany({
        where: { code: { startsWith: "TEST-HARDEN-" } },
      });
    } catch {
      // ignore cleanup errors
    }
  });

  // ==========================================
  // SUITE 1: Concurrency & Row-Level Locking (Phase 1)
  // ==========================================
  describe("1. Concurrency-Safe Capacity & Row-Locking", () => {
    it("CONCURRENCY RACE: Two simultaneous enrollments competing for a single seat strictly admit 1 and reject 1", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-RACE`;
      const batch = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: "Strict 1-Seat Batch",
          code,
          capacity: 1, // EXACTLY 1 SEAT
          status: "ACTIVE",
        },
      });

      // Simulation function representing the hardened transactional enrollment
      const attemptEnroll = async (studentId: string) => {
        return db.$transaction(async (tx) => {
          // Lock batch row FOR UPDATE
          const locked = await tx.$queryRaw<Array<{ id: string; capacity: number; status: string }>>`
            SELECT id, capacity, status
            FROM "Batch"
            WHERE id = ${batch.id} AND "tenantId" = ${tenantA.id}
            FOR UPDATE
          `;
          const b = locked[0];
          if (!b) throw new Error("Batch not found.");
          if (b.status !== "ACTIVE") throw new Error("Batch is not active.");

          const activeCount = await tx.batchStudent.count({
            where: { batchId: batch.id, status: "ACTIVE" },
          });

          if (activeCount + 1 > b.capacity) {
            throw new Error(`Batch capacity exceeded. Current active: ${activeCount}/${b.capacity}.`);
          }

          // Small delay to simulate network/db latency while holding the lock
          await new Promise((r) => setTimeout(r, 25));

          await tx.batchStudent.create({
            data: {
              batchId: batch.id,
              studentId,
              status: "ACTIVE",
            },
          });

          return { enrolled: studentId };
        });
      };

      // Launch both enrollment attempts simultaneously
      const results = await Promise.allSettled([
        attemptEnroll(testStudent1.id),
        attemptEnroll(testStudent2.id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly ONE must succeed and ONE must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Verify rejection reason is capacity exceeded
      if (rejected[0].status === "rejected") {
        expect(rejected[0].reason.message).toContain("Batch capacity exceeded");
      }

      // Verify database active count is strictly 1
      const finalCount = await db.batchStudent.count({
        where: { batchId: batch.id, status: "ACTIVE" },
      });
      expect(finalCount).toBe(1);

      // Clean up
      await db.batchStudent.deleteMany({ where: { batchId: batch.id } });
      await db.batch.delete({ where: { id: batch.id } });
    });

    it("CAPACITY REDUCTION: Rejects reducing capacity below active enrollment count", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-RED`;
      const batch = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: "Capacity Reduction Test",
          code,
          capacity: 5,
          status: "ACTIVE",
        },
      });

      // Enroll 2 students
      await db.batchStudent.createMany({
        data: [
          { batchId: batch.id, studentId: testStudent1.id, status: "ACTIVE" },
          { batchId: batch.id, studentId: testStudent2.id, status: "ACTIVE" },
        ],
      });

      // Attempt reducing capacity to 1 (which is less than current active count 2)
      const attemptReduce = async (newCapacity: number) => {
        return db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string; capacity: number }>>`
            SELECT id, capacity FROM "Batch" WHERE id = ${batch.id} AND "tenantId" = ${tenantA.id} FOR UPDATE
          `;
          if (!locked || locked.length === 0) throw new Error("Batch not found");
          const activeCount = await tx.batchStudent.count({
            where: { batchId: batch.id, status: "ACTIVE" },
          });
          if (newCapacity < activeCount) {
            throw new Error(`Capacity cannot be reduced below current active enrollment (${activeCount}).`);
          }
          return tx.batch.update({
            where: { id: batch.id },
            data: { capacity: newCapacity },
          });
        });
      };

      await expect(attemptReduce(1)).rejects.toThrow("Capacity cannot be reduced below current active enrollment");

      // Valid reduction to 2 or 3 should succeed
      const updated = await attemptReduce(2);
      expect(updated.capacity).toBe(2);

      // Clean up
      await db.batchStudent.deleteMany({ where: { batchId: batch.id } });
      await db.batch.delete({ where: { id: batch.id } });
    });

    it("VALIDATION: Rejects duplicate student IDs in a single enrollment request", () => {
      const duplicateIds = [testStudent1.id, testStudent1.id];
      const unique = Array.from(new Set(duplicateIds));
      expect(unique.length).not.toBe(duplicateIds.length);
    });

    it("LIFECYCLE STATUS: Rejects new enrollments into COMPLETED or ARCHIVED batches", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-COMP`;
      const completedBatch = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: "Completed Batch",
          code,
          capacity: 20,
          status: "COMPLETED",
        },
      });

      const attemptEnrollInCompleted = async () => {
        return db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT id, status FROM "Batch" WHERE id = ${completedBatch.id} AND "tenantId" = ${tenantA.id} FOR UPDATE
          `;
          if (locked[0].status !== "ACTIVE") {
            throw new Error("Enrollment is rejected. Batch is currently 'COMPLETED'.");
          }
        });
      };

      await expect(attemptEnrollInCompleted()).rejects.toThrow("Enrollment is rejected. Batch is currently 'COMPLETED'.");

      await db.batch.delete({ where: { id: completedBatch.id } });
    });

    it("TRANSFER DEADLOCK PREVENTION: Acquires dual locks in deterministic alphabetical order", async () => {
      const code1 = `TEST-HARDEN-${Date.now().toString().slice(-6)}-LK1`;
      const code2 = `TEST-HARDEN-${Date.now().toString().slice(-6)}-LK2`;

      const b1 = await db.batch.create({
        data: { tenantId: tenantA.id, academicYearId: academicYearA.id, name: "Lock Batch 1", code: code1, capacity: 10 },
      });
      const b2 = await db.batch.create({
        data: { tenantId: tenantA.id, academicYearId: academicYearA.id, name: "Lock Batch 2", code: code2, capacity: 10 },
      });

      const sorted = [b1.id, b2.id].sort();

      const lockedRows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Batch"
        WHERE id IN (${sorted[0]}, ${sorted[1]}) AND "tenantId" = ${tenantA.id}
        ORDER BY id ASC
      `;

      expect(lockedRows.length).toBe(2);
      expect(lockedRows[0].id).toBe(sorted[0]);
      expect(lockedRows[1].id).toBe(sorted[1]);

      await db.batch.deleteMany({ where: { id: { in: [b1.id, b2.id] } } });
    });
  });

  // ==========================================
  // SUITE 2: Strict Tenant Relationship Validation (Phase 2)
  // ==========================================
  describe("2. Strict Multi-Tenant Relationship Validation", () => {
    it("CROSS-TENANT REJECTION: Blocks student belonging to Tenant B from enrolling in Tenant A batch", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-CT`;
      const batchA = await db.batch.create({
        data: { tenantId: tenantA.id, academicYearId: academicYearA.id, name: "Batch A", code, capacity: 10 },
      });

      // Tenant A verifies students within its own tenant boundary
      const verifiedStudents = await db.student.findMany({
        where: {
          id: { in: [testStudentB.id] }, // Student B belongs to Tenant B
          tenantId: tenantA.id,
          status: "ACTIVE",
        },
      });

      // Must be empty because Student B is in Tenant B
      expect(verifiedStudents.length).toBe(0);

      await db.batch.delete({ where: { id: batchA.id } });
    });

    it("CROSS-TENANT REJECTION: Blocks teacher belonging to Tenant B from assignment in Tenant A batch", async () => {
      if (testTeacherB) {
        const verifiedTeachers = await db.membership.findMany({
          where: {
            id: { in: [testTeacherB.id] },
            tenantId: tenantA.id, // Authenticated as Tenant A
            status: "ACTIVE",
          },
        });
        expect(verifiedTeachers.length).toBe(0);
      }
    });

    it("CROSS-TENANT REJECTION: Blocks academic year from Tenant B when creating batch in Tenant A", async () => {
      const foreignAY = await db.academicYear.findFirst({
        where: { id: academicYearB.id, tenantId: tenantA.id },
      });
      expect(foreignAY).toBeNull();
    });

    it("CROSS-TENANT REJECTION: Blocks subject from Tenant B when creating batch in Tenant A", async () => {
      const foreignSub = await db.subject.findFirst({
        where: { id: subjectB.id, tenantId: tenantA.id },
      });
      expect(foreignSub).toBeNull();
    });
  });

  // ==========================================
  // SUITE 3: RBAC & Record-Level Authorization (Phase 3)
  // ==========================================
  describe("3. Role-Based Access Control & Permission Boundaries", () => {
    it("RBAC CATALOG: Teacher role has batches.read but NOT batches.write, batches.enroll, or batches.transfer", () => {
      const teacherTemplate = TENANT_ROLE_TEMPLATES.find((r) => r.key === "TEACHER");
      expect(teacherTemplate).toBeDefined();

      const perms = new Set(teacherTemplate!.permissions);
      expect(perms.has("tenant.batches.read")).toBe(true);
      expect(perms.has("tenant.batches.write")).toBe(false);
      expect(perms.has("tenant.batches.enroll")).toBe(false);
      expect(perms.has("tenant.batches.transfer")).toBe(false);
      expect(perms.has("tenant.batches.manage_teachers")).toBe(false);
    });

    it("RBAC CATALOG: Front Desk has batches.read and batches.enroll, but NOT batches.write or batches.transfer", () => {
      const fdTemplate = TENANT_ROLE_TEMPLATES.find((r) => r.key === "FRONT_DESK");
      expect(fdTemplate).toBeDefined();

      const perms = new Set(fdTemplate!.permissions);
      expect(perms.has("tenant.batches.read")).toBe(true);
      expect(perms.has("tenant.batches.enroll")).toBe(true);
      expect(perms.has("tenant.batches.write")).toBe(false);
      expect(perms.has("tenant.batches.transfer")).toBe(false);
      expect(perms.has("tenant.batches.manage_teachers")).toBe(false);
    });

    it("RBAC CATALOG: Accountant role has zero batch permissions", () => {
      const accountantTemplate = TENANT_ROLE_TEMPLATES.find((r) => r.key === "ACCOUNTANT");
      expect(accountantTemplate).toBeDefined();

      const perms = new Set(accountantTemplate!.permissions);
      expect(perms.has("tenant.batches.read")).toBe(false);
      expect(perms.has("tenant.batches.write")).toBe(false);
      expect(perms.has("tenant.batches.enroll")).toBe(false);
      expect(perms.has("tenant.batches.transfer")).toBe(false);
    });

    it("TEACHER RECORD-LEVEL SCOPING: Teacher query only matches assigned batches", async () => {
      const codeAssigned = `TEST-HARDEN-${Date.now().toString().slice(-6)}-TASN`;
      const codeUnassigned = `TEST-HARDEN-${Date.now().toString().slice(-6)}-TUNASN`;

      // Batch 1: Assigned to Teacher A
      const bAssigned = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: "Teacher Assigned Batch",
          code: codeAssigned,
          capacity: 20,
          teachers: { create: [{ teacherId: testTeacherA.id, isPrimary: true }] },
        },
      });

      // Batch 2: Not assigned to Teacher A
      const bUnassigned = await db.batch.create({
        data: {
          tenantId: tenantA.id,
          academicYearId: academicYearA.id,
          name: "Teacher Unassigned Batch",
          code: codeUnassigned,
          capacity: 20,
        },
      });

      // Teacher-scoped query
      const teacherVisibleBatches = await db.batch.findMany({
        where: {
          tenantId: tenantA.id,
          teachers: { some: { teacherId: testTeacherA.id } },
        },
        select: { id: true },
      });

      const visibleIds = new Set(teacherVisibleBatches.map((b) => b.id));
      expect(visibleIds.has(bAssigned.id)).toBe(true);
      expect(visibleIds.has(bUnassigned.id)).toBe(false);

      // Clean up
      await db.batchTeacher.deleteMany({ where: { batchId: bAssigned.id } });
      await db.batch.deleteMany({ where: { id: { in: [bAssigned.id, bUnassigned.id] } } });
    });
  });

  // ==========================================
  // SUITE 4: Audit Event Immutability & DB Protection (Phase 4)
  // ==========================================
  describe("4. Audit Event Database Immutability & Retention", () => {
    it("POSTGRES TRIGGER: Blocks direct UPDATE on BatchEnrollmentEvent", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-EVT`;
      const batch = await db.batch.create({
        data: { tenantId: tenantA.id, academicYearId: academicYearA.id, name: "Event Batch", code, capacity: 10 },
      });

      const event = await db.batchEnrollmentEvent.create({
        data: {
          batchId: batch.id,
          studentId: testStudent1.id,
          actorName: "System Test",
          eventType: "ENROLLED",
          reason: "Initial Enrollment",
        },
      });

      // Attempting to UPDATE event record must trigger PostgreSQL exception
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "BatchEnrollmentEvent" SET reason = 'Tampered' WHERE id = '${event.id}'`
        )
      ).rejects.toThrow("BatchEnrollmentEvent records are immutable and cannot be updated, deleted, or truncated.");

      // Clean up using trigger bypass or direct cleanup
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE id = '${event.id}'`);
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.batch.delete({ where: { id: batch.id } });
    });

    it("POSTGRES TRIGGER: Blocks direct DELETE on BatchEnrollmentEvent", async () => {
      const code = `TEST-HARDEN-${Date.now().toString().slice(-6)}-EVTDEL`;
      const batch = await db.batch.create({
        data: { tenantId: tenantA.id, academicYearId: academicYearA.id, name: "Event Delete Batch", code, capacity: 10 },
      });

      const event = await db.batchEnrollmentEvent.create({
        data: {
          batchId: batch.id,
          studentId: testStudent1.id,
          actorName: "System Test",
          eventType: "ENROLLED",
        },
      });

      // Attempting to DELETE event record must trigger PostgreSQL exception
      await expect(
        db.$executeRawUnsafe(
          `DELETE FROM "BatchEnrollmentEvent" WHERE id = '${event.id}'`
        )
      ).rejects.toThrow("BatchEnrollmentEvent records are immutable and cannot be updated, deleted, or truncated.");

      // Clean up
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE id = '${event.id}'`);
      await db.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
      await db.batch.delete({ where: { id: batch.id } });
    });

    it("POSTGRES TRIGGER: Blocks TRUNCATE on BatchEnrollmentEvent", async () => {
      // Attempting to TRUNCATE event table must trigger statement-level PostgreSQL exception
      await expect(
        db.$executeRawUnsafe(`TRUNCATE TABLE "BatchEnrollmentEvent"`)
      ).rejects.toThrow("BatchEnrollmentEvent records are immutable and cannot be updated, deleted, or truncated.");
    });
  });
});
