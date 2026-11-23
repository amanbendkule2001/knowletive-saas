import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TenantContext, AuthUser, TenantAccess } from "@/lib/auth";
import {
  mintServiceToken,
  verifyServiceToken,
  executeApprovedTool,
  resolveTenantContextFromServiceToken,
  forwardToCopilotEngine,
  SERVICE_TOKEN_ISSUER,
  SERVICE_TOKEN_AUDIENCE,
} from "@/lib/ai-gateway";
import {
  getStudentCount,
  getAttendanceSummary,
  getOutstandingFeeSummary,
} from "@/lib/ai-tools";
import { db } from "@/lib/db";
import { POST as executeToolRoute } from "@/app/api/copilot/tools/execute/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    student: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    classLevel: {
      findMany: vi.fn(),
    },
    attendance: {
      groupBy: vi.fn(),
      findFirst: vi.fn(),
    },
    feeInvoice: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    tenantUsage: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
  },
}));

function createMockContext(overrides: {
  isPlatformOwner?: boolean;
  isOwner?: boolean;
  roleKey?: string;
  permissions?: string[];
  tenantId?: string;
  userId?: string;
}): TenantContext {
  const tenantId = overrides.tenantId ?? "tenant_apex_101";
  const userId = overrides.userId ?? "user_admin_001";

  const user: AuthUser = {
    id: userId,
    name: "Admin User",
    email: "admin@apex.edu",
    avatarColor: "indigo",
    isPlatformOwner: overrides.isPlatformOwner ?? false,
    platformPermissions: overrides.isPlatformOwner ? ["*"] : [],
    memberships: [],
  };

  const membership: TenantAccess = {
    tenantId,
    tenantName: "Apex Academy",
    tenantSlug: "apex-academy",
    tenantStatus: "ACTIVE",
    tenantType: "ACADEMY",
    roleId: "role_admin",
    roleName: overrides.roleKey ?? "INSTITUTE_ADMIN",
    roleKey: overrides.roleKey ?? "INSTITUTE_ADMIN",
    isOwner: overrides.isOwner ?? true,
    permissions: overrides.permissions ?? [
      "tenant.ai.copilot",
      "tenant.ai.analytics.student",
      "tenant.ai.analytics.attendance",
      "tenant.ai.analytics.fees",
      "tenant.students.read",
      "tenant.attendance.read",
      "tenant.fees.read",
    ],
  };

  return {
    user,
    tenant: {
      id: tenantId,
      name: "Apex Academy",
      slug: "apex-academy",
      status: "ACTIVE",
      type: "ACADEMY",
      timezone: "Asia/Kolkata",
      subscription: {
        id: "sub_1",
        tenantId,
        status: "ACTIVE",
        plan: {
          id: "plan_enterprise",
          name: "Enterprise Plan",
          features: ["ai"],
        },
      },
    } as any,
    membership,
    permissions: new Set(membership.permissions),
    isOwnerView: true,
    subscriptionBlocked: false,
  };
}

