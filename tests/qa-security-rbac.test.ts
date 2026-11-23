import { describe, it, expect, vi, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import type { TenantContext } from "@/lib/auth";
import { escapeCsvCell } from "@/lib/csv";
import {
  deleteExaminationAction,
  updateExaminationAction,
} from "@/actions/exams";
import {
  recordFeePaymentAction,
} from "@/actions/operations";
import {
  saveTenantRoleAction,
} from "@/actions/admin";

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

describe("Knowletive QA Security Audit: RBAC, IDOR & Tamper Resistance", () => {
  let tenantA: { id: string; name: string };
  let tenantB: { id: string; name: string };
  let examInTenantB: { id: string };

  beforeAll(async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true },
    });
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Find or create an exam in Tenant B
    let bExam = await db.examination.findFirst({
      where: { tenantId: tenantB.id },
      select: { id: true },
    });
    if (!bExam) {
      const ayB = await db.academicYear.findFirst({ where: { tenantId: tenantB.id } });
      const gsB = await db.gradeScale.findFirst({ where: { tenantId: tenantB.id } });
      const clB = await db.classLevel.findFirst({ where: { tenantId: tenantB.id } });
      const memB = await db.membership.findFirst({ where: { tenantId: tenantB.id } });

      if (ayB && gsB && clB && memB) {
        bExam = await db.examination.create({
          data: {
            tenantId: tenantB.id,
            academicYearId: ayB.id,
            gradeScaleId: gsB.id,
            classId: clB.id,
            targetType: "CLASS_SECTION",
            title: "Tenant B Target Exam",
            code: `SEC-B-${Date.now().toString().slice(-6)}`,
            examType: "UNIT_TEST",
            startDate: new Date("2026-12-01"),
            endDate: new Date("2026-12-05"),
            createdById: memB.id,
          },
        });
      }
    }
    examInTenantB = bExam!;
  });

  // ─────────────────────────────────────────────────────────────
  // 1. IDOR & CROSS-TENANT MUTATION DEFENSE
  // ─────────────────────────────────────────────────────────────
  it("IDOR DEFENSE: Tenant A administrator cannot delete or mutate Tenant B examination", async () => {
    if (!examInTenantB) return;

    // Simulate an authorized administrator for Tenant A attempting to delete Tenant B's exam
    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: {
        user: { id: "user_a", name: "Admin A", email: "admin@tenantA.test" },
        tenant: { id: tenantA.id, name: tenantA.name, slug: "tenant-a", type: "SCHOOL", status: "ACTIVE" },
        membership: { id: "mem_a", roleId: "r_a", roleKey: "INSTITUTE_ADMIN" as any, roleName: "Admin", isOwner: true },
        permissions: new Set(["tenant.exams.write"]),
      } as any,
    });

    const res = await deleteExaminationAction(examInTenantB.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);

    // Verify record in Tenant B was NOT deleted
    const checkExam = await db.examination.findUnique({ where: { id: examInTenantB.id } });
    expect(checkExam).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────
  // 2. CSV FORMULA INJECTION DEFENSE (CWE-1236)
  // ─────────────────────────────────────────────────────────────
  it("CWE-1236 DEFENSE: Neutralizes formula execution triggers in exported cells", () => {
    const maliciousPayloads = [
      "=cmd|'/C calc'!A0",
      "+cmd|'/C calc'!A0",
      "-2+3+cmd|' /C calc'!A0",
      "@SUM(1+1)",
      "\t=1+1",
      "\r=1+1",
    ];

    for (const payload of maliciousPayloads) {
      const sanitized = escapeCsvCell(payload);
      // Sanitized value must either start with single quote or be wrapped in RFC-4180 quotes containing single quote
      expect(sanitized.startsWith("'") || sanitized.startsWith("\"'")).toBe(true);
    }

    // Harmless text is preserved without quotes unless it contains commas/newlines
    expect(escapeCsvCell("Standard Student Name")).toBe("Standard Student Name");
    expect(escapeCsvCell(42.5)).toBe("42.5");
  });

  // ─────────────────────────────────────────────────────────────
  // 3. DATABASE TRIGGER TAMPERING RESISTANCE
  // ─────────────────────────────────────────────────────────────
  it("DATABASE IMMUTABILITY: PostgreSQL trigger blocks direct UPDATE or DELETE on ExamResultSnapshot", async () => {
    const snap = await db.examResultSnapshot.findFirst({ select: { id: true } });
    if (!snap) return;

    // Attempt direct UPDATE via raw SQL
    await expect(
      db.$executeRawUnsafe(`UPDATE "ExamResultSnapshot" SET "checksum" = 'tampered' WHERE id = '${snap.id}'`)
    ).rejects.toThrow(/P0001/);

    // Attempt direct DELETE via raw SQL
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "ExamResultSnapshot" WHERE id = '${snap.id}'`)
    ).rejects.toThrow(/P0001/);
  });

  it("DATABASE IMMUTABILITY: PostgreSQL trigger blocks direct UPDATE or DELETE on BatchEnrollmentEvent", async () => {
    const event = await db.batchEnrollmentEvent.findFirst({ select: { id: true } });
    if (!event) return;

    await expect(
      db.$executeRawUnsafe(`UPDATE "BatchEnrollmentEvent" SET "reason" = 'tampered' WHERE id = '${event.id}'`)
    ).rejects.toThrow(/P0001/);

    await expect(
      db.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE id = '${event.id}'`)
    ).rejects.toThrow(/P0001/);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. CHECK CONSTRAINT XOR TARGETING INTEGRITY
  // ─────────────────────────────────────────────────────────────
  it("CHECK CONSTRAINT: PostgreSQL chk_examination_target_integrity rejects contradictory targetType & IDs", async () => {
    // Attempt raw INSERT with targetType = CLASS_SECTION but setting batchId instead of classId
    await expect(
      db.$executeRawUnsafe(`
        INSERT INTO "Examination" (
          id, "tenantId", "academicYearId", "gradeScaleId", "targetType", "batchId",
          title, code, "examType", status, "startDate", "endDate", "createdById", "createdAt", "updatedAt"
        ) VALUES (
          'chk_qa_fail_01', '${tenantA.id}',
          (SELECT id FROM "AcademicYear" WHERE "tenantId" = '${tenantA.id}' LIMIT 1),
          (SELECT id FROM "GradeScale" WHERE "tenantId" = '${tenantA.id}' LIMIT 1),
          'CLASS_SECTION', 'some_illegal_batch_id',
          'Illegal XOR Target Exam', 'CHK-QA-01', 'UNIT_TEST', 'DRAFT', NOW(), NOW() + INTERVAL '5 days',
          (SELECT id FROM "Membership" WHERE "tenantId" = '${tenantA.id}' LIMIT 1), NOW(), NOW()
        )
      `)
    ).rejects.toThrow(/23514/); // Check constraint violation code
  });

  // ─────────────────────────────────────────────────────────────
  // 5. ROLE PERMISSION MANAGEMENT & FOREIGN KEY INTEGRITY
  // ─────────────────────────────────────────────────────────────
  it("ROLE PERMISSION INTEGRITY: saveTenantRoleAction persists permissions without foreign key constraint violations", async () => {
    // Create a custom test role in Tenant A
    const testRole = await db.role.create({
      data: {
        scope: "TENANT",
        tenantId: tenantA.id,
        key: `CUSTOM_TEST_ROLE_${Date.now()}`,
        name: "Custom Test Role",
        isSystem: false,
      },
    });

    try {
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({
        ok: true,
        ctx: {
          user: { id: "user_a", name: "Admin A", email: "admin@tenantA.test" },
          tenant: { id: tenantA.id, name: tenantA.name, slug: "tenant-a", type: "SCHOOL", status: "ACTIVE" },
          membership: { id: "mem_a", roleId: "r_a", roleKey: "INSTITUTE_ADMIN" as any, roleName: "Admin", isOwner: true },
          permissions: new Set(["tenant.roles.manage"]),
        } as any,
      });

      const formData = new FormData();
      formData.set("roleId", testRole.id);
      formData.set("name", "Custom Test Role Updated");
      formData.set("description", "Updated role description");
      formData.append("permissions", "tenant.attendance.read");
      formData.append("permissions", "tenant.attendance.write");
      formData.append("permissions", "tenant.ai.analytics.attendance");
      formData.append("permissions", "tenant.ai.copilot");

      const res = await saveTenantRoleAction({} as any, formData);
      expect(res.error).toBeUndefined();
      expect(res.success).toBeDefined();

      const savedPerms = await db.rolePermission.findMany({
        where: { roleId: testRole.id },
        select: { permissionKey: true },
      });
      const keys = savedPerms.map((p) => p.permissionKey);
      expect(keys).toContain("tenant.attendance.read");
      expect(keys).toContain("tenant.attendance.write");
      expect(keys).toContain("tenant.ai.analytics.attendance");
      expect(keys).toContain("tenant.ai.copilot");
    } finally {
      await db.rolePermission.deleteMany({ where: { roleId: testRole.id } });
      await db.role.delete({ where: { id: testRole.id } });
    }
  });
});
