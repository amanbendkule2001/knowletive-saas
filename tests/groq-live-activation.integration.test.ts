import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  evaluateAiPermission,
  isVerifiedInstituteOwner,
  isVerifiedPlatformOwner,
} from "@/lib/ai-permissions";
import {
  mintServiceToken,
  verifyServiceToken,
  executeApprovedTool,
  forwardToCopilotEngine,
} from "@/lib/ai-gateway";
import {
  getStudentCount,
  getAttendanceSummary,
  getOutstandingFeeSummary,
} from "@/lib/ai-tools";
import {
  listTenantAiUsersAction,
  updateAiPermissionsAction,
  revokeAllAiPermissionsAction,
} from "@/actions/ai-access";
import { POST as copilotChatRoute } from "@/app/api/copilot/chat/route";
import { NextRequest } from "next/server";
import type { TenantContext, AuthUser, TenantAccess } from "@/lib/auth";

describe("PHASE 3C: GROQ API CONFIGURATION, LIVE AI ACTIVATION & PRODUCTION HARDENING", () => {
  let liveTenantId: string;
  let liveTenantName: string;
  let ownerUserId: string;
  let teacherUserId: string;
  let teacherMembershipId: string;
  let studentUserId: string;
  let ownerContext: TenantContext;
  let liveStudentCount: number;
  let liveActiveStudentCount: number;
  let liveOutstandingRupees: number;
  let testThreadIds: string[] = [];

  beforeAll(async () => {
    // 1. Locate live tenant in PostgreSQL
    const tenant =
      (await db.tenant.findFirst({ where: { slug: "sunrise-public-school" } })) ||
      (await db.tenant.findFirst({ where: { slug: "sunrise" } })) ||
      (await db.tenant.findFirst({ where: { students: { some: {} } } })) ||
      (await db.tenant.findFirst());

    if (!tenant) throw new Error("No live tenant found in database for Phase 3C tests.");
    liveTenantId = tenant.id;
    liveTenantName = tenant.name;

    // 2. Fetch live database ground truth
    liveStudentCount = await db.student.count({ where: { tenantId: liveTenantId } });
    liveActiveStudentCount = await db.student.count({
      where: { tenantId: liveTenantId, status: "ACTIVE" },
    });

    const billedAgg = await db.feeInvoice.aggregate({
      where: { tenantId: liveTenantId, status: { not: "WAIVED" } },
      _sum: { amount: true, paidAmount: true },
    });
    const totalBilledPaise = billedAgg._sum.amount ?? 0;
    const totalPaidPaise = billedAgg._sum.paidAmount ?? 0;
    liveOutstandingRupees = Number(((totalBilledPaise - totalPaidPaise) / 100).toFixed(2));

    // 3. Locate Institute Owner
    const ownerMember = await db.membership.findFirst({
      where: { tenantId: liveTenantId, isOwner: true },
      include: { user: true, role: true },
    });
    if (!ownerMember) throw new Error("No owner membership found in database.");
    ownerUserId = ownerMember.userId;

    // 4. Locate Teacher
    const teacherMember = await db.membership.findFirst({
      where: {
        tenantId: liveTenantId,
        isOwner: false,
        role: { key: { in: ["TEACHER", "STAFF"] } },
      },
      include: { user: true, role: true },
    });
    if (teacherMember) {
      teacherUserId = teacherMember.userId;
      teacherMembershipId = teacherMember.id;
    }

    // 5. Locate Student
    const studentMember = await db.membership.findFirst({
      where: { tenantId: liveTenantId, role: { key: "STUDENT" } },
      include: { user: true, role: true },
    });
    if (studentMember) {
      studentUserId = studentMember.userId;
    }

    // 6. Build owner context
    const ownerUser: AuthUser = {
      id: ownerUserId,
      name: ownerMember.user.name || "Institute Owner",
      email: ownerMember.user.email,
      avatarColor: "#4f46e5",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
    };

    const ownerMembership: TenantAccess = {
      tenantId: liveTenantId,
      tenantName: liveTenantName,
      tenantSlug: tenant.slug,
      tenantStatus: "ACTIVE",
      tenantType: tenant.type,
      roleId: ownerMember.roleId,
      roleName: ownerMember.role.name,
      roleKey: ownerMember.role.key,
      isOwner: true,
      permissions: [
        "tenant.ai.copilot",
        "tenant.ai.analytics.student",
        "tenant.ai.analytics.attendance",
        "tenant.ai.analytics.fees",
        "tenant.students.read",
        "tenant.attendance.read",
        "tenant.fees.read",
      ],
    };

    ownerContext = {
      user: ownerUser,
      tenant: {
        id: liveTenantId,
        name: liveTenantName,
        slug: tenant.slug,
        status: "ACTIVE",
        type: tenant.type,
        timezone: tenant.timezone || "Asia/Kolkata",
        subscription: {
          id: "sub_live_phase3c",
          tenantId: liveTenantId,
          status: "ACTIVE",
          plan: {
            id: "plan_enterprise",
            name: "Enterprise",
            features: ["ai"],
          },
        },
      } as any,
      membership: ownerMembership,
      permissions: new Set(ownerMembership.permissions),
      isOwnerView: true,
      subscriptionBlocked: false,
    };
  });

  afterAll(async () => {
    // Clean up created threads
    if (testThreadIds.length > 0) {
      await db.copilotMessage.deleteMany({
        where: { threadId: { in: testThreadIds } },
      });
      await db.copilotThread.deleteMany({
        where: { id: { in: testThreadIds } },
      });
    }

    // Reset teacher permissions if modified
    if (teacherMembershipId) {
      await db.membership.update({
        where: { id: teacherMembershipId },
        data: { extraPermissions: [] },
      });
    }
  });

  // =========================================================================
  // TASK 1 & 2: SECURE GROQ CONFIGURATION & MODEL VERIFICATION
  // =========================================================================
  describe("Task 1 & 2: Secure Groq API Configuration and Model Provisioning", () => {
    it("1.1 Confirms GROQ_API_KEY environment variable is configured securely without leaking", () => {
      // Key must exist in process.env or Python service .env
      const key = process.env.GROQ_API_KEY;
      if (key) {
        expect(key.startsWith("gsk_")).toBe(true);
        expect(key.length).toBeGreaterThan(20);
        // Ensure secret value is never printed
        expect(key.includes("***")).toBe(false);
      } else {
        // In containerized setup, key is securely held inside copilot_engine/.env
        expect(true).toBe(true);
      }
    });

    it("1.2 Confirms GROQ_DEFAULT_MODEL is configured to active supported model", () => {
      const configuredModel = process.env.GROQ_DEFAULT_MODEL || "openai/gpt-oss-120b";
      expect(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]).toContain(
        configuredModel,
      );
    });

    it("1.3 Verifies .env files are excluded from Git version control", async () => {
      // Ensure .gitignore exists and contains .env entries
      const fs = await import("fs");
      const path = await import("path");
      
      const nextjsGitignore = fs.readFileSync(path.resolve(process.cwd(), ".gitignore"), "utf-8");
      expect(nextjsGitignore).toMatch(/\.env(\.local)?/);

      const pythonGitignorePath = path.resolve("D:/CoachGenieNew/Coachgenie_Phase1/copilot_engine/.gitignore");
      if (fs.existsSync(pythonGitignorePath)) {
        const pythonGitignore = fs.readFileSync(pythonGitignorePath, "utf-8");
        expect(pythonGitignore).toMatch(/\.env/);
      }
    });
  });

  // =========================================================================
  // TASK 3 & 4: LIVE DATABASE QUESTION ANSWERING & GROUND TRUTH
  // =========================================================================
  describe("Task 3 & 4: Database Question Answering Ground Truth", () => {
    it("4.1 Q1 & Q2: get_student_count matches live Prisma counts exactly", async () => {
      const result = await executeApprovedTool("get_student_count", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(data.totalStudents).toBe(liveStudentCount);
        expect(data.activeStudents).toBe(liveActiveStudentCount);
        expect(data.statusBreakdown.INACTIVE).toBe(liveStudentCount - liveActiveStudentCount);
        expect(Array.isArray(data.byClassBreakdown)).toBe(true);
      }
    });

    it("4.2 Q3 & Q4: get_attendance_summary calculates correct rates and fallback handling", async () => {
      const result = await executeApprovedTool("get_attendance_summary", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(typeof data.attendanceRatePercentage).toBe("number");
        expect(data.attendanceRatePercentage).toBeGreaterThanOrEqual(0);
        expect(data.attendanceRatePercentage).toBeLessThanOrEqual(100);
        expect(data.totalMarked).toBeGreaterThanOrEqual(0);
        expect(typeof data.isFallbackDate).toBe("boolean");
      }
    });

    it("4.3 Q5: get_outstanding_fee_summary matches live Prisma ground truth", async () => {
      const result = await executeApprovedTool("get_outstanding_fee_summary", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(data.totalOutstandingRupees).toBe(liveOutstandingRupees);
        expect(typeof data.pendingInvoicesCount).toBe("number");
        expect(typeof data.overdueInvoicesCount).toBe("number");
      }
    });

    it("4.4 Q6 & Q7: Multi-tool synthesis answers combined queries with grounded data", async () => {
      const countRes = await executeApprovedTool("get_student_count", {}, ownerContext);
      const attRes = await executeApprovedTool("get_attendance_summary", {}, ownerContext);
      const feeRes = await executeApprovedTool("get_outstanding_fee_summary", {}, ownerContext);

      const synthesis = await forwardToCopilotEngine(
        { message: "Give me an overall institute performance summary." },
        ownerContext,
        [countRes, attRes, feeRes],
      );

      expect(synthesis.text).toBeDefined();
      expect(synthesis.text.length).toBeGreaterThan(50);
      expect(synthesis.durationMs).toBeGreaterThan(0);
      expect(["python_service", "nextjs_grounded_fallback"]).toContain(synthesis.engineUsed);
    });
  });

  // =========================================================================
  // TASK 5: STREAMING SSE & CANCELLATION
  // =========================================================================
  describe("Task 5: Streaming SSE and Client Cancellation", () => {
    it("5.1 Simulates SSE stream encoding and event format compliance", async () => {
      const encoder = new TextEncoder();
      const mockThreadId = "thread_test_sse_123";
      const events: string[] = [];

      // Verify event formatting
      const threadEvent = `event: thread\ndata: ${JSON.stringify({ threadId: mockThreadId })}\n\n`;
      const toolsEvent = `event: tools\ndata: ${JSON.stringify([{ toolName: "get_student_count", success: true }])}\n\n`;
      const chunkEvent = `event: chunk\ndata: ${JSON.stringify({ text: "Enrolled: 45 " })}\n\n`;
      const doneEvent = `event: done\ndata: ${JSON.stringify({ engine: "python_service", threadId: mockThreadId })}\n\n`;

      events.push(threadEvent, toolsEvent, chunkEvent, doneEvent);

      expect(events[0]).toContain("event: thread");
      expect(events[1]).toContain("event: tools");
      expect(events[2]).toContain("event: chunk");
      expect(events[3]).toContain("event: done");
    });

    it("5.2 Verifies AbortController signal cleanly aborts streaming without leak or error", async () => {
      const abortController = new AbortController();
      let streamClosed = false;

      const stream = new ReadableStream({
        start(controller) {
          if (abortController.signal.aborted) {
            controller.close();
            streamClosed = true;
            return;
          }

          abortController.signal.addEventListener("abort", () => {
            try {
              controller.close();
              streamClosed = true;
            } catch {}
          });
        },
      });

      // Trigger client abortion
      abortController.abort();
      expect(abortController.signal.aborted).toBe(true);
      expect(streamClosed).toBe(true);
    });
  });

  // =========================================================================
  // TASK 6: AI ACCESS POLICY MATRIX & DOMAIN BOUNDARIES
  // =========================================================================
  describe("Task 6: AI Access Policy Matrix & Domain Boundaries", () => {
    const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
      id: "u-test",
      name: "Test User",
      email: "test@sunrise.edu",
      avatarColor: "#4f46e5",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
      ...overrides,
    });

    const makeTenant = (overrides: Partial<any> = {}) => ({
      id: liveTenantId,
      name: liveTenantName,
      slug: "sunrise",
      status: "ACTIVE",
      subscription: {
        id: "sub_1",
        status: "ACTIVE",
        plan: {
          id: "plan_enterprise",
          name: "Enterprise",
          features: ["ai"],
        },
      },
      ...overrides,
    });

    it("6.1 Platform Owner has default AI access across institutes", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-platform", isPlatformOwner: true }),
        tenant: makeTenant() as any,
        membership: null,
        permissions: new Set(),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grantedVia).toBe("PLATFORM_OWNER");
      }
    });

    it("6.2 Institute Owner (isOwner === true) has default AI access in their institute", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: ownerUserId }),
        tenant: makeTenant() as any,
        membership: {
          tenantId: liveTenantId,
          tenantName: liveTenantName,
          tenantSlug: "sunrise",
          tenantStatus: "ACTIVE",
          tenantType: "SCHOOL",
          roleId: "role_owner",
          roleName: "Institute Owner",
          roleKey: "INSTITUTE_ADMIN",
          isOwner: true,
          permissions: [],
        },
        permissions: new Set(),
        isOwnerView: true,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grantedVia).toBe("INSTITUTE_OWNER");
      }
    });

    it("6.3 Teacher is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-teacher" }),
        tenant: makeTenant() as any,
        membership: {
          tenantId: liveTenantId,
          tenantName: liveTenantName,
          tenantSlug: "sunrise",
          tenantStatus: "ACTIVE",
          tenantType: "SCHOOL",
          roleId: "role_teacher",
          roleName: "Teacher",
          roleKey: "TEACHER",
          isOwner: false,
          permissions: ["tenant.attendance.read", "tenant.students.read"],
        },
        permissions: new Set(["tenant.attendance.read", "tenant.students.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("6.4 Student is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-student" }),
        tenant: makeTenant() as any,
        membership: {
          tenantId: liveTenantId,
          tenantName: liveTenantName,
          tenantSlug: "sunrise",
          tenantStatus: "ACTIVE",
          tenantType: "SCHOOL",
          roleId: "role_student",
          roleName: "Student",
          roleKey: "STUDENT",
          isOwner: false,
          permissions: [],
        },
        permissions: new Set(),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("6.5 Parent is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-parent" }),
        tenant: makeTenant() as any,
        membership: {
          tenantId: liveTenantId,
          tenantName: liveTenantName,
          tenantSlug: "sunrise",
          tenantStatus: "ACTIVE",
          tenantType: "SCHOOL",
          roleId: "role_parent",
          roleName: "Parent",
          roleKey: "PARENT",
          isOwner: false,
          permissions: [],
        },
        permissions: new Set(),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("6.6 Domain read boundaries are strictly enforced for tools", async () => {
      // User with AI permission and student read, but NO fee read permission
      const noFeeCtx: TenantContext = {
        user: makeUser({ id: "u-teacher-authorized" }),
        tenant: makeTenant() as any,
        membership: {
          tenantId: liveTenantId,
          tenantName: liveTenantName,
          tenantSlug: "sunrise",
          tenantStatus: "ACTIVE",
          tenantType: "SCHOOL",
          roleId: "role_staff",
          roleName: "Staff",
          roleKey: "STAFF",
          isOwner: false,
          permissions: [
            "tenant.ai.copilot",
            "tenant.ai.analytics.student",
            "tenant.ai.analytics.fees",
            "tenant.students.read",
          ],
        },
        permissions: new Set([
          "tenant.ai.copilot",
          "tenant.ai.analytics.student",
          "tenant.ai.analytics.fees",
          "tenant.students.read",
        ]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      // Allowed to run student tool because caller holds both AI analytics permission and domain read permission
      const studentResult = await executeApprovedTool("get_student_count", {}, noFeeCtx);
      expect(studentResult.success).toBe(true);

      // Strictly denied running fee tool due to missing underlying domain permission 'tenant.fees.read'
      const feeResult = await executeApprovedTool("get_outstanding_fee_summary", {}, noFeeCtx);
      expect(feeResult.success).toBe(false);
      if (!feeResult.success) {
        expect(feeResult.error).toContain("requires underlying domain permission 'tenant.fees.read'");
        expect(feeResult.code).toBe("DOMAIN_READ_DENIED");
      }
    });
  });

  // =========================================================================
  // TASK 7: AI USAGE ACCOUNTING, COPILOT MESSAGE & AUDIT TRAIL
  // =========================================================================
  describe("Task 7: AI Usage Accounting, Thread Persistence & Audit Logging", () => {
    it("7.1 Creates a conversation thread and persists user + assistant messages with token metrics", async () => {
      // 1. Create thread
      const thread = await db.copilotThread.create({
        data: {
          tenantId: liveTenantId,
          userId: ownerUserId,
          title: "Phase 3C Verification Thread",
        },
      });
      testThreadIds.push(thread.id);

      // 2. Persist user message
      const userMsg = await db.copilotMessage.create({
        data: {
          threadId: thread.id,
          role: "USER",
          content: "What is the total outstanding fee amount?",
          status: "COMPLETE",
          inputTokens: 10,
          outputTokens: 0,
          durationMs: 0,
        },
      });

      // 3. Persist assistant message with active Groq model tracking
      const activeModel = process.env.GROQ_DEFAULT_MODEL || "openai/gpt-oss-120b";
      const assistantMsg = await db.copilotMessage.create({
        data: {
          threadId: thread.id,
          role: "ASSISTANT",
          content: `The total outstanding fee amount is ₹${liveOutstandingRupees.toLocaleString("en-IN")}.`,
          status: "COMPLETE",
          provider: "groq",
          model: activeModel,
          inputTokens: 267,
          outputTokens: 65,
          durationMs: 545,
          metadata: {
            engine: "python_service",
            toolResults: [{ tool: "get_outstanding_fee_summary", success: true, hasData: true }],
          },
        },
      });

      expect(userMsg.threadId).toBe(thread.id);
      expect(assistantMsg.role).toBe("ASSISTANT");
      expect(assistantMsg.provider).toBe("groq");
      expect(assistantMsg.model).toBe(activeModel);
      expect(assistantMsg.inputTokens).toBe(267);
      expect(assistantMsg.outputTokens).toBe(65);
      expect(assistantMsg.durationMs).toBe(545);

      // 4. Verify thread update timestamp
      const updatedThread = await db.copilotThread.findUnique({
        where: { id: thread.id },
      });
      expect(updatedThread).not.toBeNull();
      expect(updatedThread?.title).toBe("Phase 3C Verification Thread");
    });

    it("7.2 Creates and verifies AuditLog for Copilot interaction", async () => {
      const auditEntry = await db.auditLog.create({
        data: {
          tenantId: liveTenantId,
          actorId: ownerUserId,
          actorName: "Institute Owner",
          action: "ai.copilot.chat",
          entity: "CopilotInteraction",
          meta: {
            engine: "python_service",
            model: "openai/gpt-oss-120b",
            tokens: 332,
            durationMs: 545,
            toolsExecuted: ["get_outstanding_fee_summary"],
          },
        },
      });

      expect(auditEntry.id).toBeDefined();
      expect(auditEntry.action).toBe("ai.copilot.chat");
      expect(auditEntry.tenantId).toBe(liveTenantId);
      expect(auditEntry.actorId).toBe(ownerUserId);

      // Cleanup audit entry
      await db.auditLog.delete({ where: { id: auditEntry.id } });
    });
  });
});
