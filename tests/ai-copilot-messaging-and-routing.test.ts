import { describe, it, expect, vi, beforeAll } from "vitest";
import { resolveChatIntents } from "@/app/api/copilot/chat/route";
import {
  executeApprovedTool,
  forwardToCopilotEngine,
  resolveToolDeniedMessage,
  isPlatformScopedTool,
  ToolExecutionResult,
} from "@/lib/ai-gateway";
import { evaluateAiPermission } from "@/lib/ai-permissions";
import { db } from "@/lib/db";
import type { TenantContext, TenantAccess } from "@/lib/auth";

describe("AI Copilot Intent Routing & Centralized Permission-Aware Messaging", () => {
  let baseTenant: any;
  let teacherContext: TenantContext;
  let platformOwnerContext: TenantContext;
  let copilotDisabledContext: TenantContext;

  beforeAll(async () => {
    const tenant = await db.tenant.findFirst({
      where: { status: "ACTIVE" },
      include: { subscription: { include: { plan: true } } },
    });
    if (!tenant) throw new Error("No active test tenant found");
    baseTenant = {
      ...tenant,
      subscription: {
        ...tenant.subscription,
        plan: {
          ...tenant.subscription?.plan,
          features: ["core", "attendance", "fees", "ai"],
        },
      },
    };

    teacherContext = {
      user: {
        id: "usr_teacher_test",
        name: "Test Teacher",
        email: "teacher@test.local",
        avatarColor: "#4f46e5",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: baseTenant,
      membership: {
        id: "mem_teacher_test",
        tenantId: baseTenant.id,
        tenantName: baseTenant.name,
        tenantSlug: baseTenant.slug,
        tenantStatus: "ACTIVE",
        tenantType: baseTenant.type,
        roleId: "role_teacher",
        roleName: "Teacher",
        roleKey: "TEACHER",
        isOwner: false,
        permissions: [
          "tenant.ai.copilot",
          "tenant.ai.analytics.attendance",
          "tenant.attendance.read",
        ],
      } as TenantAccess,
      permissions: new Set([
        "tenant.ai.copilot",
        "tenant.ai.analytics.attendance",
        "tenant.attendance.read",
      ]),
      isOwnerView: false,
      subscriptionBlocked: false,
    };

    platformOwnerContext = {
      user: {
        id: "usr_platform_owner",
        name: "Platform Super Admin",
        email: "owner@knowletive.com",
        avatarColor: "#059669",
        isPlatformOwner: true,
        platformPermissions: ["*"],
        memberships: [],
      },
      tenant: baseTenant,
      membership: {
        id: "mem_platform_owner",
        tenantId: baseTenant.id,
        tenantName: "Platform Console",
        tenantSlug: "platform",
        tenantStatus: "ACTIVE",
        tenantType: "SYSTEM",
        roleId: null,
        roleName: "Platform Owner",
        roleKey: "PLATFORM_OWNER",
        isOwner: true,
        permissions: ["*"],
      } as TenantAccess,
      permissions: new Set(["*"]),
      isOwnerView: true,
      subscriptionBlocked: false,
    };

    copilotDisabledContext = {
      ...teacherContext,
      membership: {
        ...teacherContext.membership!,
        permissions: ["tenant.attendance.read"],
      },
      permissions: new Set(["tenant.attendance.read"]),
    };
  });

  // =========================================================================
  // OBJECTIVE 1: INTENT ROUTING
  // =========================================================================

  it("1. Platform-wide requests route to get_platform_metrics even for Teachers (isPlatformOwner = false)", () => {
    const prompt = "Show platform-wide statistics, including total institutes, subscription distribution, and AI credit utilization.";
    const tools = resolveChatIntents(prompt, [], false);
    expect(tools).toContain("get_platform_metrics");
  });

  it("2. 'Total students across all institutes' does not trigger get_student_count", () => {
    const prompt = "Show total institutes, total students across all institutes, subscription distribution and platform-wide AI credits.";
    const tools = resolveChatIntents(prompt, [], false);
    expect(tools).toContain("get_platform_metrics");
    expect(tools).not.toContain("get_student_count");
    expect(tools).not.toContain("get_attendance_summary");
  });

  it("3. Genuine institute student census requests trigger get_student_count", () => {
    const prompt1 = "How many students are enrolled in my institute?";
    const tools1 = resolveChatIntents(prompt1, [], false);
    expect(tools1).toContain("get_student_count");
    expect(tools1).not.toContain("get_platform_metrics");

    const prompt2 = "What is our current student strength and class census breakdown?";
    const tools2 = resolveChatIntents(prompt2, [], false);
    expect(tools2).toContain("get_student_count");
  });

  it("4. Mixed institute and platform queries schedule both relevant sets of tools", () => {
    const mixedPrompt = "Summarize attendance in my assigned batches and also show platform-wide student statistics.";
    const tools = resolveChatIntents(mixedPrompt, [], false);
    expect(tools).toContain("get_platform_metrics");
    expect(tools).toContain("get_attendance_summary");
    expect(tools).not.toContain("get_student_count");
  });

  it("4b. Mixed institute student census and platform query schedules both tools", () => {
    const mixedPrompt = "How many students are enrolled in my institute, and what are the platform-wide institute metrics?";
    const tools = resolveChatIntents(mixedPrompt, [], false);
    expect(tools).toContain("get_platform_metrics");
    expect(tools).toContain("get_student_count");
  });

  // =========================================================================
  // OBJECTIVE 2: PRESERVE BACKEND AUTHORIZATION
  // =========================================================================

  it("5. Teacher platform metrics execution returns structured DENIED without database query", async () => {
    const tenantCountSpy = vi.spyOn(db.tenant, "count");
    const planFindManySpy = vi.spyOn(db.plan, "findMany");

    const result = await executeApprovedTool("get_platform_metrics", {}, teacherContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("DENIED");
      expect(result.error).toMatch(/platform\.overview\.read/i);
    }

    // Invariant: Zero platform database queries executed for unauthorized caller
    expect(tenantCountSpy).not.toHaveBeenCalled();
    expect(planFindManySpy).not.toHaveBeenCalled();

    tenantCountSpy.mockRestore();
    planFindManySpy.mockRestore();
  });

  it("6. Platform Owner platform metrics retrieval succeeds and queries platform metrics", async () => {
    const result = await executeApprovedTool("get_platform_metrics", {}, platformOwnerContext);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.totalTenants).toBeGreaterThan(0);
      expect(typeof data.activeTenants).toBe("number");
      expect(typeof data.totalStudentsAcrossPlatform).toBe("number");
      expect(typeof data.monthlyAiCreditsUsed).toBe("number");
    }
  });

  // =========================================================================
  // OBJECTIVE 3 & 4: CENTRALIZED PERMISSION MESSAGING & LOCAL SYNTHESIS
  // =========================================================================

  it("7. Platform permission denial directs users to Platform Administrator", () => {
    const deniedTool: ToolExecutionResult = {
      success: false,
      toolName: "get_platform_metrics",
      code: "DENIED",
      error: "Permission denied for tool 'get_platform_metrics': Access denied.",
    };

    const msg = resolveToolDeniedMessage(deniedTool);
    expect(msg).toBe("You don't have access to platform-wide information. Please contact your Platform Administrator.");
    expect(msg).not.toMatch(/Institute Owner/i);
  });

  it("8. Institute permission denial directs users to Institute Owner", () => {
    const deniedTools: ToolExecutionResult[] = [
      { success: false, toolName: "get_student_count", code: "DENIED", error: "Permission denied" },
      { success: false, toolName: "get_attendance_summary", code: "DOMAIN_READ_DENIED", error: "Domain denied" },
      { success: false, toolName: "get_student_attendance_details", code: "BATCH_ACCESS_DENIED", error: "Unassigned batch" },
      { success: false, toolName: "get_outstanding_fee_summary", code: "DENIED", error: "Permission denied" },
    ];

    for (const dt of deniedTools) {
      const msg = resolveToolDeniedMessage(dt);
      expect(msg).toBe("You don't have access to this institute information. Please contact your Institute Owner to request access.");
      expect(msg).not.toMatch(/Platform Administrator/i);
    }
  });

  it("9. Copilot capability denial returns exact specified message", () => {
    const check = evaluateAiPermission(copilotDisabledContext, "tenant.ai.copilot");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toBe("AI Copilot is not enabled for your account. Please contact your Institute Owner to request access.");
    }
  });

  it("10. Technical execution failures return appropriate retry message and are not mislabeled as permission denials", () => {
    const execFail: ToolExecutionResult = {
      success: false,
      toolName: "get_student_count",
      code: "EXEC_FAIL",
      error: "Database connection timeout",
    };

    const msg = resolveToolDeniedMessage(execFail);
    expect(msg).toBe("I couldn't retrieve this information right now. Please try again later.");
    expect(msg).not.toMatch(/access/i);
    expect(msg).not.toMatch(/Institute Owner/i);
    expect(msg).not.toMatch(/Platform Administrator/i);
  });

  it("11. All-denied tool request does not produce default welcome greeting", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Offline for unit test"));
    try {
      const deniedPlatformTool: ToolExecutionResult = {
        success: false,
        toolName: "get_platform_metrics",
        code: "DENIED",
        error: "Access denied",
      };

      const synthesis = await forwardToCopilotEngine(
        { message: "Show platform metrics", conversationHistory: [], requestedTools: ["get_platform_metrics"] },
        teacherContext,
        [deniedPlatformTool],
      );

      expect(synthesis.text).toBe("You don't have access to platform-wide information. Please contact your Platform Administrator.");
      expect(synthesis.text).not.toContain("I am your Knowletive AI Copilot. I can assist you with");
      expect(synthesis.text).not.toContain("platform.overview.read");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("12. Partial tool success includes authorized data AND explicit access limitation notice", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Offline for unit test"));
    try {
      const authorizedTool: ToolExecutionResult = {
        success: true,
        toolName: "get_attendance_summary",
        data: {
          targetDate: "2026-11-19",
          attendanceRatePercentage: 95.0,
          present: 38,
          absent: 2,
          totalMarked: 40,
          isFallbackDate: false,
          scopeDescription: "Batch A",
        },
      };

      const deniedTool: ToolExecutionResult = {
        success: false,
        toolName: "get_platform_metrics",
        code: "DENIED",
        error: "Permission denied",
      };

      const synthesis = await forwardToCopilotEngine(
        { message: "Show my attendance and platform stats", conversationHistory: [], requestedTools: ["get_attendance_summary", "get_platform_metrics"] },
        teacherContext,
        [authorizedTool, deniedTool],
      );

      // Must contain the verified factual data
      expect(synthesis.text).toContain("Attendance for 2026-11-19");
      expect(synthesis.text).toContain("Rate is 95%");

      // Must append the partial-access notice directing to Platform Administrator
      expect(synthesis.text).toContain("⚠️ **Access Notice:** I retrieved the information you are authorized to view.");
      expect(synthesis.text).toContain("You don't have access to platform-wide information. Please contact your Platform Administrator.");

      // Must NEVER leak raw permission keys or stack traces
      expect(synthesis.text).not.toContain("platform.overview.read");
      expect(synthesis.text).not.toContain("Error:");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("13. Scope classification helper accurately categorizes tools", () => {
    expect(isPlatformScopedTool("get_platform_metrics")).toBe(true);
    expect(isPlatformScopedTool("get_student_count")).toBe(false);
    expect(isPlatformScopedTool("get_attendance_summary")).toBe(false);
    expect(isPlatformScopedTool("get_student_attendance_details")).toBe(false);
    expect(isPlatformScopedTool("get_outstanding_fee_summary")).toBe(false);
  });
});
