import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  syncPermissions,
  SyncPermissionsOptions,
} from "../scripts/sync-permissions";
import {
  PERMISSIONS,
  TENANT_PERMISSIONS,
  TENANT_PERMISSION_KEYS,
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_KEYS,
  AI_PERMISSION_KEYS,
  PERMISSION_MAP,
} from "@/lib/catalog";
import {
  validateRolePermissions,
  ensurePermissionsInDb,
} from "@/lib/rbac";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_rbac_disposable";
const DISPOSABLE_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${DISPOSABLE_DB_NAME}?schema=public`;

const { dbProxy, setDb } = vi.hoisted(() => {
  let innerDb: any = null;
  const proxy = new Proxy({} as any, {
    get(_target, prop) {
      if (!innerDb) throw new Error("db accessed before initialization in beforeAll");
      const val = innerDb[prop];
      if (typeof val === "function") return val.bind(innerDb);
      return val;
    },
  });
  return {
    dbProxy: proxy,
    setDb: (d: any) => {
      innerDb = d;
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: dbProxy,
}));

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

describe("RBAC Deployment Verification on Isolated Disposable PostgreSQL DB", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;
  let testTenantA: any;
  let testTenantB: any;
  let ownerUser: any;
  let nonOwnerUser: any;
  let platformOwnerUser: any;
  let instituteAdminRoleA: any;
  let customRoleA: any;
  let customRoleB: any;
  let platformSupportRole: any;
  let platformOwnerRole: any;

  beforeAll(async () => {
    // 1. Setup isolated database
    adminClient = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${DISPOSABLE_DB_NAME} OWNER knowletive;`);

    // 2. Push schema
    execSync("npx prisma db push --skip-generate --schema=prisma/schema.prisma", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    setDb(db);
    (globalThis as any).prisma = db;
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Initial sync
    await syncPermissions(db, { silent: true });

    // 5. Seed test data
    testTenantA = await db.tenant.create({
      data: { name: "Test School A", slug: "school-a", email: "school-a@test.local", logoInitials: "SA", type: "SCHOOL", status: "ACTIVE" },
    });
    testTenantB = await db.tenant.create({
      data: { name: "Test School B", slug: "school-b", email: "school-b@test.local", logoInitials: "SB", type: "SCHOOL", status: "ACTIVE" },
    });

    ownerUser = await db.user.create({
      data: { email: "owner@a.local", name: "Owner A", passwordHash: "dummyhash", status: "ACTIVE" },
    });
    nonOwnerUser = await db.user.create({
      data: { email: "admin@a.local", name: "Admin A", passwordHash: "dummyhash", status: "ACTIVE" },
    });
    platformOwnerUser = await db.user.create({
      data: { email: "owner@platform.local", name: "Platform Owner", passwordHash: "dummyhash", status: "ACTIVE" },
    });

    instituteAdminRoleA = await db.role.create({
      data: { tenantId: testTenantA.id, key: "INSTITUTE_ADMIN", name: "Institute Admin", scope: "TENANT", isSystem: true },
    });
    customRoleA = await db.role.create({
      data: { tenantId: testTenantA.id, key: "CUSTOM_ROLE_A", name: "Custom Role A", scope: "TENANT", isSystem: false },
    });
    customRoleB = await db.role.create({
      data: { tenantId: testTenantB.id, key: "CUSTOM_ROLE_B", name: "Custom Role B", scope: "TENANT", isSystem: false },
    });
    platformSupportRole = await db.role.create({
      data: { key: "PLATFORM_SUPPORT", name: "Platform Support", scope: "PLATFORM", isSystem: false },
    });
    platformOwnerRole = await db.role.create({
      data: { key: "PLATFORM_OWNER", name: "Platform Owner", scope: "PLATFORM", isSystem: true },
    });
  });

  afterAll(async () => {
    try {
      if (db) await db.$disconnect();
    } catch {}
    try {
      if (adminClient) {
        await adminClient.$executeRawUnsafe(`
          SELECT pg_terminate_backend(pid) 
          FROM pg_stat_activity 
          WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
        `);
        await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
        await adminClient.$disconnect();
      }
    } catch (e) {
      console.error("Cleanup error in afterAll:", e);
    }
  });

  function getOwnerContext() {
    return {
      user: { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email },
      tenant: { id: testTenantA.id, name: testTenantA.name, slug: testTenantA.slug, type: testTenantA.type, status: "ACTIVE" },
      membership: { id: "mem_owner", roleId: instituteAdminRoleA.id, roleKey: "INSTITUTE_ADMIN" as any, roleName: "Owner", isOwner: true, branchId: null },
      permissions: new Set(["tenant.roles.manage"]),
      branchId: null,
      isOwnerView: false,
      subscriptionBlocked: false,
    } as any;
  }

  function getNonOwnerContext() {
    return {
      user: { id: nonOwnerUser.id, name: nonOwnerUser.name, email: nonOwnerUser.email },
      tenant: { id: testTenantA.id, name: testTenantA.name, slug: testTenantA.slug, type: testTenantA.type, status: "ACTIVE" },
      membership: { id: "mem_admin", roleId: instituteAdminRoleA.id, roleKey: "INSTITUTE_ADMIN" as any, roleName: "Admin", isOwner: false, branchId: null },
      permissions: new Set(["tenant.roles.manage"]),
      branchId: null,
      isOwnerView: false,
      subscriptionBlocked: false,
    } as any;
  }

  describe("1. Deployment Fail-Closed Behavior (sync-permissions.ts)", () => {
    it("1.1. Throws on unknown catalog key prefix", async () => {
      await expect(
        syncPermissions(db, {
          strict: true,
          catalog: [{ key: "unsupported.perm", group: "G", label: "L", scope: "TENANT" }],
        }),
      ).rejects.toThrow(/unknown prefix/);
    });

    it("1.2. Throws on missing metadata (group or label)", async () => {
      await expect(
        syncPermissions(db, {
          strict: true,
          catalog: [{ key: "tenant.test.nometa", group: "", label: "", scope: "TENANT" }],
        }),
      ).rejects.toThrow(/missing group metadata|missing label metadata/);
    });

    it("1.3. Throws on invalid scope", async () => {
      await expect(
        syncPermissions(db, {
          strict: true,
          catalog: [{ key: "tenant.test.badscope", group: "G", label: "L", scope: "GLOBAL" as any }],
        }),
      ).rejects.toThrow(/invalid scope/);
    });

    it("1.4. Throws on duplicate permission keys", async () => {
      await expect(
        syncPermissions(db, {
          strict: true,
          catalog: [
            { key: "tenant.test.dup", group: "G", label: "L1", scope: "TENANT" },
            { key: "tenant.test.dup", group: "G", label: "L2", scope: "TENANT" },
          ],
        }),
      ).rejects.toThrow(/duplicate definition/);
    });

    it("1.5. Throws on scope discrepancy and preserves existing DB scope and description", async () => {
      await db.permission.create({
        data: {
          key: "tenant.test.scope_check",
          group: "TestGroup",
          label: "Scope Check",
          scope: "PLATFORM",
          description: "Preserved description",
        },
      });

      await expect(
        syncPermissions(db, {
          strict: true,
          catalog: [{ key: "tenant.test.scope_check", group: "TestGroup", label: "Scope Check", scope: "TENANT" }],
        }),
      ).rejects.toThrow(/Permission scope discrepancies detected/);

      const dbRecord = await db.permission.findUnique({ where: { key: "tenant.test.scope_check" } });
      expect(dbRecord?.scope).toBe("PLATFORM");
      expect(dbRecord?.description).toBe("Preserved description");

      await db.permission.delete({ where: { key: "tenant.test.scope_check" } });
    });

    it("1.6. Valid synchronization is strictly idempotent", async () => {
      const run1 = await syncPermissions(db, { silent: true });
      const run2 = await syncPermissions(db, { silent: true });
      expect(run1.inserted).toBe(0);
      expect(run1.alreadyExisting).toBe(PERMISSIONS.length);
      expect(run2.inserted).toBe(0);
      expect(run2.alreadyExisting).toBe(PERMISSIONS.length);
    });
  });

  describe("2. Role Actions Verification (Tenant & Platform)", () => {
    it("2.1. createTenantRoleAction rejects unauthorized caller", async () => {
      const { createTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({
        ok: false,
        error: "Permission denied. You are not authorized to create this record.",
      });

      const fd = new FormData();
      fd.set("name", "Unauth Role");
      fd.append("permissions", "tenant.students.read");

      const res = await createTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toContain("Permission denied");
    });

    it("2.2. createTenantRoleAction rejects platform-scoped permission", async () => {
      const { createTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getOwnerContext() });

      const fd = new FormData();
      fd.set("name", "Bad Scope Role");
      fd.append("permissions", "platform.overview.read");

      const res = await createTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toContain("Invalid permission scope");
    });

    it("2.3. createTenantRoleAction rejects AI permission when caller is non-owner", async () => {
      const { createTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getNonOwnerContext() });

      const fd = new FormData();
      fd.set("name", "Non-Owner AI Role");
      fd.append("permissions", "tenant.students.read");
      fd.append("permissions", "tenant.ai.copilot");

      const res = await createTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toContain("Elevated access denied");
    });

    it("2.4. createTenantRoleAction successfully creates role with valid permissions & no FK violation", async () => {
      const { createTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getOwnerContext() });

      const fd = new FormData();
      fd.set("name", "Math Teacher");
      fd.append("permissions", "tenant.students.read");
      fd.append("permissions", "tenant.attendance.read");
      fd.append("permissions", "tenant.ai.copilot");

      const res = await createTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toBeUndefined();
      expect(res.success).toBeDefined();

      const created = await db.role.findFirst({
        where: { tenantId: testTenantA.id, name: "Math Teacher" },
        include: { permissions: true },
      });
      expect(created).not.toBeNull();
      expect(created?.permissions.length).toBe(3);
    });

    it("2.5. saveTenantRoleAction rejects cross-tenant IDOR", async () => {
      const { saveTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getOwnerContext() });

      const fd = new FormData();
      fd.set("roleId", customRoleB.id); // Tenant B's role, caller is Tenant A!
      fd.set("name", "Hacked Role");
      fd.append("permissions", "tenant.students.read");

      const res = await saveTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toBe("Role not found.");
    });

    it("2.6. saveTenantRoleAction protects INSTITUTE_ADMIN from modification", async () => {
      const { saveTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getOwnerContext() });

      const fd = new FormData();
      fd.set("roleId", instituteAdminRoleA.id);
      fd.set("name", "Mutated Institute Admin");
      fd.append("permissions", "tenant.students.read");

      const res = await saveTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toBe("The Institute Admin role always has full access and cannot be edited.");
    });

    it("2.7. saveTenantRoleAction self-heals canonical permission missing from DB and assigns without FK error", async () => {
      const targetKey = "tenant.exams.publish_results";
      await db.rolePermission.deleteMany({ where: { permissionKey: targetKey } });
      await db.permission.delete({ where: { key: targetKey } });

      const { saveTenantRoleAction } = await import("@/actions/admin");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "authorizeTenantWrite");
      authSpy.mockResolvedValueOnce({ ok: true, ctx: getOwnerContext() });

      const fd = new FormData();
      fd.set("roleId", customRoleA.id);
      fd.set("name", "Examination Controller");
      fd.append("permissions", "tenant.students.read");
      fd.append("permissions", targetKey);

      const res = await saveTenantRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toBeUndefined();
      expect(res.success).toBeDefined();

      const healedPerm = await db.permission.findUnique({ where: { key: targetKey } });
      expect(healedPerm).not.toBeNull();
      expect(healedPerm?.scope).toBe("TENANT");

      const assignedRolePerm = await db.rolePermission.findUnique({
        where: { roleId_permissionKey: { roleId: customRoleA.id, permissionKey: targetKey } },
      });
      expect(assignedRolePerm).not.toBeNull();
    });

    it("2.8. savePlatformRoleAction protects PLATFORM_OWNER from modification", async () => {
      const { savePlatformRoleAction } = await import("@/actions/platform");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "requirePlatformPermission");
      authSpy.mockResolvedValueOnce({ id: platformOwnerUser.id, name: platformOwnerUser.name } as any);

      const fd = new FormData();
      fd.set("roleId", platformOwnerRole.id);
      fd.set("name", "Mutated Platform Owner");
      fd.append("permissions", "platform.overview.read");

      const res = await savePlatformRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toBe("The owner role always has every permission and cannot be edited.");
    });

    it("2.9. savePlatformRoleAction rejects tenant permissions for platform role", async () => {
      const { savePlatformRoleAction } = await import("@/actions/platform");
      const authSpy = vi.spyOn(await import("@/lib/rbac"), "requirePlatformPermission");
      authSpy.mockResolvedValueOnce({ id: platformOwnerUser.id, name: platformOwnerUser.name } as any);

      const fd = new FormData();
      fd.set("roleId", platformSupportRole.id);
      fd.set("name", "Support Scope Violation");
      fd.append("permissions", "tenant.students.read");

      const res = await savePlatformRoleAction({} as any, fd);
      authSpy.mockRestore();
      expect(res.error).toContain("Invalid permission scope");
    });
  });

  describe("3. Database Privileges & Runtime Boundary Verification", () => {
    it("3.1. Database role 'knowletive' possesses required table privileges", async () => {
      const privCheck = await db.$queryRawUnsafe<any[]>(`
        SELECT
          has_table_privilege('knowletive', '"Permission"', 'SELECT') as can_select,
          has_table_privilege('knowletive', '"Permission"', 'INSERT') as can_insert,
          has_table_privilege('knowletive', '"Permission"', 'UPDATE') as can_update,
          has_table_privilege('knowletive', '"Permission"', 'DELETE') as can_delete;
      `);
      expect(privCheck.length).toBe(1);
      expect(privCheck[0].can_select).toBe(true);
      expect(privCheck[0].can_insert).toBe(true);
      expect(privCheck[0].can_update).toBe(true);
      expect(privCheck[0].can_delete).toBe(true);
    });

    it("3.2. ensurePermissionsInDb strictly rejects uncataloged keys without inserting", async () => {
      const badKey = "tenant.malicious.uncataloged_exploit";
      await expect(
        ensurePermissionsInDb([badKey], "TENANT"),
      ).rejects.toThrow(/Unknown permission key/);

      const check = await db.permission.findUnique({ where: { key: badKey } });
      expect(check).toBeNull();
    });

    it("3.3. RolePermission assignments are preserved across syncPermissions", async () => {
      // Ensure at least one RolePermission exists
      await db.rolePermission.createMany({
        data: [
          { roleId: customRoleA.id, permissionKey: "tenant.students.read" },
          { roleId: customRoleA.id, permissionKey: "tenant.attendance.read" },
        ],
        skipDuplicates: true,
      });

      const countBefore = await db.rolePermission.count();
      expect(countBefore).toBeGreaterThan(0);

      await syncPermissions(db, { silent: true });

      const countAfter = await db.rolePermission.count();
      expect(countAfter).toBe(countBefore);
    });
  });
});
