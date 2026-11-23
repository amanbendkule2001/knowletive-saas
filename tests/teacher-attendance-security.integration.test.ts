import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { executeApprovedTool } from "@/lib/ai-gateway";
import { resolveChatIntents } from "@/app/api/copilot/chat/route";
import {
  getAttendanceSummary,
  getStudentAttendanceDetails,
  APPROVED_TOOLS_REGISTRY,
  TOOL_PERMISSION_MAP,
} from "@/lib/ai-tools";
import type { TenantContext, AuthUser, TenantAccess } from "@/lib/auth";

describe("Teacher Copilot Attendance Security & Student-Level Analytics Integration Test", () => {
  let tenantA: { id: string; name: string; slug: string; type: any; timezone: string | null };
  let tenantB: { id: string; name: string; slug: string; type: any; timezone: string | null };

  let academicYearA: { id: string };

  let userTeacherA: any;
  let userTeacherB: any;
  let membershipTeacherA: any;
  let membershipTeacherB: any;

  let userOwnerA: any;
  let membershipOwnerA: any;

  let batchA: any;
  let batchB: any;

  let studentA1: any;
  let studentA2: any;
  let studentA3: any;
  let studentB1: any;

  let teacherContextA: TenantContext;
  let teacherContextB: TenantContext;
  let ownerContextA: TenantContext;
  let unauthorizedContext: TenantContext;

  const createdAttendanceIds: string[] = [];
  const createdBatchStudentIds: string[] = [];
  const createdBatchTeacherIds: string[] = [];
  const createdStudentIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdMembershipIds: string[] = [];
  const createdUserIds: string[] = [];
  let createdAcademicYearId: string | null = null;

  beforeAll(async () => {
    // 1. Locate live tenants
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true, slug: true, type: true, timezone: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // 2. Locate or create Academic Year for Tenant A
    let ay = await db.academicYear.findFirst({
      where: { tenantId: tenantA.id },
    });
    if (!ay) {
      ay = await db.academicYear.create({
        data: {
          tenantId: tenantA.id,
          name: `Test AY ${Date.now()}`,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
          isActive: true,
        },
      });
      createdAcademicYearId = ay.id;
    }
    academicYearA = ay;

    // Locate Teacher Role
    let teacherRole = await db.role.findFirst({
      where: {
        OR: [
          { tenantId: tenantA.id, key: "TEACHER" },
          { key: "TEACHER", isSystem: true },
        ],
      },
    });
    if (!teacherRole) {
      teacherRole = await db.role.create({
        data: {
          tenantId: tenantA.id,
          key: "TEACHER",
          name: "Teacher",
          isSystem: false,
        },
      });
    }

    // 3. Create realistic test Users & Memberships
    const stamp = Date.now();
    userTeacherA = await db.user.create({
      data: {
        name: `Sec Teacher A ${stamp}`,
        email: `teacher_a_${stamp}@knowletive.test`,
        passwordHash: "dummy_hashed_password",
      },
    });
    createdUserIds.push(userTeacherA.id);

    membershipTeacherA = await db.membership.create({
      data: {
        tenant: { connect: { id: tenantA.id } },
        user: { connect: { id: userTeacherA.id } },
        role: { connect: { id: teacherRole.id } },
        status: "ACTIVE",
      },
    });
    createdMembershipIds.push(membershipTeacherA.id);

    userTeacherB = await db.user.create({
      data: {
        name: `Sec Teacher B ${stamp}`,
        email: `teacher_b_${stamp}@knowletive.test`,
        passwordHash: "dummy_hashed_password",
      },
    });
    createdUserIds.push(userTeacherB.id);

    membershipTeacherB = await db.membership.create({
      data: {
        tenant: { connect: { id: tenantA.id } },
        user: { connect: { id: userTeacherB.id } },
        role: { connect: { id: teacherRole.id } },
        status: "ACTIVE",
      },
    });
    createdMembershipIds.push(membershipTeacherB.id);

    // Locate or create Institute Owner for Tenant A
    const existingOwner = await db.membership.findFirst({
      where: { tenantId: tenantA.id, isOwner: true },
      include: { user: true, role: true },
    });
    if (existingOwner) {
      userOwnerA = existingOwner.user;
      membershipOwnerA = existingOwner;
    } else {
      userOwnerA = await db.user.create({
        data: {
          name: `Sec Owner ${stamp}`,
          email: `owner_${stamp}@knowletive.test`,
          passwordHash: "dummy_hashed_password",
        },
      });
      createdUserIds.push(userOwnerA.id);
      membershipOwnerA = await db.membership.create({
        data: {
          tenant: { connect: { id: tenantA.id } },
          user: { connect: { id: userOwnerA.id } },
          role: { connect: { id: teacherRole.id } },
          isOwner: true,
          status: "ACTIVE",
        },
      });
      createdMembershipIds.push(membershipOwnerA.id);
    }

    // 4. Create Batches
    batchA = await db.batch.create({
      data: {
        tenantId: tenantA.id,
        academicYearId: academicYearA.id,
        name: `Sec Batch A ${stamp}`,
        code: `BA_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdBatchIds.push(batchA.id);

    batchB = await db.batch.create({
      data: {
        tenantId: tenantA.id,
        academicYearId: academicYearA.id,
        name: `Sec Batch B ${stamp}`,
        code: `BB_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdBatchIds.push(batchB.id);

    // 5. Assign Teachers to Batches
    // Teacher A -> Batch A
    const btA = await db.batchTeacher.create({
      data: {
        batchId: batchA.id,
        teacherId: membershipTeacherA.id,
        isPrimary: true,
      },
    });
    createdBatchTeacherIds.push(btA.id);

    // Teacher B -> Batch B
    const btB = await db.batchTeacher.create({
      data: {
        batchId: batchB.id,
        teacherId: membershipTeacherB.id,
        isPrimary: true,
      },
    });
    createdBatchTeacherIds.push(btB.id);

    // 6. Create Students
    // Student A1: Batch A (100% attendance: 3 PRESENT, 1 LATE = 4/4)
    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        firstName: "Aarav",
        lastName: `Sharma_${stamp}`,
        admissionNo: `ADM_A1_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdStudentIds.push(studentA1.id);

    // Student A2: Batch A (25% attendance: 1 PRESENT, 2 ABSENT, 1 EXCUSED = 1/4 -> below 75%)
    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        firstName: "Diya",
        lastName: `Patel_${stamp}`,
        admissionNo: `ADM_A2_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdStudentIds.push(studentA2.id);

    // Student A3: Batch A (0 sessions marked)
    studentA3 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        firstName: "Rohan",
        lastName: `Verma_${stamp}`,
        admissionNo: `ADM_A3_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdStudentIds.push(studentA3.id);

    // Student B1: Batch B (100% attendance: 4 PRESENT)
    studentB1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        firstName: "Kavya",
        lastName: `Nair_${stamp}`,
        admissionNo: `ADM_B1_${stamp}`,
        status: "ACTIVE",
      },
    });
    createdStudentIds.push(studentB1.id);

    // Enrol students in batches
    const bsA1 = await db.batchStudent.create({
      data: { batchId: batchA.id, studentId: studentA1.id, status: "ACTIVE" },
    });
    createdBatchStudentIds.push(bsA1.id);

    const bsA2 = await db.batchStudent.create({
      data: { batchId: batchA.id, studentId: studentA2.id, status: "ACTIVE" },
    });
    createdBatchStudentIds.push(bsA2.id);

    const bsA3 = await db.batchStudent.create({
      data: { batchId: batchA.id, studentId: studentA3.id, status: "ACTIVE" },
    });
    createdBatchStudentIds.push(bsA3.id);

    const bsB1 = await db.batchStudent.create({
      data: { batchId: batchB.id, studentId: studentB1.id, status: "ACTIVE" },
    });
    createdBatchStudentIds.push(bsB1.id);

    // 7. Create realistic Attendance records
    // Base dates
    const d1 = new Date("2026-11-01T00:00:00.000Z");
    const d2 = new Date("2026-11-02T00:00:00.000Z");
    const d3 = new Date("2026-11-03T00:00:00.000Z");
    const d4 = new Date("2026-11-04T00:00:00.000Z");

    const records = [
      // Student A1
      { tenantId: tenantA.id, studentId: studentA1.id, date: d1, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentA1.id, date: d2, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentA1.id, date: d3, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentA1.id, date: d4, status: "LATE" as const },

      // Student A2
      { tenantId: tenantA.id, studentId: studentA2.id, date: d1, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentA2.id, date: d2, status: "ABSENT" as const },
      { tenantId: tenantA.id, studentId: studentA2.id, date: d3, status: "ABSENT" as const },
      { tenantId: tenantA.id, studentId: studentA2.id, date: d4, status: "EXCUSED" as const },

      // Student B1 (Batch B)
      { tenantId: tenantA.id, studentId: studentB1.id, date: d1, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentB1.id, date: d2, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentB1.id, date: d3, status: "PRESENT" as const },
      { tenantId: tenantA.id, studentId: studentB1.id, date: d4, status: "PRESENT" as const },
    ];

    for (const r of records) {
      const att = await db.attendance.create({ data: r });
      createdAttendanceIds.push(att.id);
    }

    // 8. Construct test TenantContext objects
    const baseTenant = {
      id: tenantA.id,
      name: tenantA.name,
      slug: tenantA.slug,
      status: "ACTIVE",
      type: tenantA.type,
      timezone: tenantA.timezone || "Asia/Kolkata",
      subscription: {
        id: "sub_test",
        tenantId: tenantA.id,
        status: "ACTIVE",
        plan: { id: "plan_test", name: "Pro", features: ["ai"] },
      },
    } as any;

    teacherContextA = {
      user: {
        id: userTeacherA.id,
        name: userTeacherA.name,
        email: userTeacherA.email,
        avatarColor: "#059669",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: baseTenant,
      membership: {
        id: membershipTeacherA.id,
        tenantId: tenantA.id,
        tenantName: tenantA.name,
        tenantSlug: tenantA.slug,
        tenantStatus: "ACTIVE",
        tenantType: tenantA.type,
        roleId: null,
        roleName: "Teacher",
        roleKey: "TEACHER",
        isOwner: false,
        permissions: [
          "tenant.ai.copilot",
          "tenant.ai.analytics.attendance",
          "tenant.attendance.read",
          "tenant.students.read",
        ],
      } as TenantAccess,
      permissions: new Set([
        "tenant.ai.copilot",
        "tenant.ai.analytics.attendance",
        "tenant.attendance.read",
        "tenant.students.read",
      ]),
      isOwnerView: false,
      subscriptionBlocked: false,
    };

    teacherContextB = {
      user: {
        id: userTeacherB.id,
        name: userTeacherB.name,
        email: userTeacherB.email,
        avatarColor: "#059669",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: baseTenant,
      membership: {
        id: membershipTeacherB.id,
        tenantId: tenantA.id,
        tenantName: tenantA.name,
        tenantSlug: tenantA.slug,
        tenantStatus: "ACTIVE",
        tenantType: tenantA.type,
        roleId: null,
        roleName: "Teacher",
        roleKey: "TEACHER",
        isOwner: false,
        permissions: [
          "tenant.ai.copilot",
          "tenant.ai.analytics.attendance",
          "tenant.attendance.read",
          "tenant.students.read",
        ],
      } as TenantAccess,
      permissions: new Set([
        "tenant.ai.copilot",
        "tenant.ai.analytics.attendance",
        "tenant.attendance.read",
        "tenant.students.read",
      ]),
      isOwnerView: false,
      subscriptionBlocked: false,
    };

    ownerContextA = {
      user: {
        id: userOwnerA.id,
        name: userOwnerA.name,
        email: userOwnerA.email,
        avatarColor: "#4f46e5",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: baseTenant,
      membership: {
        id: membershipOwnerA.id,
        tenantId: tenantA.id,
        tenantName: tenantA.name,
        tenantSlug: tenantA.slug,
        tenantStatus: "ACTIVE",
        tenantType: tenantA.type,
        roleId: membershipOwnerA.roleId,
        roleName: "Institute Owner",
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
        permissions: [
          "tenant.ai.copilot",
          "tenant.ai.analytics.attendance",
          "tenant.attendance.read",
          "tenant.students.read",
        ],
      } as TenantAccess,
      permissions: new Set([
        "tenant.ai.copilot",
        "tenant.ai.analytics.attendance",
        "tenant.attendance.read",
        "tenant.students.read",
      ]),
      isOwnerView: true,
      subscriptionBlocked: false,
    };

    unauthorizedContext = {
      ...teacherContextA,
      membership: {
        ...teacherContextA.membership!,
        roleKey: "PARENT",
        roleName: "Parent",
        permissions: ["tenant.portal.read"],
      },
      permissions: new Set(["tenant.portal.read"]),
    };
  });

  afterAll(async () => {
    // Clean up created test entities to avoid contaminating database
    if (createdAttendanceIds.length > 0) {
      await db.attendance.deleteMany({ where: { id: { in: createdAttendanceIds } } });
    }
    if (createdBatchStudentIds.length > 0) {
      await db.batchStudent.deleteMany({ where: { id: { in: createdBatchStudentIds } } });
    }
    if (createdBatchTeacherIds.length > 0) {
      await db.batchTeacher.deleteMany({ where: { id: { in: createdBatchTeacherIds } } });
    }
    if (createdStudentIds.length > 0) {
      await db.student.deleteMany({ where: { id: { in: createdStudentIds } } });
    }
    if (createdBatchIds.length > 0) {
      await db.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
    }
    if (createdAcademicYearId) {
      await db.academicYear.deleteMany({ where: { id: createdAcademicYearId } });
    }
    if (createdMembershipIds.length > 0) {
      await db.membership.deleteMany({ where: { id: { in: createdMembershipIds } } });
    }
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  // =========================================================================
  // OBJECTIVE 6: 12 REQUIRED AUTOMATED SECURITY & FUNCTIONAL TESTS
  // =========================================================================

  it("1. Teacher A sees only attendance from assigned batch A", async () => {
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      { thresholdPercentage: 75 },
      teacherContextA,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const data = res.data as any;
    expect(data.records).toBeDefined();

    // Must contain Batch A students
    const returnedStudentIds = data.records.map((r: any) => r.studentId);
    expect(returnedStudentIds).toContain(studentA1.id);
    expect(returnedStudentIds).toContain(studentA2.id);
    expect(returnedStudentIds).toContain(studentA3.id);

    // Must NEVER contain Batch B student
    expect(returnedStudentIds).not.toContain(studentB1.id);
  });

  it("2. Teacher A cannot query batch B when it is not assigned to them", async () => {
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      { batchId: batchB.id, thresholdPercentage: 75 },
      teacherContextA,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("BATCH_ACCESS_DENIED");
      expect(res.error).toMatch(/not assigned to/i);
    }
  });

  it("3. A supplied batchId cannot override the server-side assignment boundary", async () => {
    // Attempting to query get_attendance_summary with unassigned batch B
    const summaryRes = await executeApprovedTool(
      "get_attendance_summary",
      { batchId: batchB.id },
      teacherContextA,
    );

    expect(summaryRes.success).toBe(false);
    if (!summaryRes.success) {
      expect(summaryRes.code).toBe("BATCH_ACCESS_DENIED");
    }

    // Teacher B attempting to query batch A
    const detailsRes = await executeApprovedTool(
      "get_student_attendance_details",
      { batchId: batchA.id },
      teacherContextB,
    );

    expect(detailsRes.success).toBe(false);
    if (!detailsRes.success) {
      expect(detailsRes.code).toBe("BATCH_ACCESS_DENIED");
    }
  });

  it("4. TenantId spoofing cannot retrieve another institute's data", async () => {
    // Attacker passes foreign tenantId in params
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      { tenantId: tenantB.id, thresholdPercentage: 75 },
      teacherContextA,
    );

    expect(res.success).toBe(true);
    if (res.success) {
      // The gateway must bind to context tenantId, returning only tenant A data
      const records = (res.data as any).records;
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect([studentA1.id, studentA2.id, studentA3.id]).toContain(rec.studentId);
      }
    }
  });

  it("5. Attendance summaries are also restricted to assigned batches", async () => {
    // Teacher A's summary for date 2026-11-01 must strictly aggregate Batch A students
    const summaryA = await executeApprovedTool(
      "get_attendance_summary",
      { date: "2026-11-01" },
      teacherContextA,
    );

    expect(summaryA.success).toBe(true);
    if (summaryA.success) {
      // On 2026-11-01:
      // Batch A: Student A1 (PRESENT) + Student A2 (PRESENT) = 2 PRESENT, 0 ABSENT.
      // Batch B: Student B1 (PRESENT).
      // Teacher A must see ONLY their assigned Batch A (2 PRESENT), NOT Batch B!
      expect((summaryA.data as any).present).toBe(2);
      expect((summaryA.data as any).absent).toBe(0);
      expect((summaryA.data as any).scopeDescription).toMatch(/All Assigned Batches|Sec Batch A/);
    }

    // Teacher B's summary for date 2026-11-01 must strictly aggregate Batch B students
    const summaryB = await executeApprovedTool(
      "get_attendance_summary",
      { date: "2026-11-01" },
      teacherContextB,
    );

    expect(summaryB.success).toBe(true);
    if (summaryB.success) {
      // On 2026-11-01:
      // Batch B: Student B1 is PRESENT = 1 PRESENT, 0 ABSENT.
      // Teacher B must see ONLY Batch B (1 PRESENT), NOT Batch A's 2 students!
      expect((summaryB.data as any).present).toBe(1);
      expect((summaryB.data as any).absent).toBe(0);
      expect((summaryB.data as any).scopeDescription).toMatch(/All Assigned Batches|Sec Batch B/);
    }

    // Compare with Institute Owner on 2026-11-01 (who has unconstrained tenant-wide access)
    const summaryOwner = await executeApprovedTool(
      "get_attendance_summary",
      { date: "2026-11-01" },
      ownerContextA,
    );
    expect(summaryOwner.success).toBe(true);
    if (summaryOwner.success) {
      // Owner sees all marked students across all batches: A1 (PRESENT) + A2 (PRESENT) + B1 (PRESENT) = at least 3 PRESENT
      expect((summaryOwner.data as any).present).toBeGreaterThanOrEqual(3);
    }
  });

  it("6. Individual student attendance calculations use the application's defined attendance policy", async () => {
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      { thresholdPercentage: 75 },
      teacherContextA,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const { records, belowThresholdCount, studentsWithRecordsCount, studentsWithZeroSessionsCount } = res.data as any;
    expect(belowThresholdCount).toBe(1);
    expect(studentsWithRecordsCount).toBe(2);
    expect(studentsWithZeroSessionsCount).toBe(1);

    // Assert sorting order:
    // 1. Below threshold first (Student A2)
    // 2. Students with recorded sessions (Student A1)
    // 3. Students with zero sessions (Student A3)
    expect(records[0].studentId).toBe(studentA2.id);
    expect(records[1].studentId).toBe(studentA1.id);
    expect(records[2].studentId).toBe(studentA3.id);

    const recA1 = records.find((r: any) => r.studentId === studentA1.id);
    expect(recA1).toBeDefined();
    // Student A1: 3 PRESENT + 1 LATE out of 4 sessions -> 100%
    expect(recA1.totalEligibleSessions).toBe(4);
    expect(recA1.presentCount).toBe(3);
    expect(recA1.lateCount).toBe(1);
    expect(recA1.absentCount).toBe(0);
    expect(recA1.excusedCount).toBe(0);
    expect(recA1.attendancePercentage).toBe(100);
    expect(recA1.isBelowThreshold).toBe(false);

    const recA2 = records.find((r: any) => r.studentId === studentA2.id);
    expect(recA2).toBeDefined();
    // Student A2: 1 PRESENT, 2 ABSENT, 1 EXCUSED out of 4 sessions -> 25% (EXCUSED counted in denominator)
    expect(recA2.totalEligibleSessions).toBe(4);
    expect(recA2.presentCount).toBe(1);
    expect(recA2.absentCount).toBe(2);
    expect(recA2.excusedCount).toBe(1);
    expect(recA2.attendancePercentage).toBe(25);
    expect(recA2.isBelowThreshold).toBe(true);
  });

  it("7. Students with zero eligible sessions are handled correctly without division-by-zero", async () => {
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      { thresholdPercentage: 75 },
      teacherContextA,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const recA3 = (res.data as any).records.find((r: any) => r.studentId === studentA3.id);
    expect(recA3).toBeDefined();
    expect(recA3.totalEligibleSessions).toBe(0);
    expect(recA3.attendancePercentage).toBe(0);
    expect(Number.isNaN(recA3.attendancePercentage)).toBe(false);
    expect(recA3.isBelowThreshold).toBe(false);
  });

  it("8. Student names and records require the appropriate domain permissions", async () => {
    // Missing tenant.students.read
    const ctxNoStudentsRead: TenantContext = {
      ...teacherContextA,
      membership: {
        ...teacherContextA.membership!,
        permissions: ["tenant.ai.copilot", "tenant.ai.analytics.attendance", "tenant.attendance.read"],
      },
      permissions: new Set(["tenant.ai.copilot", "tenant.ai.analytics.attendance", "tenant.attendance.read"]),
    };

    const resNoStudents = await executeApprovedTool(
      "get_student_attendance_details",
      {},
      ctxNoStudentsRead,
    );
    expect(resNoStudents.success).toBe(false);
    if (!resNoStudents.success) {
      expect(resNoStudents.code).toBe("DOMAIN_READ_DENIED");
      expect(resNoStudents.error).toMatch(/tenant\.students\.read/);
    }

    // Missing tenant.attendance.read
    const ctxNoAttendanceRead: TenantContext = {
      ...teacherContextA,
      membership: {
        ...teacherContextA.membership!,
        permissions: ["tenant.ai.copilot", "tenant.ai.analytics.attendance", "tenant.students.read"],
      },
      permissions: new Set(["tenant.ai.copilot", "tenant.ai.analytics.attendance", "tenant.students.read"]),
    };

    const resNoAttendance = await executeApprovedTool(
      "get_student_attendance_details",
      {},
      ctxNoAttendanceRead,
    );
    expect(resNoAttendance.success).toBe(false);
    if (!resNoAttendance.success) {
      expect(resNoAttendance.code).toBe("DOMAIN_READ_DENIED");
      expect(resNoAttendance.error).toMatch(/tenant\.attendance\.read/);
    }
  });

  it("9. A query about students with low attendance does not trigger get_student_count", () => {
    const tools1 = resolveChatIntents("which students have attendance below 75%?");
    expect(tools1).not.toContain("get_student_count");
    expect(tools1).toContain("get_attendance_summary");
    expect(tools1).toContain("get_student_attendance_details");

    const tools2 = resolveChatIntents("show me student attendance details for today");
    expect(tools2).not.toContain("get_student_count");
    expect(tools2).toContain("get_attendance_summary");
    expect(tools2).toContain("get_student_attendance_details");

    const tools3 = resolveChatIntents("who are the students absent in register?");
    expect(tools3).not.toContain("get_student_count");
    expect(tools3).toContain("get_attendance_summary");
  });

  it("10. Student census questions still use get_student_count", () => {
    const tools1 = resolveChatIntents("how many students are enrolled?");
    expect(tools1).toContain("get_student_count");
    expect(tools1).not.toContain("get_student_attendance_details");

    const tools2 = resolveChatIntents("what is our total student census count?");
    expect(tools2).toContain("get_student_count");

    const tools3 = resolveChatIntents("show student breakdown by class");
    expect(tools3).toContain("get_student_count");
  });

  it("11. Institute Owner and other existing authorized roles retain their intended access", async () => {
    // Institute Owner can query without batch restriction (sees all batches)
    const ownerRes = await executeApprovedTool(
      "get_student_attendance_details",
      { thresholdPercentage: 75 },
      ownerContextA,
    );

    expect(ownerRes.success).toBe(true);
    if (ownerRes.success) {
      const studentIds = (ownerRes.data as any).records.map((r: any) => r.studentId);
      // Owner sees students from both Batch A and Batch B
      expect(studentIds).toContain(studentA1.id);
      expect(studentIds).toContain(studentB1.id);
    }

    // Institute Owner can specifically filter by batch A
    const ownerBatchARes = await executeApprovedTool(
      "get_student_attendance_details",
      { batchId: batchA.id },
      ownerContextA,
    );
    expect(ownerBatchARes.success).toBe(true);

    // Institute Owner can specifically filter by batch B
    const ownerBatchBRes = await executeApprovedTool(
      "get_student_attendance_details",
      { batchId: batchB.id },
      ownerContextA,
    );
    expect(ownerBatchBRes.success).toBe(true);
  });

  it("12. Unauthorized users receive a proper denial without sensitive data in the error response", async () => {
    const res = await executeApprovedTool(
      "get_student_attendance_details",
      {},
      unauthorizedContext,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("DENIED");
      expect(res.error).toBeDefined();
      // Must not leak sensitive names, student numbers or batch codes
      expect(res.error).not.toMatch(/Aarav|Sharma|Diya|Patel|ADM_|Sec Batch/);
    }
  });
});
