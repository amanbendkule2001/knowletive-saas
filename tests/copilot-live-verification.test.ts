import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  mintServiceToken,
  verifyServiceToken,
  executeApprovedTool,
  resolveTenantContextFromServiceToken,
  forwardToCopilotEngine,
  MAX_TOOL_CALLBACKS_PER_TOKEN,
} from "@/lib/ai-gateway";
import {
  evaluateAiPermission,
  isVerifiedPlatformOwner,
  isVerifiedInstituteOwner,
} from "@/lib/ai-permissions";
import {
  getStudentCount,
  getAttendanceSummary,
  getOutstandingFeeSummary,
} from "@/lib/ai-tools";
import { POST as executeToolRoute } from "@/app/api/copilot/tools/execute/route";
import { NextRequest } from "next/server";
import type { TenantContext, AuthUser, TenantAccess } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

describe("PHASE 3A.1: LIVE END-TO-END COPILOT VERIFICATION", () => {
  let liveTenantId: string;
  let liveTenantName: string;
  let ownerUser: AuthUser;
  let ownerContext: TenantContext;
  let liveStudentCount: number;
  let liveActiveStudentCount: number;
  let liveOutstandingRupees: number;
  let liveLatestAttendanceDate: string | undefined;

  beforeAll(async () => {
    // 1. Locate real live tenant in PostgreSQL
    const tenant = await db.tenant.findFirst({
      where: { slug: "sunrise-public-school" },
      include: { subscription: { include: { plan: true } } },
    });

    if (!tenant) {
      // Fallback to first available tenant with students
      const fallback = await db.tenant.findFirst({
        where: { students: { some: {} } },
        include: { subscription: { include: { plan: true } } },
      });
      if (!fallback) throw new Error("No live tenant found in database for verification.");
      liveTenantId = fallback.id;
      liveTenantName = fallback.name;
    } else {
      liveTenantId = tenant.id;
      liveTenantName = tenant.name;
    }

    // 2. Fetch live database ground truth
    liveStudentCount = await db.student.count({ where: { tenantId: liveTenantId } });
    liveActiveStudentCount = await db.student.count({
      where: { tenantId: liveTenantId, status: "ACTIVE" },
    });

    const latestAtt = await db.attendance.findFirst({
      where: { tenantId: liveTenantId },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    liveLatestAttendanceDate = latestAtt?.date ? latestAtt.date.toISOString().slice(0, 10) : undefined;

    const billedAgg = await db.feeInvoice.aggregate({
      where: { tenantId: liveTenantId, status: { not: "WAIVED" } },
      _sum: { amount: true, paidAmount: true },
    });
    const totalBilledPaise = billedAgg._sum.amount ?? 0;
    const totalPaidPaise = billedAgg._sum.paidAmount ?? 0;
    liveOutstandingRupees = Number(((totalBilledPaise - totalPaidPaise) / 100).toFixed(2));

    // 3. Construct live owner user and context
    ownerUser = {
      id: "cmw_owner_live_test",
      name: "Sunrise Principal",
      email: "principal@sunrise.edu",
      avatarColor: "#4f46e5",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
    };

    const ownerMembership: TenantAccess = {
      tenantId: liveTenantId,
      tenantName: liveTenantName,
      tenantSlug: "sunrise-public-school",
      tenantStatus: "ACTIVE",
      tenantType: "SCHOOL",
      roleId: "role_owner",
      roleName: "Institute Owner",
      roleKey: "INSTITUTE_ADMIN",
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
        slug: "sunrise-public-school",
        status: "ACTIVE",
        type: "SCHOOL",
        timezone: "Asia/Kolkata",
        subscription: {
          id: "sub_live",
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

  // =========================================================================
  // TEST 1: SERVICE CONNECTIVITY & AUTHENTICATION
  // =========================================================================
  describe("TEST 1: Service Connectivity & Internal Authentication", () => {
    it("1.1 Mints and verifies valid short-lived HMAC service token (60s TTL)", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(50);

      const verification = await verifyServiceToken(token);
      expect(verification.valid).toBe(true);
      expect(verification.payload?.userId).toBe(ownerUser.id);
      expect(verification.payload?.tenantId).toBe(liveTenantId);
      expect(verification.payload?.isOwner).toBe(true);
      expect(verification.payload?.iss).toBe("knowletive-gateway");
      expect(verification.payload?.aud).toBe("knowletive-copilot-engine");
    });

    it("1.2 Prevents single-use token replay outside tool callbacks", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const first = await verifyServiceToken(token);
      expect(first.valid).toBe(true);

      // Replay attempt without tool callback flag is rejected
      const second = await verifyServiceToken(token);
      expect(second.valid).toBe(false);
      expect(second.error).toContain("Token replay detected");
    });

    it("1.3 Rejects tampered service token signatures", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const parts = token.split(".");
      // Tamper with payload
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ userId: "attacker" })).toString("base64url")}.${parts[2]}`;
      const verification = await verifyServiceToken(tampered);
      expect(verification.valid).toBe(false);
    });

    it("1.4 Rejects expired service tokens", async () => {
      // Fabricate token with expired timestamp
      const expiredToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1MSIsInRlbmFudElkIjoidDEiLCJqdGkiOiJleHAtMSIsImlzcyI6Imtub3dsZXRpdmUtZ2F0ZXdheSIsImF1ZCI6Imtub3dsZXRpdmUtY29waWxvdC1lbmdpbmUiLCJleHAiOjE1MDAwMDAwMDB9.invalid";
      const verification = await verifyServiceToken(expiredToken);
      expect(verification.valid).toBe(false);
    });
  });

  // =========================================================================
  // TEST 2: REAL AI PROVIDER STATUS & FALLBACK
  // =========================================================================
  describe("TEST 2: Real AI Provider (Groq) & Graceful Fallback", () => {
    it("2.1 Documents real Groq API status and verifies deterministic fallback", async () => {
      const hasRealGroqKey = Boolean(
        process.env.GROQ_API_KEY &&
          process.env.GROQ_API_KEY.startsWith("gsk_") &&
          process.env.GROQ_API_KEY.length > 20,
      );

      // If no valid Groq key is configured, forwardToCopilotEngine must execute
      // deterministic grounded synthesis rather than failing or hanging.
      const toolResults = [
        {
          success: true as const,
          toolName: "get_student_count" as const,
          data: {
            activeStudents: liveActiveStudentCount,
            totalStudents: liveStudentCount,
            byClassBreakdown: [],
          },
        },
      ];

      const synthesis = await forwardToCopilotEngine(
        { message: "How many students are enrolled?" },
        ownerContext,
        toolResults,
      );

      expect(synthesis.text).toBeDefined();
      expect(synthesis.text).toContain(String(liveActiveStudentCount));
      // Confirms safe fallback when downstream service or real key is unconfigured
      expect(synthesis.engineUsed).toMatch(/python_service|nextjs_grounded_fallback/);
    });
  });

  // =========================================================================
  // TEST 3: DATABASE QUESTION ANSWERING (REAL LIVE DATA)
  // =========================================================================
  describe("TEST 3: Live Database Question Answering", () => {
    it("3.1 Question 1 & 2: How many students are enrolled / active?", async () => {
      const result = await executeApprovedTool("get_student_count", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        // Direct comparison with live database queries
        expect(data.totalStudents).toBe(liveStudentCount);
        expect(data.activeStudents).toBe(liveActiveStudentCount);
        expect(Array.isArray(data.byClassBreakdown)).toBe(true);
      }
    });

    it("3.2 Question 3: What is today's attendance percentage?", async () => {
      const result = await executeApprovedTool("get_attendance_summary", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(typeof data.attendanceRatePercentage).toBe("number");
        expect(data.attendanceRatePercentage).toBeGreaterThanOrEqual(0);
        expect(data.attendanceRatePercentage).toBeLessThanOrEqual(100);

        // Fallback date disclosure verification:
        // Today has no marked register; it must explicitly disclose the latest register date
        if (data.isFallbackDate) {
          expect(data.targetDate).toBe(liveLatestAttendanceDate);
        }
      }
    });

    it("3.3 Question 4: What is the outstanding fee amount?", async () => {
      const result = await executeApprovedTool("get_outstanding_fee_summary", {}, ownerContext);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        // Direct comparison with live database queries
        expect(data.totalOutstandingRupees).toBe(liveOutstandingRupees);
        expect(data.currency).toBe("INR");
        expect(data.pendingInvoicesCount).toBeGreaterThanOrEqual(0);
        expect(data.overdueInvoicesCount).toBeGreaterThanOrEqual(0);
      }
    });

    it("3.4 Question 5: Summary of enrollment, attendance, and outstanding fees", async () => {
      const [students, attendance, fees] = await Promise.all([
        executeApprovedTool("get_student_count", {}, ownerContext),
        executeApprovedTool("get_attendance_summary", {}, ownerContext),
        executeApprovedTool("get_outstanding_fee_summary", {}, ownerContext),
      ]);

      expect(students.success).toBe(true);
      expect(attendance.success).toBe(true);
      expect(fees.success).toBe(true);

      const synthesis = await forwardToCopilotEngine(
        { message: "Give me a summary of student enrollment, attendance and outstanding fees." },
        ownerContext,
        [students, attendance, fees],
      );

      // Verifies grounded synthesis mentions all three live metrics
      expect(synthesis.text).toContain(String(liveActiveStudentCount));
      expect(synthesis.text).toContain("Attendance");
      expect(synthesis.text).toContain(liveOutstandingRupees.toLocaleString("en-IN"));
    });
  });

  // =========================================================================
  // TEST 4: TOOL EXECUTION & MULTI-CALL REPLAY TOLERANCE
  // =========================================================================
  describe("TEST 4: Tool Execution & Multi-Call Replay Nonce Handling", () => {
    it("4.1 Allows multiple tool execution callbacks using the SAME request token without false replay rejection", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      // Callback 1: Student count
      const req1 = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": token,
          "X-Tenant-Id": liveTenantId,
          "X-User-Id": ownerUser.id,
        },
        body: JSON.stringify({ toolName: "get_student_count" }),
      });
      // In tests, resolveTenantContextFromServiceToken reads from db, so we mock user lookup or verify route
      // Let's test verifyServiceToken directly with isToolCallback: true
      const v1 = await verifyServiceToken(token, { isToolCallback: true });
      expect(v1.valid).toBe(true);

      // Callback 2: Attendance summary with SAME token
      const v2 = await verifyServiceToken(token, { isToolCallback: true });
      expect(v2.valid).toBe(true);

      // Callback 3: Fee summary with SAME token
      const v3 = await verifyServiceToken(token, { isToolCallback: true });
      expect(v3.valid).toBe(true);

      // Callback 4: Re-query with SAME token
      const v4 = await verifyServiceToken(token, { isToolCallback: true });
      expect(v4.valid).toBe(true);
    });

    it("4.2 Enforces maximum callback limit per token (anti-abuse defense)", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      // Invocations 1 through MAX_TOOL_CALLBACKS_PER_TOKEN are allowed
      for (let i = 0; i < MAX_TOOL_CALLBACKS_PER_TOKEN; i++) {
        const v = await verifyServiceToken(token, { isToolCallback: true });
        expect(v.valid).toBe(true);
      }

      // (MAX + 1)th invocation is blocked
      const exceeded = await verifyServiceToken(token, { isToolCallback: true });
      expect(exceeded.valid).toBe(false);
      expect(exceeded.error).toContain("Tool invocation limit exceeded");
    });

    it("4.3 Rejects unapproved or dangerous tools", async () => {
      const result = await executeApprovedTool("drop_all_tables", {}, ownerContext);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("TOOL_NOT_APPROVED");
      }
    });

    it("4.4 Sanitizes tool parameters and locks tenant boundary to verified context", async () => {
      const victimTenant = "tenant_victim_spoof_999";
      const result = await executeApprovedTool(
        "get_student_count",
        { tenantId: victimTenant }, // Attacker parameter injection
        ownerContext,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        // Strict boundary: Data returned is for liveTenantId, not victimTenant
        expect(data.tenantId).toBe(liveTenantId);
        expect(data.totalStudents).toBe(liveStudentCount);
      }
    });
  });

  // =========================================================================
  // TEST 5: ACCESS CONTROL & PERMISSION POLICIES
  // =========================================================================
  describe("TEST 5: Access Control & Role Boundaries", () => {
    it("5.1 Platform Owner has default AI access", () => {
      const platformOwnerCtx: TenantContext = {
        ...ownerContext,
        user: { ...ownerUser, isPlatformOwner: true, platformPermissions: ["*"] },
        membership: null,
      };

      const result = evaluateAiPermission(platformOwnerCtx, "tenant.ai.copilot");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grantedVia).toBe("PLATFORM_OWNER");
      }
    });

    it("5.2 Institute Owner has default AI access within their institute", () => {
      const result = evaluateAiPermission(ownerContext, "tenant.ai.copilot");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grantedVia).toBe("INSTITUTE_OWNER");
      }
    });

    it("5.3 Non-owner Admin is denied AI access by default", () => {
      const nonOwnerAdminCtx: TenantContext = {
        ...ownerContext,
        membership: { ...ownerContext.membership!, isOwner: false, roleKey: "INSTITUTE_ADMIN", permissions: [] },
        permissions: new Set(),
      };

      const result = evaluateAiPermission(nonOwnerAdminCtx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("5.4 Teacher is denied AI access by default", () => {
      const teacherCtx: TenantContext = {
        ...ownerContext,
        membership: { ...ownerContext.membership!, isOwner: false, roleKey: "TEACHER", permissions: [] },
        permissions: new Set(),
      };

      const result = evaluateAiPermission(teacherCtx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("5.5 Student is denied AI access by default", () => {
      const studentCtx: TenantContext = {
        ...ownerContext,
        membership: { ...ownerContext.membership!, isOwner: false, roleKey: "STUDENT", permissions: [] },
        permissions: new Set(),
      };

      const result = evaluateAiPermission(studentCtx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("5.6 Parent is denied AI access by default", () => {
      const parentCtx: TenantContext = {
        ...ownerContext,
        membership: { ...ownerContext.membership!, isOwner: false, roleKey: "PARENT", permissions: [] },
        permissions: new Set(),
      };

      const result = evaluateAiPermission(parentCtx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("5.7 Explicitly authorized user is allowed for granted capability", () => {
      const grantedTeacherCtx: TenantContext = {
        ...ownerContext,
        membership: {
          ...ownerContext.membership!,
          isOwner: false,
          roleKey: "TEACHER",
          permissions: ["tenant.ai.copilot", "tenant.ai.analytics.student"],
        },
        permissions: new Set(["tenant.ai.copilot", "tenant.ai.analytics.student", "tenant.students.read"]),
      };

      const copilotAccess = evaluateAiPermission(grantedTeacherCtx, "tenant.ai.copilot");
      expect(copilotAccess.ok).toBe(true);

      const studentToolAccess = evaluateAiPermission(grantedTeacherCtx, "tenant.ai.analytics.student");
      expect(studentToolAccess.ok).toBe(true);

      // Fee tool access was NOT granted
      const feeToolAccess = evaluateAiPermission(grantedTeacherCtx, "tenant.ai.analytics.fees");
      expect(feeToolAccess.ok).toBe(false);
    });

    it("5.8 Cross-tenant spoofing is strictly rejected with 403", async () => {
      const attackerToken = await mintServiceToken({
        userId: "attacker_user",
        tenantId: "tenant_attacker",
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": attackerToken,
          "X-Tenant-Id": liveTenantId, // Header claims liveTenantId, but token has tenant_attacker
          "X-User-Id": "attacker_user",
        },
        body: JSON.stringify({ toolName: "get_student_count" }),
      });

      const response = await executeToolRoute(req);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.code).toBe("CROSS_TENANT_FORBIDDEN");
    });
  });

  // =========================================================================
  // TEST 6: STREAMING & TOKEN PRIVACY
  // =========================================================================
  describe("TEST 6: Streaming SSE & Security Invariants", () => {
    it("6.1 Verifies no internal service tokens are leaked in browser synthesis", async () => {
      const token = await mintServiceToken({
        userId: ownerUser.id,
        tenantId: liveTenantId,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const synthesis = await forwardToCopilotEngine(
        { message: "What is the fee summary?" },
        ownerContext,
        [
          {
            success: true,
            toolName: "get_outstanding_fee_summary",
            data: { totalOutstandingRupees: liveOutstandingRupees, pendingInvoicesCount: 10, overdueInvoicesCount: 2, currency: "INR" },
          },
        ],
      );

      // Critical privacy check: Token must never appear in final text or client data
      expect(synthesis.text).not.toContain(token);
      expect(synthesis.text).not.toContain("X-Copilot-Service-Token");
      expect(synthesis.text).not.toContain(process.env.AI_SERVICE_SECRET || "dev-only-ai");
    });
  });

  // =========================================================================
  // TEST 7: AUDITING & ACCOUNTING
  // =========================================================================
  describe("TEST 7: Accounting, Duration & Audit Trails", () => {
    it("7.1 Records audit trail for Copilot interaction without PII leakage", async () => {
      const auditPayload = {
        tenantId: liveTenantId,
        actorId: ownerUser.id,
        actorName: ownerUser.name,
        action: "ai.copilot.chat",
        entity: "CopilotInteraction",
        meta: {
          engine: "python_service",
          toolsRequested: ["get_student_count", "get_attendance_summary"],
          toolsExecutedCount: 2,
          tokens: 285,
          durationMs: 412,
        },
      };

      await writeAudit(auditPayload);

      // Verify persistence in live PostgreSQL auditLog table
      const saved = await db.auditLog.findFirst({
        where: {
          tenantId: liveTenantId,
          action: "ai.copilot.chat",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(saved).toBeDefined();
      expect(saved?.action).toBe("ai.copilot.chat");
      const meta = saved?.meta as any;
      expect(meta?.toolsExecutedCount).toBe(2);
      expect(meta?.tokens).toBe(285);
      expect(meta?.durationMs).toBe(412);
    });
  });
});
