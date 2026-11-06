import { describe, it, expect, vi } from "vitest";

// Mock next/navigation and next/headers
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
import { rateLimit } from "@/lib/rate-limit";
import { hashPassword, verifyPassword, isStaffMember, type TenantContext } from "@/lib/auth";
import {
  TENANT_ROLE_TEMPLATES,
  STAFF_ROLE_KEYS,
} from "@/lib/catalog";

describe("Phase 0 Security & Tenant Isolation Tests", () => {
  it("TASK 1: Role Permissions & Staff Separation", () => {
    // 1. Verify PARENT role does NOT have tenant.students.read, tenant.attendance.read, or tenant.fees.read
    const parentTemplate = TENANT_ROLE_TEMPLATES.find((r) => r.key === "PARENT");
    expect(parentTemplate).toBeDefined();

    expect(parentTemplate?.permissions).not.toContain("tenant.students.read");
    expect(parentTemplate?.permissions).not.toContain("tenant.attendance.read");
    expect(parentTemplate?.permissions).not.toContain("tenant.fees.read");
    expect(parentTemplate?.permissions).toContain("tenant.portal.read");

    // 2. Verify STUDENT role does NOT have academics.read or fees.read
    const studentTemplate = TENANT_ROLE_TEMPLATES.find((r) => r.key === "STUDENT");
    expect(studentTemplate).toBeDefined();
    expect(studentTemplate?.permissions).not.toContain("tenant.academics.read");
    expect(studentTemplate?.permissions).toContain("tenant.portal.read");

    // 3. Verify STAFF_ROLE_KEYS
    expect(STAFF_ROLE_KEYS.has("INSTITUTE_ADMIN")).toBe(true);
    expect(STAFF_ROLE_KEYS.has("PRINCIPAL")).toBe(true);
    expect(STAFF_ROLE_KEYS.has("TEACHER")).toBe(true);
    expect(STAFF_ROLE_KEYS.has("ACCOUNTANT")).toBe(true);
    expect(STAFF_ROLE_KEYS.has("FRONT_DESK")).toBe(true);
    expect(STAFF_ROLE_KEYS.has("PARENT")).toBe(false);
    expect(STAFF_ROLE_KEYS.has("STUDENT")).toBe(false);
  });

  it("TASK 1: isStaffMember helper function validation", () => {
    // Test staff context
    const staffCtx = {
      isOwnerView: false,
      membership: { roleKey: "TEACHER" },
    } as unknown as TenantContext;
    expect(isStaffMember(staffCtx)).toBe(true);

    // Test parent context
    const parentCtx = {
      isOwnerView: false,
      membership: { roleKey: "PARENT" },
    } as unknown as TenantContext;
    expect(isStaffMember(parentCtx)).toBe(false);

    // Test student context
    const studentCtx = {
      isOwnerView: false,
      membership: { roleKey: "STUDENT" },
    } as unknown as TenantContext;
    expect(isStaffMember(studentCtx)).toBe(false);

    // Test platform owner view
    const ownerCtx = {
      isOwnerView: true,
      membership: null,
    } as unknown as TenantContext;
    expect(isStaffMember(ownerCtx)).toBe(true);
  });

  it("TASK 3: Database-Backed Persistent Rate Limiting", async () => {
    const testKey = `test_ratelimit_${Date.now()}`;
    const limit = 3;
    const windowMs = 5000;

    // Call 1
    const res1 = await rateLimit(testKey, limit, windowMs);
    expect(res1.ok).toBe(true);
    expect(res1.remaining).toBe(2);

    // Call 2
    const res2 = await rateLimit(testKey, limit, windowMs);
    expect(res2.ok).toBe(true);
    expect(res2.remaining).toBe(1);

    // Call 3
    const res3 = await rateLimit(testKey, limit, windowMs);
    expect(res3.ok).toBe(true);
    expect(res3.remaining).toBe(0);

    // Call 4 (Threshold breached)
    const res4 = await rateLimit(testKey, limit, windowMs);
    expect(res4.ok).toBe(false);
    expect(res4.remaining).toBe(0);
    expect(res4.retryAfterMs).toBeGreaterThan(0);

    // Verify rate limit persistence in PostgreSQL table RateLimitBucket
    const bucket = await db.rateLimitBucket.findUnique({ where: { key: testKey } });
    expect(bucket).toBeDefined();
    expect(bucket?.count).toBe(4);

    // Clean up test bucket
    await db.rateLimitBucket.delete({ where: { key: testKey } });
  });

  it("TASK 4 & 5: Authentication Security, Hashing & Lockout Fields", async () => {
    const password = "TestPassword@123";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword("WrongPassword", hash);
    expect(invalid).toBe(false);

    // Verify User model has failedLoginAttempts and lockedUntil
    const testUser = await db.user.findFirst({
      select: { id: true, failedLoginAttempts: true, lockedUntil: true },
    });
    expect(testUser).toBeDefined();
    expect(typeof testUser?.failedLoginAttempts).toBe("number");
  });

  it("TASK 1 & 4: Guardian-to-Student Relationship Scoping", async () => {
    // Query students linked to a non-existent guardian user ID
    const fakeUserId = "non_existent_guardian_id";
    const tenant = await db.tenant.findFirst({ select: { id: true } });
    expect(tenant).toBeDefined();

    const students = await db.student.findMany({
      where: {
        tenantId: tenant!.id,
        guardians: {
          some: {
            guardian: {
              userId: fakeUserId,
            },
          },
        },
      },
    });

    expect(students.length).toBe(0);
  });
});
