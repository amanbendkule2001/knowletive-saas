import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { TENANT_ROLE_TEMPLATES, PLATFORM_ROLE_TEMPLATES } from "@/lib/catalog";
import { authorizeTenantWrite, authorizePlatformWrite } from "@/lib/rbac";
import type { TenantContext } from "@/lib/auth";
import {
  createExaminationAction,
  enterMarksBulkAction,
  calculateAndPublishResultsAction,
} from "@/actions/exams";
import {
  createFeeInvoiceAction,
  recordFeePaymentAction,
  markAttendanceAction,
  createAnnouncementAction,
} from "@/actions/operations";
import {
  createLeadAction,
  convertLeadAction,
} from "@/actions/leads";
import {
  createBatchAction,
} from "@/actions/batches";
import {
  createStudentAction,
  createClassAction,
} from "@/actions/students";

// Mock next navigation & headers
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

describe("Knowletive QA Functional Audit: Role-Based Authorization & Permission Matrix", () => {
  let tenantA: { id: string; name: string; slug: string };
  let tenantB: { id: string; name: string; slug: string };

  const rolesMap = new Map<string, { id: string; key: string; permissions: string[] }>();

  beforeAll(async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true, slug: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Cache role templates and permissions from database
    const dbRoles = await db.role.findMany({
      where: {
        OR: [
          { tenantId: tenantA.id },
          { tenantId: null }, // platform roles
        ],
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    for (const r of dbRoles) {
      if (r.key) {
        rolesMap.set(r.key, {
          id: r.id,
          key: r.key,
          permissions: r.permissions.map((p) => p.permission.key),
        });
      }
    }
  });

  function makeTenantContext(roleKey: string, tenantId = tenantA.id): TenantContext {
    const roleTemplate = TENANT_ROLE_TEMPLATES.find((t) => t.key === roleKey);
    const perms = roleTemplate ? roleTemplate.permissions : (rolesMap.get(roleKey)?.permissions || []);

    return {
      user: {
        id: `qa_user_${roleKey.toLowerCase()}`,
        name: `QA ${roleKey} User`,
        email: `${roleKey.toLowerCase()}@test.knowletive.com`,
      } as any,
      tenant: {
        id: tenantId,
        name: tenantId === tenantA.id ? tenantA.name : tenantB.name,
        slug: tenantId === tenantA.id ? tenantA.slug : tenantB.slug,
        type: "SCHOOL",
        status: "ACTIVE",
        subscription: {
          status: "ACTIVE",
          plan: {
            id: "plan_growth",
            key: "growth",
            name: "Growth",
            studentLimit: 500,
            staffLimit: 50,
            aiCreditsMonthly: 1000,
            features: ["ai", "reports", "portal"],
          } as any,
        } as any,
      } as any,
      membership: {
        id: `qa_mem_${roleKey.toLowerCase()}`,
        roleId: `role_${roleKey.toLowerCase()}`,
        roleKey: roleKey as any,
        roleName: roleTemplate?.name || roleKey,
        isOwner: roleKey === "INSTITUTE_ADMIN",
      } as any,
      permissions: new Set(perms),
    } as unknown as TenantContext;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. INSTITUTE ADMIN ROLE (Superuser within Tenant)
  // ─────────────────────────────────────────────────────────────
  describe("Role 1: INSTITUTE_ADMIN", () => {
    it("has full permissions to execute admissions, exams, fees, and academic mutations", () => {
      const adminCtx = makeTenantContext("INSTITUTE_ADMIN");

      // Test permission evaluation helper
      expect(adminCtx.permissions).toContain("tenant.exams.write");
      expect(adminCtx.permissions).toContain("tenant.exams.publish_results");
      expect(adminCtx.permissions).toContain("tenant.fees.write");
      expect(adminCtx.permissions).toContain("tenant.students.write");
      expect(adminCtx.permissions).toContain("tenant.leads.convert");
      expect(adminCtx.permissions).toContain("tenant.batches.write");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. PRINCIPAL ROLE (Academic Leadership)
  // ─────────────────────────────────────────────────────────────
  describe("Role 2: PRINCIPAL", () => {
    it("is PERMITTED to manage exams, syllabus, batches, and view student records", () => {
      const principalCtx = makeTenantContext("PRINCIPAL");

      expect(principalCtx.permissions).toContain("tenant.exams.write");
      expect(principalCtx.permissions).toContain("tenant.exams.publish_results");
      expect(principalCtx.permissions).toContain("tenant.syllabus.write");
      expect(principalCtx.permissions).toContain("tenant.batches.write");
      expect(principalCtx.permissions).toContain("tenant.students.read");
      expect(principalCtx.permissions).toContain("tenant.fees.read");
    });

    it("is FORBIDDEN from creating fee invoices or recording fee payments", () => {
      const principalCtx = makeTenantContext("PRINCIPAL");

      // Principal has fees.read but NOT fees.write
      expect(principalCtx.permissions).not.toContain("tenant.fees.write");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. TEACHER ROLE (Classroom & Grading)
  // ─────────────────────────────────────────────────────────────
  describe("Role 3: TEACHER", () => {
    it("is PERMITTED to enter marks, update syllabus progress, and take attendance", () => {
      const teacherCtx = makeTenantContext("TEACHER");

      expect(teacherCtx.permissions).toContain("tenant.exams.enter_marks");
      expect(teacherCtx.permissions).toContain("tenant.syllabus.update_progress");
      expect(teacherCtx.permissions).toContain("tenant.attendance.write");
      expect(teacherCtx.permissions).toContain("tenant.announcements.read");
    });

    it("is FORBIDDEN from publishing official exam results or creating examinations", () => {
      const teacherCtx = makeTenantContext("TEACHER");

      expect(teacherCtx.permissions).not.toContain("tenant.exams.publish_results");
      expect(teacherCtx.permissions).not.toContain("tenant.exams.write");
      expect(teacherCtx.permissions).not.toContain("tenant.exams.verify_marks");
      expect(teacherCtx.permissions).not.toContain("tenant.fees.write");
      expect(teacherCtx.permissions).not.toContain("tenant.billing.read");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. ACCOUNTANT ROLE (Finance & Fee Collections)
  // ─────────────────────────────────────────────────────────────
  describe("Role 4: ACCOUNTANT", () => {
    it("is PERMITTED to manage fee invoices, record collections, and view student dues", () => {
      const accountantCtx = makeTenantContext("ACCOUNTANT");

      expect(accountantCtx.permissions).toContain("tenant.fees.read");
      expect(accountantCtx.permissions).toContain("tenant.fees.write");
      expect(accountantCtx.permissions).toContain("tenant.students.read");
    });

    it("is FORBIDDEN from entering exam marks, altering curriculum, or managing batches", () => {
      const accountantCtx = makeTenantContext("ACCOUNTANT");

      expect(accountantCtx.permissions).not.toContain("tenant.exams.enter_marks");
      expect(accountantCtx.permissions).not.toContain("tenant.exams.write");
      expect(accountantCtx.permissions).not.toContain("tenant.syllabus.write");
      expect(accountantCtx.permissions).not.toContain("tenant.batches.write");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. FRONT DESK ROLE (Admissions & Enquiries)
  // ─────────────────────────────────────────────────────────────
  describe("Role 5: FRONT_DESK", () => {
    it("is PERMITTED to capture leads, convert leads, and register students", () => {
      const frontDeskCtx = makeTenantContext("FRONT_DESK");

      expect(frontDeskCtx.permissions).toContain("tenant.leads.read");
      expect(frontDeskCtx.permissions).toContain("tenant.leads.write");
      expect(frontDeskCtx.permissions).toContain("tenant.leads.convert");
      expect(frontDeskCtx.permissions).toContain("tenant.students.write");
      expect(frontDeskCtx.permissions).toContain("tenant.parents.write");
    });

    it("is FORBIDDEN from grading, publishing exam results, or modifying fee structures", () => {
      const frontDeskCtx = makeTenantContext("FRONT_DESK");

      expect(frontDeskCtx.permissions).not.toContain("tenant.exams.enter_marks");
      expect(frontDeskCtx.permissions).not.toContain("tenant.exams.publish_results");
      expect(frontDeskCtx.permissions).not.toContain("tenant.fees.write");
      expect(frontDeskCtx.permissions).not.toContain("tenant.syllabus.write");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. PARENT & STUDENT ROLES (Portal Isolation)
  // ─────────────────────────────────────────────────────────────
  describe("Role 6 & 7: PARENT & STUDENT", () => {
    it("Parent has strictly portal.read and announcements.read", () => {
      const parentCtx = makeTenantContext("PARENT");

      expect(Array.from(parentCtx.permissions)).toEqual(["tenant.portal.read", "tenant.announcements.read"]);
      expect(parentCtx.permissions.has("tenant.students.write")).toBe(false);
      expect(parentCtx.permissions.has("tenant.exams.enter_marks")).toBe(false);
      expect(parentCtx.permissions.has("tenant.fees.write")).toBe(false);
    });

    it("Student has strictly portal.read and announcements.read", () => {
      const studentCtx = makeTenantContext("STUDENT");

      expect(Array.from(studentCtx.permissions)).toEqual(["tenant.portal.read", "tenant.announcements.read"]);
      expect(studentCtx.permissions.has("tenant.exams.enter_marks")).toBe(false);
      expect(studentCtx.permissions.has("tenant.attendance.write")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. PLATFORM ROLES (Global Governance)
  // ─────────────────────────────────────────────────────────────
  describe("Platform Roles: PLATFORM_OWNER & PLATFORM_SUPPORT", () => {
    it("PLATFORM_OWNER possesses all platform.* permissions", () => {
      const ownerTemplate = PLATFORM_ROLE_TEMPLATES.find((t) => t.key === "PLATFORM_OWNER");
      expect(ownerTemplate?.permissions).toContain("platform.institutes.manage");
      expect(ownerTemplate?.permissions).toContain("platform.plans.manage");
      expect(ownerTemplate?.permissions).toContain("platform.subscriptions.manage");
    });

    it("PLATFORM_SUPPORT has read-only platform permissions and lacks write capabilities", () => {
      const supportTemplate = PLATFORM_ROLE_TEMPLATES.find((t) => t.key === "PLATFORM_SUPPORT");
      expect(supportTemplate?.permissions).toContain("platform.institutes.read");
      expect(supportTemplate?.permissions).toContain("platform.subscriptions.read");
      expect(supportTemplate?.permissions).not.toContain("platform.institutes.write");
      expect(supportTemplate?.permissions).not.toContain("platform.plans.write");
    });
  });
});
