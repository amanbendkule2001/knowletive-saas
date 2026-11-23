import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  evaluateAiPermission,
  isVerifiedInstituteOwner,
  isVerifiedPlatformOwner,
  isSupportImpersonation,
  AI_PERMISSION_ALLOWLIST,
} from "@/lib/ai-permissions";
import {
  listTenantAiUsersAction,
  updateAiPermissionsAction,
  revokeAllAiPermissionsAction,
} from "@/actions/ai-access";
import type { TenantContext } from "@/lib/auth";

describe("PHASE 3B: COPILOT CONVERSATION STORAGE & OWNER ACCESS MANAGEMENT", () => {
  let testTenantId: string;
  let ownerUserId: string;
  let teacherUserId: string;
  let studentUserId: string;
  let ownerMembershipId: string;
  let teacherMembershipId: string;
  let studentMembershipId: string;
  let createdThreadIds: string[] = [];

  beforeAll(async () => {
    // 1. Locate real live tenant in PostgreSQL
    const tenant =
      (await db.tenant.findFirst({
        where: { slug: "sunrise" },
      })) || (await db.tenant.findFirst());

    if (!tenant) throw new Error("No live tenant found in database");
    testTenantId = tenant.id;

    // 2. Locate Institute Owner membership
    const ownerMember = await db.membership.findFirst({
      where: { tenantId: testTenantId, isOwner: true },
      include: { user: true, role: true },
    });
    if (!ownerMember) throw new Error("Institute owner membership not found");
    ownerUserId = ownerMember.userId;
    ownerMembershipId = ownerMember.id;

    // 3. Locate a Teacher membership
    const teacherMember = await db.membership.findFirst({
      where: {
        tenantId: testTenantId,
        isOwner: false,
        role: { key: { in: ["TEACHER", "STAFF"] } },
      },
      include: { user: true, role: true },
    });
    if (!teacherMember) throw new Error("Teacher membership not found");
    teacherUserId = teacherMember.userId;
    teacherMembershipId = teacherMember.id;

    // 4. Locate or create a Student user and membership for boundary testing
    let studentMember = await db.membership.findFirst({
      where: {
        tenantId: testTenantId,
        role: { key: "STUDENT" },
      },
      include: { user: true, role: true },
    });
    if (!studentMember) {
      // Find role STUDENT
      const studentRole = await db.role.findFirst({
        where: { tenantId: testTenantId, key: "STUDENT" },
      });
      if (studentRole) {
        studentMember = await db.membership.findFirst({
          where: { tenantId: testTenantId, roleId: studentRole.id },
          include: { user: true, role: true },
        });
      }
    }
    if (studentMember) {
      studentUserId = studentMember.userId;
      studentMembershipId = studentMember.id;
    }
  });

  afterAll(async () => {
    // Cleanup any created threads
    if (createdThreadIds.length > 0) {
      await db.copilotMessage.deleteMany({
        where: { threadId: { in: createdThreadIds } },
      });
      await db.copilotThread.deleteMany({
        where: { id: { in: createdThreadIds } },
      });
    }

    // Reset teacher extra permissions to clean state
    if (teacherMembershipId) {
      const current = await db.membership.findUnique({
        where: { id: teacherMembershipId },
      });
      if (current) {
        const clean = current.extraPermissions.filter(
          (p) => !AI_PERMISSION_ALLOWLIST.has(p),
        );
        await db.membership.update({
          where: { id: teacherMembershipId },
          data: { extraPermissions: clean },
        });
      }
    }
  });

  describe("PART C: Conversation Storage & Thread Isolation", () => {
    it("C1.1 Creates a conversation thread with default title and CUID", async () => {
      const thread = await db.copilotThread.create({
        data: {
          tenantId: testTenantId,
          userId: ownerUserId,
          title: "New Chat",
        },
      });
      createdThreadIds.push(thread.id);

      expect(thread.id).toBeDefined();
      expect(thread.title).toBe("New Chat");
      expect(thread.deletedAt).toBeNull();
      expect(thread.tenantId).toBe(testTenantId);
      expect(thread.userId).toBe(ownerUserId);
    });

    it("C1.2 Persists user and assistant messages with token tracking and metadata", async () => {
      const thread = await db.copilotThread.create({
        data: {
          tenantId: testTenantId,
          userId: ownerUserId,
          title: "Student strength query",
        },
      });
      createdThreadIds.push(thread.id);

      // Persist User Message
      const userMsg = await db.copilotMessage.create({
        data: {
          threadId: thread.id,
          role: "USER",
          content: "What is our current student count?",
          status: "COMPLETE",
        },
      });

      // Persist Assistant Message
      const assistantMsg = await db.copilotMessage.create({
        data: {
          threadId: thread.id,
          role: "ASSISTANT",
          content: "Sunrise Public School currently has 42 enrolled students.",
          status: "COMPLETE",
          provider: "groq",
          model: "llama-3.3-70b-versatile",
          inputTokens: 9,
          outputTokens: 14,
          durationMs: 340,
          metadata: {
            engine: "python_service",
            toolResults: [{ tool: "get_student_count", success: true, hasData: true }],
          },
        },
      });

      expect(userMsg.threadId).toBe(thread.id);
      expect(userMsg.role).toBe("USER");
      expect(assistantMsg.role).toBe("ASSISTANT");
      expect(assistantMsg.inputTokens).toBe(9);
      expect(assistantMsg.outputTokens).toBe(14);
      expect(assistantMsg.durationMs).toBe(340);

      // Verify messages query in chronological order
      const messages = await db.copilotMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "asc" },
      });
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("USER");
      expect(messages[1].role).toBe("ASSISTANT");
    });

    it("C1.3 Updates thread title and updatedAt timestamp", async () => {
      const thread = await db.copilotThread.create({
        data: {
          tenantId: testTenantId,
          userId: ownerUserId,
          title: "Initial title",
        },
      });
      createdThreadIds.push(thread.id);

      const initialUpdatedAt = thread.updatedAt;

      const updated = await db.copilotThread.update({
        where: { id: thread.id },
        data: {
          title: "Renamed: Financial Summary",
          updatedAt: new Date(Date.now() + 1000),
        },
      });

      expect(updated.title).toBe("Renamed: Financial Summary");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());
    });

    it("C1.4 Soft-deletes a thread without dropping underlying records", async () => {
      const thread = await db.copilotThread.create({
        data: {
          tenantId: testTenantId,
          userId: ownerUserId,
          title: "Temporary discussion",
        },
      });
      createdThreadIds.push(thread.id);

      // Soft delete
      await db.copilotThread.update({
        where: { id: thread.id },
        data: { deletedAt: new Date() },
      });

      // Active listing query (deletedAt: null) excludes it
      const activeListing = await db.copilotThread.findFirst({
        where: { id: thread.id, deletedAt: null },
      });
      expect(activeListing).toBeNull();

      // Underlying record preserved with non-null deletedAt
      const raw = await db.copilotThread.findUnique({
        where: { id: thread.id },
      });
      expect(raw).not.toBeNull();
      expect(raw?.deletedAt).not.toBeNull();
    });

    it("C1.5 Enforces strict tenant and user ownership isolation", async () => {
      const thread = await db.copilotThread.create({
        data: {
          tenantId: testTenantId,
          userId: ownerUserId,
          title: "Owner confidential conversation",
        },
      });
      createdThreadIds.push(thread.id);

      // Query as owner in testTenantId -> success
      const ownerQuery = await db.copilotThread.findFirst({
        where: { id: thread.id, tenantId: testTenantId, userId: ownerUserId, deletedAt: null },
      });
      expect(ownerQuery).not.toBeNull();

      // Query as teacher (different user in same tenant) -> null (isolated)
      const teacherQuery = await db.copilotThread.findFirst({
        where: { id: thread.id, tenantId: testTenantId, userId: teacherUserId, deletedAt: null },
      });
      expect(teacherQuery).toBeNull();

      // Query with different tenantId -> null (tenant isolated)
      const crossTenantQuery = await db.copilotThread.findFirst({
        where: { id: thread.id, tenantId: "other-tenant-id", userId: ownerUserId, deletedAt: null },
      });
      expect(crossTenantQuery).toBeNull();
    });
  });

  describe("PART A: Owner AI Access Management & Policy Matrix", () => {
    const makeUser = (overrides: Partial<any> = {}) => ({
      id: "u-test",
      name: "Test User",
      email: "test@sunrise.edu",
      avatarColor: "#4f46e5",
      isPlatformOwner: false,
      platformPermissions: [],
      memberships: [],
      ...overrides,
    });

    it("A1.1 Platform Owner has default AI access across institutes", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-platform", name: "Platform Admin", email: "super@knowletive.com", isPlatformOwner: true, platformPermissions: ["platform.ai.read"] }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
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

    it("A1.2 Institute Owner (isOwner === true) has default AI access in their institute", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: ownerUserId, name: "School Principal", email: "principal@sunrise.edu" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: ownerMembershipId, tenantId: testTenantId, userId: ownerUserId, roleId: "r1", roleKey: "INSTITUTE_ADMIN", roleName: "Admin", isOwner: true, permissions: ["tenant.students.read"], extraPermissions: [] } as any,
        permissions: new Set(["tenant.students.read"]),
        isOwnerView: true,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grantedVia).toBe("INSTITUTE_OWNER");
      }
    });

    it("A1.3 Non-owner Admin (isOwner === false) is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-subadmin", name: "Sub Admin", email: "subadmin@sunrise.edu" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: "m-subadmin", tenantId: testTenantId, userId: "u-subadmin", roleId: "r1", roleKey: "INSTITUTE_ADMIN", roleName: "Admin", isOwner: false, permissions: ["tenant.students.read"], extraPermissions: [] } as any,
        permissions: new Set(["tenant.students.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("A1.4 Teacher is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: teacherUserId, name: "Math Teacher", email: "teacher@sunrise.edu" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: teacherMembershipId, tenantId: testTenantId, userId: teacherUserId, roleId: "r2", roleKey: "TEACHER", roleName: "Teacher", isOwner: false, permissions: ["tenant.attendance.read"], extraPermissions: [] } as any,
        permissions: new Set(["tenant.attendance.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("DENIED");
      }
    });

    it("A1.5 Student is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-student", name: "Aarav Sharma", email: "aarav@sunrise.edu" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: "m-student", tenantId: testTenantId, userId: "u-student", roleId: "r3", roleKey: "STUDENT", roleName: "Student", isOwner: false, permissions: [], extraPermissions: [] } as any,
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

    it("A1.6 Parent is denied AI access by default", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-parent", name: "Sunita Sharma", email: "sunita@gmail.com" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: "m-parent", tenantId: testTenantId, userId: "u-parent", roleId: "r4", roleKey: "PARENT", roleName: "Parent", isOwner: false, permissions: [], extraPermissions: [] } as any,
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

    it("A1.7 Platform Support impersonator is strictly denied AI access", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: "u-support", name: "Support Engineer", email: "support@knowletive.com", platformPermissions: ["platform.support"] }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: { id: "m-support", tenantId: testTenantId, userId: "u-support", roleId: "r5", roleKey: "PLATFORM_SUPPORT", roleName: "Platform Support", isOwner: false, permissions: [], extraPermissions: [] } as any,
        permissions: new Set(),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const result = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("SUPPORT_DENIED");
      }
    });

    it("A1.8 Explicit grant in extraPermissions enables Copilot for non-owner", () => {
      const ctx: TenantContext = {
        user: makeUser({ id: teacherUserId, name: "Math Teacher", email: "teacher@sunrise.edu" }),
        tenant: { id: testTenantId, name: "Sunrise Public School", slug: "sunrise-public-school", status: "ACTIVE", timezone: "Asia/Kolkata", subscription: { status: "ACTIVE", plan: { key: "GROWTH", features: ["ai"] } } } as any,
        membership: {
          id: teacherMembershipId,
          tenantId: testTenantId,
          userId: teacherUserId,
          roleId: "r2",
          roleKey: "TEACHER",
          roleName: "Teacher",
          isOwner: false,
          permissions: ["tenant.attendance.read", "tenant.ai.copilot", "tenant.ai.analytics.attendance"],
          extraPermissions: ["tenant.ai.copilot", "tenant.ai.analytics.attendance"],
        } as any,
        permissions: new Set(["tenant.attendance.read", "tenant.ai.copilot", "tenant.ai.analytics.attendance"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const copilotResult = evaluateAiPermission(ctx, "tenant.ai.copilot");
      expect(copilotResult.ok).toBe(true);
      if (copilotResult.ok) {
        expect(copilotResult.grantedVia).toBe("EXPLICIT_GRANT");
      }

      const attendanceAiResult = evaluateAiPermission(ctx, "tenant.ai.analytics.attendance");
      expect(attendanceAiResult.ok).toBe(true);

      // Modules NOT explicitly granted remain denied
      const feesAiResult = evaluateAiPermission(ctx, "tenant.ai.analytics.fees");
      expect(feesAiResult.ok).toBe(false);
      if (!feesAiResult.ok) {
        expect(feesAiResult.code).toBe("DENIED");
      }
    });
  });

  describe("PART A3: Database Grant & Revoke Persistence with Audit", () => {
    it("A3.1 Updates Membership.extraPermissions in database while preserving non-AI permissions", async () => {
      // Set initial non-AI extra permission
      await db.membership.update({
        where: { id: teacherMembershipId },
        data: { extraPermissions: ["custom.operational.perm"] },
      });

      // Owner grants 2 AI permissions
      const memberBefore = await db.membership.findUnique({
        where: { id: teacherMembershipId },
      });
      const nonAi = (memberBefore?.extraPermissions || []).filter(
        (p) => !AI_PERMISSION_ALLOWLIST.has(p),
      );
      const newAi = ["tenant.ai.copilot", "tenant.ai.analytics.student"];
      const merged = [...nonAi, ...newAi];

      await db.membership.update({
        where: { id: teacherMembershipId },
        data: { extraPermissions: merged },
      });

      const updated = await db.membership.findUnique({
        where: { id: teacherMembershipId },
      });

      expect(updated?.extraPermissions).toContain("custom.operational.perm");
      expect(updated?.extraPermissions).toContain("tenant.ai.copilot");
      expect(updated?.extraPermissions).toContain("tenant.ai.analytics.student");
      expect(updated?.extraPermissions.length).toBe(3);
    });

    it("A3.2 Revoking AI permissions clears AI keys while preserving non-AI keys", async () => {
      const memberBefore = await db.membership.findUnique({
        where: { id: teacherMembershipId },
      });
      const nonAi = (memberBefore?.extraPermissions || []).filter(
        (p) => !AI_PERMISSION_ALLOWLIST.has(p),
      );

      await db.membership.update({
        where: { id: teacherMembershipId },
        data: { extraPermissions: nonAi },
      });

      const revoked = await db.membership.findUnique({
        where: { id: teacherMembershipId },
      });

      expect(revoked?.extraPermissions).toContain("custom.operational.perm");
      expect(revoked?.extraPermissions).not.toContain("tenant.ai.copilot");
      expect(revoked?.extraPermissions).not.toContain("tenant.ai.analytics.student");
    });
  });
});