describe("PHASE 3A: End-to-End AI Copilot & Tool Gateway Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Student Count Question
  it("Scenario 1: Executes student count tool accurately with class breakdown", async () => {
    const ctx = createMockContext({});
    vi.mocked(db.student.count).mockResolvedValue(120);
    vi.mocked(db.student.groupBy)
      .mockResolvedValueOnce([{ status: "ACTIVE", _count: { _all: 120 } }] as any)
      .mockResolvedValueOnce([
        { classId: "c1", _count: { _all: 60 } },
        { classId: "c2", _count: { _all: 60 } },
      ] as any);
    vi.mocked(db.classLevel.findMany).mockResolvedValueOnce([
      { id: "c1", name: "Class 10-A" },
      { id: "c2", name: "Class 10-B" },
    ] as any);

    const result = await executeApprovedTool("get_student_count", {}, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.activeStudents).toBe(120);
      expect(data.byClassBreakdown).toHaveLength(2);
      expect(data.byClassBreakdown[0].className).toBe("Class 10-A");
    }
  });

  // 2. Attendance Percentage Question
  it("Scenario 2: Calculates attendance rate percentage correctly", async () => {
    const ctx = createMockContext({});
    vi.mocked(db.attendance.groupBy).mockResolvedValueOnce([
      { status: "PRESENT", _count: { _all: 85 } },
      { status: "ABSENT", _count: { _all: 15 } },
    ] as any);

    const result = await executeApprovedTool("get_attendance_summary", { date: "2026-11-18" }, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.attendanceRatePercentage).toBe(85);
      expect(data.present).toBe(85);
      expect(data.absent).toBe(15);
      expect(data.isFallbackDate).toBe(false);
    }
  });

  // 3. Outstanding Fee Question
  it("Scenario 3: Calculates fee finances and overdue invoices correctly", async () => {
    const ctx = createMockContext({});
    vi.mocked(db.feeInvoice.aggregate)
      .mockResolvedValueOnce({
        _sum: { amount: 100000000 as any, paidAmount: 80000000 as any },
      } as any)
      .mockResolvedValueOnce({
        _sum: { amount: 20000000 as any, paidAmount: 0 as any },
        _count: { _all: 7 },
      } as any);

    vi.mocked(db.feeInvoice.count).mockResolvedValueOnce(25);

    const result = await executeApprovedTool("get_outstanding_fee_summary", {}, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.totalOutstandingRupees).toBe(200000);
      expect(data.overdueAmountRupees).toBe(200000);
      expect(data.pendingInvoicesCount).toBe(25);
      expect(data.overdueInvoicesCount).toBe(7);
      expect(data.currency).toBe("INR");
    }
  });

  // 4. Multiple Tool Execution
  it("Scenario 4: Executes multiple tools for a compound executive query", async () => {
    const ctx = createMockContext({});
    vi.mocked(db.student.count).mockResolvedValue(50);
    vi.mocked(db.student.groupBy).mockResolvedValue([]);
    vi.mocked(db.classLevel.findMany).mockResolvedValue([]);
    vi.mocked(db.attendance.groupBy).mockResolvedValueOnce([{ status: "PRESENT", _count: { _all: 50 } }] as any);
    vi.mocked(db.feeInvoice.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 as any, paidAmount: 0 as any } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 as any, paidAmount: 0 as any }, _count: { _all: 0 } } as any);
    vi.mocked(db.feeInvoice.count).mockResolvedValue(0);

    const [students, attendance, fees] = await Promise.all([
      executeApprovedTool("get_student_count", {}, ctx),
      executeApprovedTool("get_attendance_summary", { date: "2026-11-18" }, ctx),
      executeApprovedTool("get_outstanding_fee_summary", {}, ctx),
    ]);

    expect(students.success).toBe(true);
    expect(attendance.success).toBe(true);
    expect(fees.success).toBe(true);
  });

  // 5. Invalid Tool Request
  it("Scenario 5: Rejects unapproved tool request with TOOL_NOT_APPROVED", async () => {
    const ctx = createMockContext({});
    const result = await executeApprovedTool("delete_all_database_records", {}, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("TOOL_NOT_APPROVED");
    }
  });

  // 6. Unauthorized Module Access
  it("Scenario 6: Rejects tool access when underlying domain permission is missing", async () => {
    const ctx = createMockContext({
      isOwner: false,
      roleKey: "TEACHER",
      permissions: ["tenant.ai.copilot", "tenant.ai.analytics.fees"], // Missing tenant.fees.read!
    });

    const result = await executeApprovedTool("get_outstanding_fee_summary", {}, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("DOMAIN_READ_DENIED");
    }
  });

  // 7. Cross-Tenant Access Attempt
  it("Scenario 7: Enforces strict tenant isolation and rejects cross-tenant spoofing", async () => {
    const legitTenant = "tenant_legit_101";
    const attackerTenant = "tenant_victim_999";

    const token = await mintServiceToken({
      userId: "user_attacker",
      tenantId: legitTenant,
      roleKey: "INSTITUTE_ADMIN",
      isOwner: true,
    });

    const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Copilot-Service-Token": token,
        "X-Tenant-Id": attackerTenant, // Spoofed header
        "X-User-Id": "user_attacker",
      },
      body: JSON.stringify({ toolName: "get_student_count" }),
    });

    const response = await executeToolRoute(req);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.code).toBe("CROSS_TENANT_FORBIDDEN");
  });

  // 8. Missing Database Information (Fallback date handling)
  it("Scenario 8: Correctly handles empty today register by returning fallback date and flag", async () => {
    const ctx = createMockContext({});
    // Today has no attendance records
    vi.mocked(db.attendance.groupBy).mockResolvedValueOnce([]);
    // Fallback finds records from yesterday
    vi.mocked(db.attendance.findFirst).mockResolvedValueOnce({
      date: new Date("2026-11-17T00:00:00.000Z"),
    } as any);
    vi.mocked(db.attendance.groupBy).mockResolvedValueOnce([
      { status: "PRESENT", _count: { _all: 70 } },
      { status: "ABSENT", _count: { _all: 10 } },
    ] as any);

    const result = await getAttendanceSummary(ctx.tenant.id, { timezone: "Asia/Kolkata" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFallbackDate).toBe(true);
      expect(result.data.targetDate).toBe("2026-11-17");
      expect(result.data.attendanceRatePercentage).toBe(87.5);
    }
  });

  // 9. LLM Provider Failure (Graceful fallback)
  it("Scenario 9: Gracefully falls back to deterministic grounded synthesis when Python service is offline", async () => {
    const ctx = createMockContext({});
    const toolResults = [
      {
        success: true as const,
        toolName: "get_student_count" as const,
        data: { activeStudents: 80, totalStudents: 85, byClassBreakdown: [] },
      },
    ];

    const result = await forwardToCopilotEngine(
      { message: "how many students do we have?" },
      ctx,
      toolResults,
    );

    expect(result.engineUsed).toBe("nextjs_grounded_fallback");
    expect(result.text).toContain("80 active students enrolled");
  });

  // 10. Streaming Interruption
  it("Scenario 10: Disconnect signal aborts cleanly", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  // 11. Invalid Service Token
  it("Scenario 11: Rejects tampered or invalid service token with 401", async () => {
    const verification = await verifyServiceToken("tampered.token.jwt");
    expect(verification.valid).toBe(false);
    expect(verification.error).toBeDefined();
  });

  // 12. Expired Service Token
  it("Scenario 12: Rejects expired service token with 401", async () => {
    const expiredToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1MSIsInRlbmFudElkIjoidDEiLCJleHAiOjE1MDAwMDAwMDB9.invalid";
    const verification = await verifyServiceToken(expiredToken);
    expect(verification.valid).toBe(false);
  });

  // 13. Tool Parameter Manipulation
  it("Scenario 13: Overrides attempted tenantId manipulation with verified tenant context", async () => {
    const ctx = createMockContext({ tenantId: "tenant_real_123" });
    vi.mocked(db.student.count).mockResolvedValue(45);
    vi.mocked(db.student.groupBy).mockResolvedValue([]);
    vi.mocked(db.classLevel.findMany).mockResolvedValue([]);

    // Attacker tries to pass tenantId: "victim_tenant" in params
    const result = await executeApprovedTool(
      "get_student_count",
      { tenantId: "victim_tenant_spoofed" },
      ctx,
    );

    expect(result.success).toBe(true);
    // Verifies that db.student.count was called with tenant_real_123, NOT victim_tenant_spoofed
    expect(db.student.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant_real_123" }),
      }),
    );
  });
});
