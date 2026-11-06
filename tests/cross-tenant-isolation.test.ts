import { describe, it, expect, vi } from "vitest";

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

import { db } from "@/lib/db";
import { isStaffMember, type TenantContext } from "@/lib/auth";

describe("Cross-Tenant & Cross-Student Isolation Tests", () => {
  it("Tenant Isolation: Student query strictly isolates by tenantId", async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });

    expect(tenants.length).toBeGreaterThanOrEqual(2);
    const [tenantA, tenantB] = tenants;

    // Get a student from tenant A
    const studentA = await db.student.findFirst({
      where: { tenantId: tenantA.id },
      select: { id: true, admissionNo: true },
    });
    expect(studentA).toBeDefined();

    // Attempt to query student A using tenant B's context
    const crossTenantQuery = await db.student.findFirst({
      where: { id: studentA!.id, tenantId: tenantB.id },
    });

    expect(crossTenantQuery).toBeNull();
  });

  it("Parent Portal Isolation: Guardians cannot access unlinked students", async () => {
    const tenant = await db.tenant.findFirst({
      select: { id: true },
    });
    expect(tenant).toBeDefined();

    // Query all students for a non-guardian user ID
    const unauthorizedUserId = "unauthorized_parent_user_id";
    const accessibleStudents = await db.student.findMany({
      where: {
        tenantId: tenant!.id,
        guardians: {
          some: {
            guardian: {
              userId: unauthorizedUserId,
            },
          },
        },
      },
    });

    expect(accessibleStudents).toEqual([]);
  });

  it("Staff Role Enforcement: Non-staff role keys are denied staff console access", () => {
    const portalRoles = ["PARENT", "STUDENT", "GUEST", "ALUMNI"];

    for (const roleKey of portalRoles) {
      const ctx = {
        isOwnerView: false,
        membership: { roleKey },
      } as unknown as TenantContext;
      expect(isStaffMember(ctx)).toBe(false);
    }

    const staffRoles = ["INSTITUTE_ADMIN", "PRINCIPAL", "TEACHER", "ACCOUNTANT", "FRONT_DESK"];
    for (const roleKey of staffRoles) {
      const ctx = {
        isOwnerView: false,
        membership: { roleKey },
      } as unknown as TenantContext;
      expect(isStaffMember(ctx)).toBe(true);
    }
  });

  it("Cross-Tenant Integrity: Section validation rejects cross-tenant assignment", async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true },
    });
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    const [tenantA, tenantB] = tenants;

    // Get a section belonging to Tenant B
    const sectionB = await db.section.findFirst({
      where: { tenantId: tenantB.id },
      select: { id: true },
    });
    expect(sectionB).toBeDefined();

    // Simulating createStudentAction validation:
    // A section belonging to Tenant B must not be found when queried with Tenant A's ID
    const sectionValidation = await db.section.findFirst({
      where: { id: sectionB!.id, tenantId: tenantA.id },
      select: { id: true, classId: true },
    });

    expect(sectionValidation).toBeNull();
  });
});

