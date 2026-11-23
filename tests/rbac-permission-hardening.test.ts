import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  ensurePermissionsInDb,
  validateRolePermissions,
} from "@/lib/rbac";
import {
  saveTenantRoleAction,
  createTenantRoleAction,
} from "@/actions/admin";
import {
  savePlatformRoleAction,
} from "@/actions/platform";
import { syncPermissions } from "../scripts/sync-permissions";
import {
  PERMISSIONS,
  TENANT_PERMISSIONS,
  TENANT_PERMISSION_KEYS,
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_KEYS,
  AI_PERMISSION_KEYS,
} from "@/lib/catalog";
import type { TenantContext } from "@/lib/auth";

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

describe("RBAC Permission Catalog Synchronization & Security Hardening", () => {
  let tenantA: { id: string; name: string; slug: string; type: string };
  let tenantB: { id: string; name: string; slug: string; type: string };
  let testRoleInA: { id: string; key: string };
  let platformSupportRole: { id: string; key: string };
  let platformOwnerRole: { id: string; key: string };
  let createdRoleIds: string[] = [];

  beforeAll(async () => {
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true, slug: true, type: true },
    });
    if (tenants.length < 2) {
      throw new Error("At least two tenants required in test database.");
    }
    tenantA = tenants[0];
    tenantB = tenants[1];

    // Ensure permissions are synchronized in the test database initially
    await syncPermissions(db, { silent: true });

    // Create a disposable custom test role in Tenant A
    const customRole = await db.role.create({
      data: {
        scope: "TENANT",
        tenantId: tenantA.id,
        key: `HARDENING_TEST_ROLE_${Date.now()}`,
        name: "Hardening Test Role",
        description: "Role for security hardening test suite",
        isSystem: false,
      },
    });
    testRoleInA = { id: customRole.id, key: customRole.key };
    createdRoleIds.push(customRole.id);

    // Find platform roles
    const supportRole = await db.role.findFirst({
      where: { scope: "PLATFORM", key: "PLATFORM_SUPPORT" },
    });
    if (!supportRole) throw new Error("PLATFORM_SUPPORT role not found.");
    platformSupportRole = { id: supportRole.id, key: supportRole.key };

    const ownerRole = await db.role.findFirst({
      where: { scope: "PLATFORM", key: "PLATFORM_OWNER" },
    });
    if (!ownerRole) throw new Error("PLATFORM_OWNER role not found.");
    platformOwnerRole = { id: ownerRole.id, key: ownerRole.key };
  });

  afterAll(async () => {
    if (createdRoleIds.length > 0) {
      await db.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await db.role.deleteMany({
        where: { id: { in: createdRoleIds } },
      });
    }
    // Clean up any test permissions if created
    await db.permission.deleteMany({
      where: { key: { in: ["tenant.test.newly_registered_simulated"] } },
    });
    // Final sync to restore standard state
    await syncPermissions(db, { silent: true });
  });

  // Helper to mock an Institute Owner context
  function mockOwnerContext(tenantId = tenantA.id) {
    return {
      user: { id: "user_owner_test", name: "Institute Owner", email: "owner@test.local" },
      tenant: { id: tenantId, name: "Test Institute", slug: "test", type: "SCHOOL", status: "ACTIVE" },
      membership: { id: "mem_owner", roleId: "r_owner", roleKey: "INSTITUTE_ADMIN" as any, roleName: "Owner", isOwner: true },
      permissions: new Set(["tenant.roles.manage"]),
    } as any;
  }

  // Helper to mock a non-owner Admin context (has roles.manage, but isOwner: false)
  function mockNonOwnerAdminContext(tenantId = tenantA.id) {
    return {
      user: { id: "user_admin_test", name: "Non-Owner Admin", email: "admin@test.local" },
      tenant: { id: tenantId, name: "Test Institute", slug: "test", type: "SCHOOL", status: "ACTIVE" },
      membership: { id: "mem_admin", roleId: "r_admin", roleKey: "INSTITUTE_ADMIN" as any, roleName: "Admin", isOwner: false },
      permissions: new Set(["tenant.roles.manage"]),
    } as any;
  }

  // =========================================================================
  // 1. Saving a role with all existing valid tenant permissions
  // =========================================================================
  it("1. Successfully saves a role with all existing valid tenant permissions", async () => {
    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Full Tenant Permissions Role");
    for (const key of TENANT_PERMISSION_KEYS) {
      formData.append("permissions", key);
    }

    const res = await saveTenantRoleAction({} as any, formData);
    authSpy.mockRestore();

    expect(res.error).toBeUndefined();
    expect(res.success).toBeDefined();

    const savedPerms = await db.rolePermission.findMany({
      where: { roleId: testRoleInA.id },
      select: { permissionKey: true },
    });
    expect(savedPerms.length).toBe(TENANT_PERMISSION_KEYS.length);
  });

  // =========================================================================
  // 2. Saving a role with one newly registered canonical tenant permission
  // =========================================================================
  it("2. Successfully self-heals and assigns a newly registered canonical tenant permission missing from DB", async () => {
    // Pick an existing canonical permission to simulate being temporarily missing from Permission table
    const targetKey = "tenant.ai.workflows";
    expect(PERMISSIONS.some((p) => p.key === targetKey)).toBe(true);

    // Delete it from RolePermission first, then from Permission table
    await db.rolePermission.deleteMany({ where: { permissionKey: targetKey } });
    await db.permission.delete({ where: { key: targetKey } });

    // Verify it is missing from DB
    const missingCheck = await db.permission.findUnique({ where: { key: targetKey } });
    expect(missingCheck).toBeNull();

    // Now save role with this permission - ensurePermissionsInDb should self-heal from canonical PERMISSIONS
    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Self Healing Test Role");
    formData.append("permissions", "tenant.students.read");
    formData.append("permissions", targetKey);

    const res = await saveTenantRoleAction({} as any, formData);
    authSpy.mockRestore();

    expect(res.error).toBeUndefined();
    expect(res.success).toBeDefined();

    // Verify that the permission was re-inserted into the DB from catalog
    const restoredPerm = await db.permission.findUnique({ where: { key: targetKey } });
    expect(restoredPerm).not.toBeNull();
    expect(restoredPerm?.key).toBe(targetKey);
    expect(restoredPerm?.scope).toBe("TENANT");

    // Verify it was assigned to the role without FK error
    const rolePerm = await db.rolePermission.findUnique({
      where: { roleId_permissionKey: { roleId: testRoleInA.id, permissionKey: targetKey } },
    });
    expect(rolePerm).not.toBeNull();
  });

  // =========================================================================
  // 3. Submitting an unknown permission key
  // =========================================================================
  it("3. Strictly rejects arbitrary unknown permission keys and never inserts them into DB", async () => {
    const unknownKey = "tenant.custom.malicious_backdoor";

    // A. Verify validateRolePermissions rejects it
    const validation = validateRolePermissions([unknownKey, "tenant.students.read"], "TENANT", true);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error).toContain("Unknown permission");
      expect(validation.error).toContain(unknownKey);
    }

    // B. Verify saveTenantRoleAction rejects it
    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Attacker Role");
    formData.append("permissions", unknownKey);

    const res = await saveTenantRoleAction({} as any, formData);
    authSpy.mockRestore();

    expect(res.error).toBeDefined();
    expect(res.error).toContain("Unknown permission");

    // C. Verify ensurePermissionsInDb fails closed on unknown key
    await expect(
      ensurePermissionsInDb([unknownKey], "TENANT"),
    ).rejects.toThrow(/Unknown permission key/);

    // D. Verify the unknown key was NEVER created in Permission table
    const permInDb = await db.permission.findUnique({ where: { key: unknownKey } });
    expect(permInDb).toBeNull();
  });

  // =========================================================================
  // 4. Submitting a platform permission to a tenant role
  // =========================================================================
  it("4. Server-side rejects platform-scoped permissions submitted to a tenant role", async () => {
    const platformKey = "platform.overview.read";

    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Privilege Escalation Role");
    formData.append("permissions", "tenant.students.read");
    formData.append("permissions", platformKey);

    const res = await saveTenantRoleAction({} as any, formData);
    authSpy.mockRestore();

    expect(res.error).toBeDefined();
    expect(res.error).toContain("Invalid permission scope");
    expect(res.error).toContain("platform permission and cannot be assigned to a tenant role");

    // Verify it was NOT assigned to the role
    const assigned = await db.rolePermission.findUnique({
      where: { roleId_permissionKey: { roleId: testRoleInA.id, permissionKey: platformKey } },
    });
    expect(assigned).toBeNull();
  });

  // =========================================================================
  // 5. Submitting a tenant permission to a platform role
  // =========================================================================
  it("5. Server-side rejects tenant-scoped permissions submitted to a platform role", async () => {
    const tenantKey = "tenant.students.read";

    const platformAuthSpy = vi.spyOn(await import("@/lib/rbac"), "requirePlatformPermission");
    platformAuthSpy.mockResolvedValueOnce({
      id: "usr_platform_admin",
      name: "Platform Admin",
      email: "admin@platform.test",
    } as any);

    const formData = new FormData();
    formData.set("roleId", platformSupportRole.id);
    formData.append("permissions", "platform.overview.read");
    formData.append("permissions", tenantKey);

    const res = await savePlatformRoleAction({} as any, formData);
    platformAuthSpy.mockRestore();

    expect(res.error).toBeDefined();
    expect(res.error).toContain("Invalid permission scope");
    expect(res.error).toContain("tenant permission and cannot be assigned to a platform role");

    // Verify it was NOT assigned
    const assigned = await db.rolePermission.findUnique({
      where: { roleId_permissionKey: { roleId: platformSupportRole.id, permissionKey: tenantKey } },
    });
    expect(assigned).toBeNull();
  });

  // =========================================================================
  // 6. Attempting to grant an unauthorized elevated permission
  // =========================================================================
  it("6. Rejects non-owner administrators attempting to grant elevated AI permissions to roles", async () => {
    const aiPerm = "tenant.ai.copilot";

    // Non-owner admin (isOwner: false)
    const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpy.mockResolvedValueOnce({
      ok: true,
      ctx: mockNonOwnerAdminContext(),
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Elevated Access Attempt");
    formData.append("permissions", "tenant.students.read");
    formData.append("permissions", aiPerm);

    const res = await saveTenantRoleAction({} as any, formData);
    authSpy.mockRestore();

    expect(res.error).toBeDefined();
    expect(res.error).toContain("Elevated access denied. Only verified Institute Owners can grant AI capabilities");

    // Verify Institute Owner CAN assign it
    const authSpyOwner = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpyOwner.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const resOwner = await saveTenantRoleAction({} as any, formData);
    authSpyOwner.mockRestore();

    expect(resOwner.error).toBeUndefined();
    expect(resOwner.success).toBeDefined();
  });

  // =========================================================================
  // 7. Repeated permission synchronization (Idempotence)
  // =========================================================================
  it("7. Running synchronization repeatedly is strictly idempotent without row duplication", async () => {
    // First run
    const report1 = await syncPermissions(db, { silent: true });
    expect(report1.totalCatalog).toBe(PERMISSIONS.length);

    // Second run
    const report2 = await syncPermissions(db, { silent: true });
    expect(report2.inserted).toBe(0);
    expect(report2.metadataUpdated).toBe(0);
    expect(report2.alreadyExisting).toBe(PERMISSIONS.length);

    // Total count in DB matches catalog count
    const totalCount = await db.permission.count();
    expect(totalCount).toBe(PERMISSIONS.length);
  });

  // =========================================================================
  // 8. Concurrent permission synchronization
  // =========================================================================
  it("8. Concurrent permission synchronization resolves without deadlock or duplicate key errors", async () => {
    const [res1, res2, res3] = await Promise.all([
      syncPermissions(db, { silent: true }),
      syncPermissions(db, { silent: true }),
      ensurePermissionsInDb(TENANT_PERMISSION_KEYS, "TENANT"),
    ]);

    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    expect(res3).toBeDefined();

    const count = await db.permission.count();
    expect(count).toBe(PERMISSIONS.length);
  });

  // =========================================================================
  // 9. Missing database catalog entry detection
  // =========================================================================
  it("9. Detects missing database catalog entries and inserts them accurately", async () => {
    const keyToDrop = "tenant.ai.analytics.exams";

    // Clean up role permissions for this key first, then delete
    await db.rolePermission.deleteMany({ where: { permissionKey: keyToDrop } });
    await db.permission.delete({ where: { key: keyToDrop } });

    // Ensure it's missing
    const missing = await db.permission.findUnique({ where: { key: keyToDrop } });
    expect(missing).toBeNull();

    // Run sync
    const report = await syncPermissions(db, { silent: true });
    expect(report.inserted).toBe(1);

    // Verify it is restored with correct metadata
    const restored = await db.permission.findUnique({ where: { key: keyToDrop } });
    expect(restored).not.toBeNull();
    expect(restored?.group).toBe("AI Studio");
    expect(restored?.scope).toBe("TENANT");
  });

  // =========================================================================
  // 10. Preservation of existing RolePermission assignments
  // =========================================================================
  it("10. Synchronization preserves all existing RolePermission assignments without modification", async () => {
    // Ensure testRoleInA has assigned permissions
    await db.rolePermission.createMany({
      data: [
        { roleId: testRoleInA.id, permissionKey: "tenant.students.read" },
        { roleId: testRoleInA.id, permissionKey: "tenant.attendance.read" },
      ],
      skipDuplicates: true,
    });

    // Record baseline RolePermission count and assignments
    const baselineAssignments = await db.rolePermission.findMany({
      where: { roleId: testRoleInA.id },
      orderBy: { permissionKey: "asc" },
    });
    expect(baselineAssignments.length).toBeGreaterThan(0);

    // Run sync
    await syncPermissions(db, { silent: true });

    // Verify assignments are 100% identical
    const afterSyncAssignments = await db.rolePermission.findMany({
      where: { roleId: testRoleInA.id },
      orderBy: { permissionKey: "asc" },
    });

    expect(afterSyncAssignments).toEqual(baselineAssignments);
  });

  // =========================================================================
  // 11. Foreign-key integrity after synchronization
  // =========================================================================
  it("11. Verifies 100% foreign-key integrity between RolePermission and Permission table", async () => {
    await syncPermissions(db, { silent: true });

    // Raw SQL to check for any orphaned RolePermissions
    const orphaned: any[] = await db.$queryRawUnsafe(`
      SELECT rp."roleId", rp."permissionKey"
      FROM "RolePermission" rp
      LEFT JOIN "Permission" p ON rp."permissionKey" = p.key
      WHERE p.key IS NULL;
    `);

    expect(orphaned.length).toBe(0);
  });

  // =========================================================================
  // 12. Unauthorized role modification rejection
  // =========================================================================
  it("12. Rejects unauthorized role modifications and cross-tenant IDOR attempts", async () => {
    // A. Missing tenant.roles.manage permission
    const authSpyA = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpyA.mockResolvedValueOnce({
      ok: false,
      error: "Permission denied. You do not have permission to modify this information.",
    });

    const formData = new FormData();
    formData.set("roleId", testRoleInA.id);
    formData.set("name", "Unauthorized Edit");
    formData.append("permissions", "tenant.students.read");

    const resNoPerm = await saveTenantRoleAction({} as any, formData);
    authSpyA.mockRestore();
    expect(resNoPerm.error).toBe("Permission denied. You do not have permission to modify this information.");

    // B. Attempting to modify locked INSTITUTE_ADMIN role
    const adminRole = await db.role.findFirst({
      where: { tenantId: tenantA.id, key: "INSTITUTE_ADMIN" },
    });
    expect(adminRole).not.toBeNull();

    const authSpyB = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpyB.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(),
    });

    const formAdmin = new FormData();
    formAdmin.set("roleId", adminRole!.id);
    formAdmin.set("name", "Hacked Admin");
    formAdmin.append("permissions", "tenant.students.read");

    const resAdmin = await saveTenantRoleAction({} as any, formAdmin);
    authSpyB.mockRestore();
    expect(resAdmin.error).toBe("The Institute Admin role always has full access and cannot be edited.");

    // C. Attempting cross-tenant IDOR: Tenant A admin trying to modify Tenant B role
    const roleInB = await db.role.findFirst({
      where: { tenantId: tenantB.id, scope: "TENANT" },
    });
    expect(roleInB).not.toBeNull();

    const authSpyC = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
    authSpyC.mockResolvedValueOnce({
      ok: true,
      ctx: mockOwnerContext(tenantA.id), // Authenticated for Tenant A
    });

    const formB = new FormData();
    formB.set("roleId", roleInB!.id); // Targeting Tenant B role
    formB.set("name", "IDOR Attack Role");
    formB.append("permissions", "tenant.students.read");

    const resIdor = await saveTenantRoleAction({} as any, formB);
    authSpyC.mockRestore();
    expect(resIdor.error).toBe("Role not found.");

    // D. Attempting to modify locked PLATFORM_OWNER role
    const platformAuthSpy = vi.spyOn(await import("@/lib/rbac"), "requirePlatformPermission");
    platformAuthSpy.mockResolvedValueOnce({
      id: "usr_platform_admin",
      name: "Platform Admin",
      email: "admin@platform.test",
    } as any);

    const formOwner = new FormData();
    formOwner.set("roleId", platformOwnerRole.id);
    formOwner.append("permissions", "platform.overview.read");

    const resPlatformOwner = await savePlatformRoleAction({} as any, formOwner);
    platformAuthSpy.mockRestore();
    expect(resPlatformOwner.error).toBe("The owner role always has every permission and cannot be edited.");
  });
});
