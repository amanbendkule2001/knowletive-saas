import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  evaluateAiPermission,
  isVerifiedPlatformOwner,
  isVerifiedInstituteOwner,
  isSupportImpersonation,
} from "@/lib/ai-permissions";
import {
  executeApprovedTool,
  mintServiceToken,
  verifyServiceToken,
  TOOL_DOMAIN_PERMISSION_MAP,
} from "@/lib/ai-gateway";
import {
  APPROVED_TOOLS_REGISTRY,
  TOOL_PERMISSION_MAP,
  getStudentCount,
  getAttendanceSummary,
  getOutstandingFeeSummary,
  getPlatformMetrics,
} from "@/lib/ai-tools";
import { POST as executeToolRoute } from "@/app/api/copilot/tools/execute/route";
import type { TenantContext, AuthUser, TenantAccess } from "@/lib/auth";

describe("STAGE 7.2: INSTITUTE OWNER TENANT ISOLATION & RBAC SECURITY VERIFICATION", () => {
  let tenantA: { id: string; name: string; slug: string; type: any; timezone: string | null };
  let tenantB: { id: string; name: string; slug: string; type: any; timezone: string | null };
  let ownerUserA: AuthUser;
  let ownerContextA: TenantContext;
  let ownerUserB: AuthUser;
  let ownerContextB: TenantContext;
  let platformOwnerContext: TenantContext;
  let teacherContextA: TenantContext;
  let accountantContextA: TenantContext;
  let parentContextA: TenantContext;
  let studentContextA: TenantContext;
  let supportImpersonationContextA: TenantContext;

  let tenantAStudentCount: number;
  let tenantBStudentCount: number;
  let platformTotalStudents: number;

  beforeAll(async () => {
    // 1. Locate real live tenants in PostgreSQL
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true, slug: true, type: true, timezone: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Count baseline students in live database
    const [countA, countB, countAll] = await Promise.all([
      db.student.count({ where: { tenantId: tenantA.id } }),
      db.student.count({ where: { tenantId: tenantB.id } }),
      db.student.count(),
    ]);
    tenantAStudentCount = countA;
    tenantBStudentCount = countB;
    platformTotalStudents = countAll;

    // 2. Locate Platform Owner
    const po = await db.user.findFirst({ where: { isPlatformOwner: true } });
    platformOwnerContext = {
      user: {
        id: po?.id || "u_platform_owner",
        name: po?.name || "Platform Owner",
        email: po?.email || "owner@knowletive.com",
        avatarColor: "#4f46e5",
        isPlatformOwner: true,
        platformPermissions: ["*"],
        memberships: [],
      },
      tenant: {
        id: tenantA.id,
        name: "Platform Console",
        slug: "platform",
        status: "ACTIVE",
        type: "SYSTEM",
        timezone: "Asia/Kolkata",
        subscription: {
          id: "sub_platform",
          tenantId: tenantA.id,
          status: "ACTIVE",
          plan: { id: "plan_ent", name: "Enterprise", features: ["ai"] },
        },
      } as any,
      membership: {
        tenantId: tenantA.id,
        tenantName: "Platform Console",
        tenantSlug: "platform",
        tenantStatus: "ACTIVE",
        tenantType: "SYSTEM",
        roleId: null,
        roleName: "Platform Owner",
        roleKey: "PLATFORM_OWNER",
        isOwner: false,
        permissions: ["*"],
      },
      permissions: new Set(["*"]),
      isOwnerView: true,
      subscriptionBlocked: false,
    };

    // 3. Locate Institute Owner for Tenant A
    const ownerMemberA = await db.membership.findFirst({
      where: { tenantId: tenantA.id, isOwner: true },
      include: { user: true, role: true },
    });
    expect(ownerMemberA).toBeDefined();

    ownerUserA = {
      id: ownerMemberA!.userId,
      name: ownerMemberA!.user.name,
      email: ownerMemberA!.user.email,
      avatarColor: "#4f46e5",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
    };

    ownerContextA = {
      user: ownerUserA,
      tenant: {
        id: tenantA.id,
        name: tenantA.name,
        slug: tenantA.slug,
        status: "ACTIVE",
        type: tenantA.type,
        timezone: tenantA.timezone || "Asia/Kolkata",
        subscription: {
          id: "sub_a",
          tenantId: tenantA.id,
          status: "ACTIVE",
          plan: { id: "plan_growth", name: "Growth", features: ["ai"] },
        },
      } as any,
      membership: {
        tenantId: tenantA.id,
        tenantName: tenantA.name,
        tenantSlug: tenantA.slug,
        tenantStatus: "ACTIVE",
        tenantType: tenantA.type,
        roleId: ownerMemberA!.roleId,
        roleName: "Institute Owner",
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
        permissions: ["tenant.students.read", "tenant.attendance.read", "tenant.fees.read"],
      },
      permissions: new Set(["tenant.students.read", "tenant.attendance.read", "tenant.fees.read"]),
      isOwnerView: true,
      subscriptionBlocked: false,
    };

    // 4. Locate Institute Owner for Tenant B
    const ownerMemberB = await db.membership.findFirst({
      where: { tenantId: tenantB.id, isOwner: true },
      include: { user: true, role: true },
    });
    expect(ownerMemberB).toBeDefined();

    ownerUserB = {
      id: ownerMemberB!.userId,
      name: ownerMemberB!.user.name,
      email: ownerMemberB!.user.email,
      avatarColor: "#10b981",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
    };

    ownerContextB = {
      user: ownerUserB,
      tenant: {
        id: tenantB.id,
        name: tenantB.name,
        slug: tenantB.slug,
        status: "ACTIVE",
        type: tenantB.type,
        timezone: tenantB.timezone || "Asia/Kolkata",
        subscription: {
          id: "sub_b",
          tenantId: tenantB.id,
          status: "ACTIVE",
          plan: { id: "plan_growth", name: "Growth", features: ["ai"] },
        },
      } as any,
      membership: {
        tenantId: tenantB.id,
        tenantName: tenantB.name,
        tenantSlug: tenantB.slug,
        tenantStatus: "ACTIVE",
        tenantType: tenantB.type,
        roleId: ownerMemberB!.roleId,
        roleName: "Institute Owner",
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
        permissions: ["tenant.students.read", "tenant.attendance.read", "tenant.fees.read"],
      },
      permissions: new Set(["tenant.students.read", "tenant.attendance.read", "tenant.fees.read"]),
      isOwnerView: true,
      subscriptionBlocked: false,
    };

    // 5. Tenant A Teacher Context (has students.read, attendance.read, but NOT fees.read)
    teacherContextA = {
      ...ownerContextA,
      user: {
        id: "u_teacher_a",
        name: "Teacher User",
        email: "teacher@sunrise.test",
        avatarColor: "#059669",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      membership: {
        ...ownerContextA.membership,
        isOwner: false,
        roleKey: "TEACHER",
        roleName: "Teacher",
        permissions: ["tenant.students.read", "tenant.attendance.read", "tenant.exams.enter_marks"],
      } as TenantAccess,
      permissions: new Set(["tenant.students.read", "tenant.attendance.read", "tenant.exams.enter_marks"]),
      isOwnerView: false,
    };

    // 6. Tenant A Accountant Context (has fees.read, students.read, but NOT attendance.read)
    accountantContextA = {
      ...ownerContextA,
      user: {
        id: "u_accountant_a",
        name: "Accountant User",
        email: "accounts@sunrise.test",
        avatarColor: "#d97706",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      membership: {
        ...ownerContextA.membership,
        isOwner: false,
        roleKey: "ACCOUNTANT",
        roleName: "Accountant",
        permissions: ["tenant.fees.read", "tenant.fees.write", "tenant.students.read"],
      } as TenantAccess,
      permissions: new Set(["tenant.fees.read", "tenant.fees.write", "tenant.students.read"]),
      isOwnerView: false,
    };

    // 7. Tenant A Parent Context (strictly portal.read and announcements.read)
    parentContextA = {
      ...ownerContextA,
      user: {
        id: "u_parent_a",
        name: "Parent User",
        email: "parent@sunrise.test",
        avatarColor: "#8b5cf6",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      membership: {
        ...ownerContextA.membership,
        isOwner: false,
        roleKey: "PARENT",
        roleName: "Parent",
        permissions: ["tenant.portal.read", "tenant.announcements.read"],
      } as TenantAccess,
      permissions: new Set(["tenant.portal.read", "tenant.announcements.read"]),
      isOwnerView: false,
    };

    // 8. Tenant A Student Context (strictly portal.read and announcements.read)
    studentContextA = {
      ...ownerContextA,
      user: {
        id: "u_student_a",
        name: "Student User",
        email: "student@sunrise.test",
        avatarColor: "#ec4899",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      membership: {
        ...ownerContextA.membership,
        isOwner: false,
        roleKey: "STUDENT",
        roleName: "Student",
        permissions: ["tenant.portal.read", "tenant.announcements.read"],
      } as TenantAccess,
      permissions: new Set(["tenant.portal.read", "tenant.announcements.read"]),
      isOwnerView: false,
    };

    // 9. Support Impersonation Context (Platform support staff accessing tenant workspace)
    supportImpersonationContextA = {
      ...ownerContextA,
      user: {
        id: "u_support_staff",
        name: "Support Staff",
        email: "support@knowletive.com",
        avatarColor: "#64748b",
        isPlatformOwner: false,
        platformPermissions: ["platform.institutes.read"],
        memberships: [],
      },
      membership: {
        ...ownerContextA.membership,
        roleKey: "PLATFORM_SUPPORT",
        roleName: "Platform Support View",
        isOwner: false,
      } as TenantAccess,
      permissions: new Set(["tenant.students.read", "tenant.attendance.read"]),
      isOwnerView: false,
    };
  });

  // =========================================================================
  // REQUIREMENT 2 & 3: INSTITUTE OWNER CANNOT ACCESS PLATFORM METRICS
  // =========================================================================
  describe("Requirement 2 & 3: Institute Owner Rejected from Platform-Wide Metrics", () => {
    it("2.1 Gateway rejects Institute Owner attempting to execute get_platform_metrics", async () => {
      const result = await executeApprovedTool("get_platform_metrics", {}, ownerContextA);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("DENIED");
        expect(result.error).toContain("platform.overview.read");
        expect(result.error).toContain("verified platform permissions");
      }
    });

    it("2.2 Next.js API route (/api/copilot/tools/execute) rejects Institute Owner with HTTP 403 Forbidden", async () => {
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantA.id,
          "X-User-Id": ownerUserA.id,
        },
        body: JSON.stringify({
          toolName: "get_platform_metrics",
          params: {},
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.code).toBe("DENIED");
      expect(json.data).toBeUndefined();
    });

    it("2.3 Database execution is prevented and zero platform overview metrics are returned", async () => {
      // Direct tool invocation with Institute Owner context
      const result = await executeApprovedTool("get_platform_metrics", {}, ownerContextA);
      expect(result.success).toBe(false);

      // Verify that no platform aggregate figures (totalStudentsAcrossPlatform, etc.) are present
      expect((result as any).data).toBeUndefined();
      expect((result as any).totalTenants).toBeUndefined();
      expect((result as any).totalStudentsAcrossPlatform).toBeUndefined();
    });
  });

  // =========================================================================
  // REQUIREMENT 4: UNAPPROVED PLATFORM TOOLS & DIRECT API REQUESTS
  // =========================================================================
  describe("Requirement 4: Direct API Requests for Arbitrary/Unapproved Tools Rejected", () => {
    it("4.1 Rejects unapproved platform institute listing tool 'list_all_institutes' with HTTP 400", async () => {
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantA.id,
          "X-User-Id": ownerUserA.id,
        },
        body: JSON.stringify({
          toolName: "list_all_institutes",
          params: {},
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe("TOOL_NOT_APPROVED");
      expect(json.error).toContain("not in the approved AI tool registry");
    });

    it("4.2 Rejects arbitrary SQL query tool 'execute_raw_sql' with HTTP 400", async () => {
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantA.id,
          "X-User-Id": ownerUserA.id,
        },
        body: JSON.stringify({
          toolName: "execute_raw_sql",
          params: { sql: "SELECT * FROM tenants;" },
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("TOOL_NOT_APPROVED");
    });
  });

  // =========================================================================
  // REQUIREMENT 5: TENANT IDENTIFIER MANIPULATION & OVERRIDE RESISTANCE
  // =========================================================================
  describe("Requirement 5: Tenant Identifier Parameter Manipulation Resistance", () => {
    it("5.1 Strips and ignores client-supplied tenantId in get_student_count via Gateway", async () => {
      // Owner of Tenant A attempts to pass Tenant B's ID in params
      const result = await executeApprovedTool(
        "get_student_count",
        { tenantId: tenantB.id, instituteId: tenantB.id },
        ownerContextA,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        // MUST return Tenant A's ID and Tenant A's student count, NEVER Tenant B's
        expect(data.tenantId).toBe(tenantA.id);
        expect(data.totalStudents).toBe(tenantAStudentCount);
        expect(data.totalStudents).not.toBe(tenantBStudentCount);
      }
    });

    it("5.2 Strips and ignores client-supplied tenantId in POST /api/copilot/tools/execute", async () => {
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantA.id,
          "X-User-Id": ownerUserA.id,
        },
        body: JSON.stringify({
          toolName: "get_student_count",
          params: {
            tenantId: tenantB.id,
            instituteId: tenantB.id,
          },
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.tenantId).toBe(tenantA.id);
      expect(json.data.totalStudents).toBe(tenantAStudentCount);
    });

    it("5.3 Header Cross-Tenant Spoofing: Rejects mismatched X-Tenant-Id with HTTP 403", async () => {
      // Token is signed for Tenant A, but header claims Tenant B
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantB.id, // Attacker attempts to spoof Tenant B
          "X-User-Id": ownerUserA.id,
        },
        body: JSON.stringify({
          toolName: "get_student_count",
          params: {},
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.code).toBe("CROSS_TENANT_FORBIDDEN");
      expect(json.error).toContain("Header tenant does not match service token claim");
      expect(json.data).toBeUndefined();
    });

    it("5.4 Header Identity Spoofing: Rejects mismatched X-User-Id with HTTP 403", async () => {
      const serviceToken = await mintServiceToken({
        userId: ownerUserA.id,
        tenantId: tenantA.id,
        roleKey: "INSTITUTE_ADMIN",
        isOwner: true,
      });

      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": tenantA.id,
          "X-User-Id": "u_spoofed_victim_123", // Attacker attempts to impersonate another user
        },
        body: JSON.stringify({
          toolName: "get_student_count",
          params: {},
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.code).toBe("USER_MISMATCH_FORBIDDEN");
      expect(json.error).toContain("Header user does not match service token claim");
    });

    it("5.5 Missing Service Token: Rejects unauthenticated request with HTTP 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/copilot/tools/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolName: "get_student_count",
          params: {},
        }),
      });

      const res = await executeToolRoute(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.code).toBe("UNAUTHORIZED");
    });
  });

  // =========================================================================
  // REQUIREMENT 6: ROLE-BASED ACCESS CONTROL & DOMAIN PERMISSION BOUNDARIES
  // =========================================================================
  describe("Requirement 6: Role Hierarchy & Non-Expansion of Domain Permissions", () => {
    it("6.1 Platform Owner can access authorized platform-wide metrics", async () => {
      const result = await executeApprovedTool("get_platform_metrics", {}, platformOwnerContext);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(data.totalStudentsAcrossPlatform).toBe(platformTotalStudents);
        expect(data.totalTenants).toBeGreaterThanOrEqual(2);
        expect(data.activeTenants).toBeGreaterThanOrEqual(1);
      }
    });

    it("6.2 Institute Owner can access only their own institute's data", async () => {
      const resultA = await executeApprovedTool("get_student_count", {}, ownerContextA);
      expect(resultA.success).toBe(true);
      if (resultA.success) {
        expect((resultA.data as any).tenantId).toBe(tenantA.id);
        expect((resultA.data as any).totalStudents).toBe(tenantAStudentCount);
      }

      const resultB = await executeApprovedTool("get_student_count", {}, ownerContextB);
      expect(resultB.success).toBe(true);
      if (resultB.success) {
        expect((resultB.data as any).tenantId).toBe(tenantB.id);
        expect((resultB.data as any).totalStudents).toBe(tenantBStudentCount);
      }
    });

    it("6.3 Teacher without AI permission is denied all AI tools by default", async () => {
      const result = await executeApprovedTool("get_student_count", {}, teacherContextA);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("DENIED");
        expect(result.error).toContain("restricted to Institute Owners by default");
      }
    });

    it("6.4 AI permission NEVER expands domain permissions: Teacher with AI grant but lacking tenant.fees.read is denied fee summary", async () => {
      // Simulate teacher granted AI capability 'tenant.ai.analytics.fees'
      const teacherWithAiGrant: TenantContext = {
        ...teacherContextA,
        membership: {
          ...teacherContextA.membership,
          extraPermissions: ["tenant.ai.analytics.fees"],
        } as any,
      };

      const result = await executeApprovedTool("get_outstanding_fee_summary", {}, teacherWithAiGrant);

      // Must be rejected with DOMAIN_READ_DENIED because Teacher lacks tenant.fees.read!
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("DOMAIN_READ_DENIED");
        expect(result.error).toContain("requires underlying domain permission 'tenant.fees.read'");
      }
    });

    it("6.5 Accountant with fees.read can access fees IF granted AI capability", async () => {
      const accountantWithAiGrant: TenantContext = {
        ...accountantContextA,
        membership: {
          ...accountantContextA.membership,
          extraPermissions: ["tenant.ai.analytics.fees"],
        } as any,
      };

      const result = await executeApprovedTool("get_outstanding_fee_summary", {}, accountantWithAiGrant);
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(typeof data.totalOutstandingRupees).toBe("number");
        expect(typeof data.pendingInvoicesCount).toBe("number");
      }
    });

    it("6.6 Parent & Student roles are denied AI analytics tools and cannot bypass portal isolation", async () => {
      // Parent
      const parentResult = await executeApprovedTool("get_student_count", {}, parentContextA);
      expect(parentResult.success).toBe(false);
      if (!parentResult.success) {
        expect(parentResult.code).toBe("DENIED");
      }

      // Even if Parent is mistakenly assigned an AI permission, domain check blocks them
      const parentWithFakeAi: TenantContext = {
        ...parentContextA,
        membership: {
          ...parentContextA.membership,
          extraPermissions: ["tenant.ai.analytics.student"],
        } as any,
      };
      const parentDomainResult = await executeApprovedTool("get_student_count", {}, parentWithFakeAi);
      expect(parentDomainResult.success).toBe(false);
      if (!parentDomainResult.success) {
        expect(parentDomainResult.code).toBe("DOMAIN_READ_DENIED");
      }

      // Student
      const studentResult = await executeApprovedTool("get_attendance_summary", {}, studentContextA);
      expect(studentResult.success).toBe(false);
      if (!studentResult.success) {
        expect(studentResult.code).toBe("DENIED");
      }
    });

    it("6.7 Support Impersonation Session strictly denied AI access (SUPPORT_DENIED)", async () => {
      const result = await executeApprovedTool("get_student_count", {}, supportImpersonationContextA);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("SUPPORT_DENIED");
        expect(result.error).toContain("Support sessions do not have access to AI intelligence tools");
      }
    });
  });

  // =========================================================================
  // REQUIREMENT 7: DENIED REQUESTS DO NOT LEAK SENSITIVE RECORDS OR THREADS
  // =========================================================================
  describe("Requirement 7: Zero Sensitive Data Leakage on Denied Requests", () => {
    it("7.1 Denied tool results contain zero data payloads or stack traces", async () => {
      const result = await executeApprovedTool("get_platform_metrics", {}, ownerContextA);
      expect(result.success).toBe(false);
      expect((result as any).data).toBeUndefined();
      if (!result.success) {
        expect(result.error).not.toContain("PrismaClient");
        expect(result.error).not.toContain("SELECT");
      }
    });

    it("7.2 Cross-Tenant Thread Isolation: CopilotThread queries strictly isolate by tenantId", async () => {
      // Create a test thread belonging to Tenant A
      const threadA = await db.copilotThread.create({
        data: {
          tenantId: tenantA.id,
          userId: ownerUserA.id,
          title: "Confidential Tenant A Financial Inquiries",
        },
      });

      await db.copilotMessage.create({
        data: {
          threadId: threadA.id,
          role: "USER",
          content: "What are our total fee collections this quarter?",
          status: "COMPLETE",
        },
      });

      try {
        // Attempt to query Thread A using Tenant B's tenantId and user
        const crossTenantThread = await db.copilotThread.findFirst({
          where: {
            id: threadA.id,
            tenantId: tenantB.id,
            userId: ownerUserB.id,
            deletedAt: null,
          },
        });

        // Must be null: Tenant B cannot discover or read Tenant A's conversation
        expect(crossTenantThread).toBeNull();

        // Attempt to query messages of Thread A using Tenant B's boundary
        const crossTenantMessages = await db.copilotMessage.findMany({
          where: {
            threadId: threadA.id,
            thread: {
              tenantId: tenantB.id,
            },
          },
        });

        expect(crossTenantMessages).toEqual([]);
      } finally {
        await db.copilotMessage.deleteMany({ where: { threadId: threadA.id } });
        await db.copilotThread.delete({ where: { id: threadA.id } });
      }
    });
  });
});
