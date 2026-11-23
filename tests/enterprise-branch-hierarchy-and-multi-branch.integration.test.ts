import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  resolveUserBranchScope,
  verifyBranchAccess,
  getBranchDescendantIds,
  validateBranchParentHierarchy,
  resolveBranchByCollectorCode,
  buildBranchFilter,
} from "@/lib/branch";
import {
  getAmbiguousHistoricalRecords,
  reconcileHistoricalRecord,
  getReconciliationAudits,
} from "@/lib/branch-reconciliation";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_enterprise_branch_disposable";
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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Knowletive Phase 2 — Enterprise Branch Hierarchy, Multi-Branch & Historical Attribution", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  // Tenants
  let tenantA: any;
  let tenantB: any;

  // Tenant A Branches
  let branchMainA: any;
  let branchA1: any;
  let branchA2: any;
  let branchA1_Child: any;
  let branchSiblingMain: any;

  // Tenant B Branches
  let branchMainB: any;
  let branchB1: any;
  let branchB2: any;

  // Roles
  let roleAdmin: any;
  let roleAccountant: any;
  let roleTeacher: any;

  // Users & Memberships
  let userOwnerA: any;
  let memberOwnerA: any;

  let userStaffA1: any;
  let memberStaffA1: any;

  let userStaffA2: any;
  let memberStaffA2: any;

  let userMultiStaff: any;
  let memberMultiStaff: any;

  let userMainStaff: any;
  let memberMainStaff: any;

  let userExactMainStaff: any;
  let memberExactMainStaff: any;

  let userAdminStaff: any;
  let memberAdminStaff: any;

  let userUnassignedStaff: any;
  let memberUnassignedStaff: any;

  let userInactiveStaff: any;
  let memberInactiveStaff: any;

  beforeAll(async () => {
    // 1. Provision disposable test database
    adminClient = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${DISPOSABLE_DB_NAME} OWNER knowletive;`);

    // 2. Deploy canonical migrations
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect test client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    setDb(db);
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Synchronize RBAC canonical permissions
    await syncPermissions(db, { strict: true });

    // 5. Seed Tenants
    tenantA = await db.tenant.create({
      data: {
        name: "Apex Global Academy",
        slug: "apex-p2",
        email: "apex-p2@example.com",
        logoInitials: "AG",
        type: "SCHOOL",
        status: "ACTIVE",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        name: "Zenith Horizon School",
        slug: "zenith-p2",
        email: "zenith-p2@example.com",
        logoInitials: "ZH",
        type: "SCHOOL",
        status: "ACTIVE",
      },
    });

    // 6. Seed Roles in Tenant A
    roleAdmin = await db.role.create({
      data: {
        tenantId: tenantA.id,
        key: "INSTITUTE_ADMIN",
        name: "Institute Administrator",
        scope: "TENANT",
        isSystem: true,
      },
    });

    roleAccountant = await db.role.create({
      data: {
        tenantId: tenantA.id,
        key: "ACCOUNTANT",
        name: "Accountant",
        scope: "TENANT",
        isSystem: false,
      },
    });

    roleTeacher = await db.role.create({
      data: {
        tenantId: tenantA.id,
        key: "TEACHER",
        name: "Teacher",
        scope: "TENANT",
        isSystem: false,
      },
    });

    // Link permissions to roles
    const permFeesRead = await db.permission.findUnique({ where: { key: "tenant.fees.read" } });
    const permFeesWrite = await db.permission.findUnique({ where: { key: "tenant.fees.write" } });
    const permSettingsManage = await db.permission.findUnique({ where: { key: "tenant.settings.manage" } });

    if (permFeesRead) {
      await db.rolePermission.createMany({
        data: [
          { roleId: roleAccountant.id, permissionKey: permFeesRead.key },
          { roleId: roleAdmin.id, permissionKey: permFeesRead.key },
        ],
        skipDuplicates: true,
      });
    }
    if (permFeesWrite) {
      await db.rolePermission.createMany({
        data: [
          { roleId: roleAccountant.id, permissionKey: permFeesWrite.key },
          { roleId: roleAdmin.id, permissionKey: permFeesWrite.key },
        ],
        skipDuplicates: true,
      });
    }
    if (permSettingsManage) {
      await db.rolePermission.create({
        data: { roleId: roleAdmin.id, permissionKey: permSettingsManage.key },
      });
    }

    // 7. Seed Branches in Tenant A (Hierarchy: Main -> A1 -> A1_Child; Main -> A2; Sibling Main)
    branchMainA = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "Main Campus A",
        code: "APX-MAIN",
        branchType: "MAIN",
        collectorCode: "COL-APX-MAIN",
      },
    });

    branchA1 = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        parentBranchId: branchMainA.id,
        name: "North Branch A1",
        code: "APX-A1",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-APX-A1",
      },
    });

    branchA2 = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        parentBranchId: branchMainA.id,
        name: "South Branch A2",
        code: "APX-A2",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-APX-A2",
      },
    });

    branchA1_Child = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        parentBranchId: branchA1.id,
        name: "North Sub-Branch A1-Child",
        code: "APX-A1-CHILD",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-APX-A1-SUB",
      },
    });

    branchSiblingMain = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "East Campus Sibling",
        code: "APX-EAST",
        branchType: "MAIN",
        collectorCode: "COL-APX-EAST",
      },
    });

    // 8. Seed Branches in Tenant B
    branchMainB = await db.branch.create({
      data: {
        tenantId: tenantB.id,
        name: "Zenith Main Campus B",
        code: "ZEN-MAIN",
        branchType: "MAIN",
        collectorCode: "COL-ZEN-MAIN",
      },
    });

    branchB1 = await db.branch.create({
      data: {
        tenantId: tenantB.id,
        parentBranchId: branchMainB.id,
        name: "Zenith Branch B1",
        code: "ZEN-B1",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-ZEN-B1",
      },
    });

    branchB2 = await db.branch.create({
      data: {
        tenantId: tenantB.id,
        parentBranchId: branchMainB.id,
        name: "Zenith Branch B2",
        code: "ZEN-B2",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-ZEN-B2",
      },
    });

    // 9. Seed Users and Memberships
    // Institute Owner
    userOwnerA = await db.user.create({
      data: { name: "Owner Apex", email: "owner@apex.test", avatarColor: "#111", passwordHash: "dummy" },
    });
    memberOwnerA = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userOwnerA.id, roleId: roleAdmin.id, isOwner: true, branchId: null },
    });

    // Staff assigned to A1
    userStaffA1 = await db.user.create({
      data: { name: "Staff A1", email: "staff-a1@apex.test", avatarColor: "#222", passwordHash: "dummy" },
    });
    memberStaffA1 = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userStaffA1.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: memberStaffA1.id,
        branchId: branchA1.id,
        scopeMode: "EXACT_BRANCH",
      },
    });

    // Staff assigned to A2
    userStaffA2 = await db.user.create({
      data: { name: "Staff A2", email: "staff-a2@apex.test", avatarColor: "#333", passwordHash: "dummy" },
    });
    memberStaffA2 = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userStaffA2.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: memberStaffA2.id,
        branchId: branchA2.id,
        scopeMode: "EXACT_BRANCH",
      },
    });

    // Staff assigned to both A1 and A2
    userMultiStaff = await db.user.create({
      data: { name: "Multi Staff A1 and A2", email: "multi@apex.test", avatarColor: "#444", passwordHash: "dummy" },
    });
    memberMultiStaff = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userMultiStaff.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    await db.membershipBranch.createMany({
      data: [
        { tenantId: tenantA.id, membershipId: memberMultiStaff.id, branchId: branchA1.id, scopeMode: "EXACT_BRANCH" },
        { tenantId: tenantA.id, membershipId: memberMultiStaff.id, branchId: branchA2.id, scopeMode: "EXACT_BRANCH" },
      ],
    });

    // Main-branch staff with BRANCH_AND_DESCENDANTS
    userMainStaff = await db.user.create({
      data: { name: "Main Descendants Staff", email: "main-desc@apex.test", avatarColor: "#555", passwordHash: "dummy" },
    });
    memberMainStaff = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userMainStaff.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: memberMainStaff.id,
        branchId: branchMainA.id,
        scopeMode: "BRANCH_AND_DESCENDANTS",
      },
    });

    // Main-branch staff with EXACT_BRANCH
    userExactMainStaff = await db.user.create({
      data: { name: "Exact Main Staff", email: "exact-main@apex.test", avatarColor: "#666", passwordHash: "dummy" },
    });
    memberExactMainStaff = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userExactMainStaff.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: memberExactMainStaff.id,
        branchId: branchMainA.id,
        scopeMode: "EXACT_BRANCH",
      },
    });

    // Institute Administrator (no explicit branch assignment)
    userAdminStaff = await db.user.create({
      data: { name: "Admin Staff", email: "admin@apex.test", avatarColor: "#777", passwordHash: "dummy" },
    });
    memberAdminStaff = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userAdminStaff.id, roleId: roleAdmin.id, isOwner: false, branchId: null },
    });

    // Staff with no branch assignment
    userUnassignedStaff = await db.user.create({
      data: { name: "Unassigned Staff", email: "unassigned@apex.test", avatarColor: "#888", passwordHash: "dummy" },
    });
    memberUnassignedStaff = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userUnassignedStaff.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });

    // Inactive staff
    userInactiveStaff = await db.user.create({
      data: { name: "Inactive Staff", email: "inactive@apex.test", avatarColor: "#999", passwordHash: "dummy" },
    });
    memberInactiveStaff = await db.membership.create({
      data: {
        tenantId: tenantA.id,
        userId: userInactiveStaff.id,
        roleId: roleAccountant.id,
        isOwner: false,
        status: "SUSPENDED",
        branchId: null,
      },
    });
    await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: memberInactiveStaff.id,
        branchId: branchA1.id,
        scopeMode: "EXACT_BRANCH",
      },
    });
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
    if (adminClient) {
      await adminClient.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
      `);
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
      await adminClient.$disconnect();
    }
  });

  it("Scenario 1: Staff assigned only to A1 accesses A1, denied on A2, Main A, and any other branch", async () => {
    const ctx = {
      tenant: tenantA,
      user: userStaffA1,
      membership: memberStaffA1,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.isBranchScoped).toBe(true);
    expect(scope.hasAccess).toBe(true);
    expect(scope.allowedBranchIds).toEqual([branchA1.id]);

    const accessA1 = await verifyBranchAccess(ctx as any, branchA1.id);
    expect(accessA1.ok).toBe(true);

    const accessA2 = await verifyBranchAccess(ctx as any, branchA2.id);
    expect(accessA2.ok).toBe(false);

    const accessMain = await verifyBranchAccess(ctx as any, branchMainA.id);
    expect(accessMain.ok).toBe(false);
  });

  it("Scenario 2: Staff assigned only to A2 accesses A2, denied on A1, Main A, and any other branch", async () => {
    const ctx = {
      tenant: tenantA,
      user: userStaffA2,
      membership: memberStaffA2,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.allowedBranchIds).toEqual([branchA2.id]);

    expect((await verifyBranchAccess(ctx as any, branchA2.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA1.id)).ok).toBe(false);
    expect((await verifyBranchAccess(ctx as any, branchMainA.id)).ok).toBe(false);
  });

  it("Scenario 3: Staff assigned to both A1 and A2 within permitted tenant context can access both, denied on A1_Child and Main", async () => {
    const ctx = {
      tenant: tenantA,
      user: userMultiStaff,
      membership: memberMultiStaff,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.allowedBranchIds).toContain(branchA1.id);
    expect(scope.allowedBranchIds).toContain(branchA2.id);
    expect(scope.allowedBranchIds).not.toContain(branchMainA.id);
    expect(scope.allowedBranchIds).not.toContain(branchA1_Child.id);

    expect((await verifyBranchAccess(ctx as any, branchA1.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA2.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchMainA.id)).ok).toBe(false);
    expect((await verifyBranchAccess(ctx as any, branchA1_Child.id)).ok).toBe(false);
  });

  it("Scenario 4: Main-branch staff with BRANCH_AND_DESCENDANTS accesses Main, Sub-1, Sub-2, and Multi-level Sub-Child, denied on Sibling Main", async () => {
    const ctx = {
      tenant: tenantA,
      user: userMainStaff,
      membership: memberMainStaff,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.allowedBranchIds).toContain(branchMainA.id);
    expect(scope.allowedBranchIds).toContain(branchA1.id);
    expect(scope.allowedBranchIds).toContain(branchA2.id);
    expect(scope.allowedBranchIds).toContain(branchA1_Child.id);
    expect(scope.allowedBranchIds).not.toContain(branchSiblingMain.id);

    expect((await verifyBranchAccess(ctx as any, branchMainA.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA1.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA2.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA1_Child.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchSiblingMain.id)).ok).toBe(false);
  });

  it("Scenario 5: Exact-branch staff accesses only assigned branch, denied on sub-branches", async () => {
    const ctx = {
      tenant: tenantA,
      user: userExactMainStaff,
      membership: memberExactMainStaff,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.allowedBranchIds).toEqual([branchMainA.id]);

    expect((await verifyBranchAccess(ctx as any, branchMainA.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA1.id)).ok).toBe(false);
    expect((await verifyBranchAccess(ctx as any, branchA2.id)).ok).toBe(false);
    expect((await verifyBranchAccess(ctx as any, branchA1_Child.id)).ok).toBe(false);
  });

  it("Scenario 6: Tenant-wide institute administrator accesses all branches without explicit assignment", async () => {
    const ctx = {
      tenant: tenantA,
      user: userAdminStaff,
      membership: { ...memberAdminStaff, roleKey: "INSTITUTE_ADMIN" },
      permissions: new Set(["tenant.settings.manage", "tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("TENANT_WIDE");
    expect(scope.isBranchScoped).toBe(false);
    expect(scope.hasAccess).toBe(true);

    expect((await verifyBranchAccess(ctx as any, branchMainA.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA1.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchA2.id)).ok).toBe(true);
    expect((await verifyBranchAccess(ctx as any, branchSiblingMain.id)).ok).toBe(true);

    // Filter for tenant-wide mode does not restrict
    const filter = buildBranchFilter(scope.allowedBranchIds);
    expect(filter).toBeDefined();
  });

  it("Scenario 7: Staff with no branch assignment receives mode NO_ACCESS, denied on all branch operations", async () => {
    const ctx = {
      tenant: tenantA,
      user: userUnassignedStaff,
      membership: memberUnassignedStaff,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("NO_ACCESS");
    expect(scope.isBranchScoped).toBe(true);
    expect(scope.hasAccess).toBe(false);
    expect(scope.allowedBranchIds).toHaveLength(0);

    const access = await verifyBranchAccess(ctx as any, branchA1.id);
    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(access.error).toContain("Access denied");
    }

    // Fail closed filter
    const filter = buildBranchFilter(scope.allowedBranchIds);
    expect(filter).toEqual({ branchId: { in: [] } });
  });

  it("Scenario 8: Inactive membership receives mode NO_ACCESS even if branch is assigned", async () => {
    const ctx = {
      tenant: tenantA,
      user: userInactiveStaff,
      membership: memberInactiveStaff,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("NO_ACCESS");
    expect(scope.hasAccess).toBe(false);
    expect(scope.allowedBranchIds).toHaveLength(0);

    const access = await verifyBranchAccess(ctx as any, branchA1.id);
    expect(access.ok).toBe(false);
  });

  it("Scenario 9: Cross-tenant branch assignment is rejected by database foreign key constraint", async () => {
    // Attempting to assign staff from Tenant A to Branch in Tenant B under Tenant A
    await expect(
      db.membershipBranch.create({
        data: {
          tenantId: tenantA.id,
          membershipId: memberStaffA1.id,
          branchId: branchB1.id, // Belongs to Tenant B!
          scopeMode: "EXACT_BRANCH",
        },
      })
    ).rejects.toThrow();
  });

  it("Scenario 10: Cross-tenant parent-child relationship is rejected by composite foreign key", async () => {
    // Attempting to set Branch in Tenant B as parent of Branch in Tenant A
    await expect(
      db.branch.update({
        where: { tenantId_id: { tenantId: tenantA.id, id: branchA1.id } },
        data: { parentBranchId: branchMainB.id }, // Belongs to Tenant B!
      })
    ).rejects.toThrow();
  });

  it("Scenario 11: Circular hierarchy rejection (database check constraint on self-parent and cycle validation on ancestor chain)", async () => {
    // 1. Self-parenting rejected by DB check constraint
    await expect(
      db.branch.update({
        where: { tenantId_id: { tenantId: tenantA.id, id: branchA1.id } },
        data: { parentBranchId: branchA1.id },
      })
    ).rejects.toThrow();

    // 2. Direct self-parent check via helper
    const selfCheck = await validateBranchParentHierarchy(tenantA.id, branchA1.id, branchA1.id, db);
    expect(selfCheck.valid).toBe(false);
    expect(selfCheck.error).toContain("A branch cannot be its own parent");

    // 3. Multi-level circular hierarchy: A1 is parent of A1_Child. Setting A1_Child as parent of A1 must fail.
    const cycleCheck = await validateBranchParentHierarchy(tenantA.id, branchA1.id, branchA1_Child.id, db);
    expect(cycleCheck.valid).toBe(false);
    expect(cycleCheck.error).toContain("Circular branch hierarchy detected");
  });

  it("Scenario 12: Descendant traversal at multiple levels (Main -> A1 -> A1_Child)", async () => {
    const descendantsFromMain = await getBranchDescendantIds(tenantA.id, [branchMainA.id], {
      includeSelf: true,
      client: db,
    });
    expect(descendantsFromMain).toContain(branchMainA.id);
    expect(descendantsFromMain).toContain(branchA1.id);
    expect(descendantsFromMain).toContain(branchA2.id);
    expect(descendantsFromMain).toContain(branchA1_Child.id);
    expect(descendantsFromMain).not.toContain(branchSiblingMain.id);

    const descendantsFromA1 = await getBranchDescendantIds(tenantA.id, [branchA1.id], {
      includeSelf: true,
      client: db,
    });
    expect(descendantsFromA1).toEqual(expect.arrayContaining([branchA1.id, branchA1_Child.id]));
    expect(descendantsFromA1).not.toContain(branchMainA.id);
    expect(descendantsFromA1).not.toContain(branchA2.id);
  });

  it("Scenario 13: Assignment revocation takes immediate effect", async () => {
    // Create temporary staff assigned to A1
    const tempUser = await db.user.create({
      data: { name: "Temp Staff", email: "temp@apex.test", avatarColor: "#aaa", passwordHash: "dummy" },
    });
    const tempMember = await db.membership.create({
      data: { tenantId: tenantA.id, userId: tempUser.id, roleId: roleAccountant.id, isOwner: false, branchId: null },
    });
    const assignment = await db.membershipBranch.create({
      data: {
        tenantId: tenantA.id,
        membershipId: tempMember.id,
        branchId: branchA1.id,
        scopeMode: "EXACT_BRANCH",
      },
    });

    const ctx = {
      tenant: tenantA,
      user: tempUser,
      membership: tempMember,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    let scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("RESTRICTED");
    expect(scope.allowedBranchIds).toEqual([branchA1.id]);

    // Revoke assignment
    await db.membershipBranch.delete({ where: { id: assignment.id } });

    scope = await resolveUserBranchScope(ctx as any);
    expect(scope.mode).toBe("NO_ACCESS");
    expect(scope.hasAccess).toBe(false);
  });

  it("Scenario 14: Branch archival preserves historical financial attribution and prevents destructive physical deletion", async () => {
    // Create branch to archive
    const archBranch = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "Branch to Archive",
        code: "APX-ARCH",
        branchType: "SUB_BRANCH",
      },
    });

    // Create a lead in this branch (Lead has ON DELETE RESTRICT to Branch)
    await db.lead.create({
      data: {
        tenantId: tenantA.id,
        branchId: archBranch.id,
        studentName: "Lead in Archive Branch",
        guardianName: "Parent Archive",
        guardianPhone: "+919876543210",
      },
    });

    // Create student and invoice in this branch
    const student = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-ARCH-01",
        firstName: "Archival",
        lastName: "Test",
        branchId: archBranch.id,
      },
    });

    const invoice = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: student.id,
        branchId: archBranch.id,
        number: "INV-ARCH-01",
        title: "Archival Tuition",
        amount: 250000,
        dueDate: new Date(),
      },
    });

    // Soft-archive branch
    await db.branch.update({
      where: { tenantId_id: { tenantId: tenantA.id, id: archBranch.id } },
      data: { isActive: false },
    });

    // Historical invoice still references archBranch.id
    const retrievedInv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(retrievedInv?.branchId).toBe(archBranch.id);

    // Destructive physical deletion must fail due to foreign key RESTRICT constraints on Lead
    await expect(
      db.branch.delete({ where: { tenantId_id: { tenantId: tenantA.id, id: archBranch.id } } })
    ).rejects.toThrow();
  });

  it("Scenario 15: Student branch transfer preserves historical invoice and receipt attribution", async () => {
    const student = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-TRF-01",
        firstName: "Transfer",
        lastName: "Student",
        branchId: branchA1.id,
      },
    });

    // Issue invoice and receipt in Branch A1
    const invoice1 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: student.id,
        branchId: branchA1.id,
        number: "INV-TRF-01",
        title: "A1 Term 1 Fee",
        amount: 100000,
        dueDate: new Date(),
      },
    });

    const receipt1 = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: student.id,
          branchId: branchA1.id,
          receiptNumber: "RCPT-TRF-01",
          amount: 100000,
          method: "CASH",
          provider: "cashier",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          unappliedAmount: 100000,
        },
      });
      return r;
    });

    // Student transfers to Branch A2
    await db.student.update({
      where: { id: student.id },
      data: { branchId: branchA2.id },
    });

    // Issue invoice in Branch A2
    const invoice2 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: student.id,
        branchId: branchA2.id,
        number: "INV-TRF-02",
        title: "A2 Term 2 Fee",
        amount: 120000,
        dueDate: new Date(),
      },
    });

    // Historical records remain attributed to A1
    const oldInv = await db.feeInvoice.findUnique({ where: { id: invoice1.id } });
    const oldRcpt = await db.paymentReceipt.findUnique({ where: { id: receipt1.id } });
    const newInv = await db.feeInvoice.findUnique({ where: { id: invoice2.id } });

    expect(oldInv?.branchId).toBe(branchA1.id);
    expect(oldRcpt?.branchId).toBe(branchA1.id);
    expect(newInv?.branchId).toBe(branchA2.id);
  });

  it("Scenario 16: Payment collection branch and invoice receivable branch are independently tracked", async () => {
    const student = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-COL-01",
        firstName: "Collection",
        lastName: "Test",
        branchId: branchA1.id,
      },
    });

    // Invoice receivable belongs to Branch A1
    const invoice = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: student.id,
        branchId: branchA1.id,
        number: "INV-COL-01",
        title: "Receivable A1",
        amount: 50000,
        dueDate: new Date(),
      },
    });

    // Parent walks into cash counter at Branch A2 to pay
    const payment = await db.feePayment.create({
      data: {
        tenantId: tenantA.id,
        feeInvoiceId: invoice.id,
        branchId: branchA2.id, // Collection branch
        amount: 50000,
        method: "CASH",
      },
    });

    expect(invoice.branchId).toBe(branchA1.id);
    expect(payment.branchId).toBe(branchA2.id);

    // Create receipt with balance projection
    const receipt = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: student.id,
          branchId: branchA2.id,
          receiptNumber: "RCPT-COL-01",
          amount: 50000,
          method: "CASH",
          provider: "cashier",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          unappliedAmount: 50000,
        },
      });
      return r;
    });

    // Allocation branch matches invoice receivable branch
    const allocation = await db.paymentAllocation.create({
      data: {
        tenantId: tenantA.id,
        receiptId: receipt.id,
        studentId: student.id,
        feeInvoiceId: invoice.id,
        branchId: branchA1.id, // Allocation branch
        amount: 50000,
      },
    });

    expect(allocation.branchId).toBe(branchA1.id);
  });

  it("Scenario 17: Cross-branch credit transfer provenance tracks sourceBranchId and targetBranchId", async () => {
    const student1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-SIB-01",
        firstName: "Elder",
        lastName: "Sibling",
        branchId: branchA1.id,
      },
    });

    const student2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-SIB-02",
        firstName: "Younger",
        lastName: "Sibling",
        branchId: branchA2.id,
      },
    });

    const receipt = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: student1.id,
          branchId: branchA1.id,
          receiptNumber: "RCPT-SIB-01",
          amount: 50000,
          method: "CASH",
          provider: "cashier",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          unappliedAmount: 50000,
        },
      });
      return r;
    });

    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: "TRNS-2026-00099",
          sourceStudentId: student1.id,
          targetStudentId: student2.id,
          sourceReceiptId: receipt.id,
          sourceBranchId: branchA1.id,
          targetBranchId: branchA2.id,
          amount: 30000,
          reason: "Cross-branch sibling tuition adjustment",
          requestedById: userStaffA1.id,
          status: "COMPLETED",
        },
      });

      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          receiptId: receipt.id,
          entryType: "DEBIT",
          studentId: student1.id,
          counterpartyStudentId: student2.id,
          amount: 30000,
        },
      });

      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          receiptId: receipt.id,
          entryType: "CREDIT",
          studentId: student2.id,
          counterpartyStudentId: student1.id,
          amount: 30000,
        },
      });

      return j;
    });

    expect(journal.sourceBranchId).toBe(branchA1.id);
    expect(journal.targetBranchId).toBe(branchA2.id);

    // Verify relations
    const fetched = await db.creditTransferJournal.findUnique({
      where: { id: journal.id },
      include: { sourceBranch: true, targetBranch: true },
    });
    expect(fetched?.sourceBranch?.id).toBe(branchA1.id);
    expect(fetched?.targetBranch?.id).toBe(branchA2.id);
  });

  it("Scenario 18: Ambiguous collector-code fails safe and quarantines instead of misattributing", async () => {
    // 1. Unknown collector code -> NOT_FOUND
    const unknownRes = await resolveBranchByCollectorCode(tenantA.id, "COL-NON-EXISTENT", db);
    expect(unknownRes.status).toBe("NOT_FOUND");
    expect(unknownRes.branchId).toBeNull();

    // 2. Unique collector code -> MATCHED
    const matchedRes = await resolveBranchByCollectorCode(tenantA.id, "COL-APX-A1", db);
    expect(matchedRes.status).toBe("MATCHED");
    expect(matchedRes.branchId).toBe(branchA1.id);

    // 3. Shared collector code without distinguishing metadata -> AMBIGUOUS (quarantined)
    const duplicateBranch = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "Conflicting Branch",
        code: "APX-CONF",
        collectorCode: "COL-APX-A1", // Shared code!
      },
    });

    const sharedRes = await resolveBranchByCollectorCode(tenantA.id, "COL-APX-A1", db);
    expect(sharedRes.status).toBe("AMBIGUOUS");
    expect(sharedRes.branchId).toBeNull();

    // Clean up duplicate branch
    await db.branch.delete({ where: { id: duplicateBranch.id } });
  });

  it("Scenario 19: Historical null-branch reconciliation workflow: unassigned scanning, owner confirmation, audit logging, and non-owner rejection", async () => {
    // Create unassigned invoice with null branch
    const unassignedStudent = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: "ADM-NULL-01",
        firstName: "Unassigned",
        lastName: "Candidate",
        branchId: branchA1.id,
      },
    });

    const unassignedInvoice = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: unassignedStudent.id,
        branchId: null,
        number: "INV-NULL-01",
        title: "Legacy Unassigned Invoice",
        amount: 75000,
        dueDate: new Date(),
      },
    });

    // 1. Scan for ambiguous records
    const ambiguous = await getAmbiguousHistoricalRecords(tenantA.id);
    const foundInv = ambiguous.find((a) => a.recordId === unassignedInvoice.id);
    expect(foundInv).toBeDefined();
    expect(foundInv?.suggestedBranchId).toBeNull();

    // 2. Non-owner staff attempts reconciliation -> rejected
    const staffCtx = {
      tenant: tenantA,
      user: userStaffA1,
      membership: memberStaffA1,
      permissions: new Set(["tenant.settings.manage"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    const staffAttempt = await reconcileHistoricalRecord(staffCtx as any, {
      recordType: "FeeInvoice",
      recordId: unassignedInvoice.id,
      newBranchId: branchA1.id,
      reason: "Attempted by staff",
    });
    expect(staffAttempt.success).toBe(false);
    expect(staffAttempt.error).toContain("Forbidden");

    // 3. Institute Owner reconciles successfully
    const ownerCtx = {
      tenant: tenantA,
      user: userOwnerA,
      membership: memberOwnerA,
      permissions: new Set(["tenant.settings.manage"]),
      isOwnerView: true,
      subscriptionBlocked: false,
      branchId: null,
    };

    const ownerReconcile = await reconcileHistoricalRecord(ownerCtx as any, {
      recordType: "FeeInvoice",
      recordId: unassignedInvoice.id,
      newBranchId: branchA1.id,
      reason: "Reconciled based on primary student branch",
      candidateEvidence: "Associated student branch",
    });

    expect(ownerReconcile.success).toBe(true);
    expect(ownerReconcile.auditId).toBeDefined();

    // Verify invoice is now attributed
    const updatedInvoice = await db.feeInvoice.findUnique({ where: { id: unassignedInvoice.id } });
    expect(updatedInvoice?.branchId).toBe(branchA1.id);

    // Verify audit record exists
    const audits = await getReconciliationAudits(tenantA.id);
    const auditRecord = audits.find((a) => a.recordId === unassignedInvoice.id);
    expect(auditRecord).toBeDefined();
    expect(auditRecord?.previousBranchId).toBeNull();
    expect(auditRecord?.newBranchId).toBe(branchA1.id);
    expect(auditRecord?.reason).toBe("Reconciled based on primary student branch");
  });

  it("Scenario 20: Direct API and IDOR attempts on unauthorized branches fail with Access Denied", async () => {
    const ctx = {
      tenant: tenantA,
      user: userStaffA1,
      membership: memberStaffA1,
      permissions: new Set(["tenant.fees.read"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: null,
    };

    // IDOR 1: Staff from Branch A1 attempts to access Branch A2
    const idorA2 = await verifyBranchAccess(ctx as any, branchA2.id);
    expect(idorA2.ok).toBe(false);
    if (!idorA2.ok) {
      expect(idorA2.error).toContain("Access denied");
    }

    // IDOR 2: Staff from Tenant A attempts to access Branch from Tenant B
    const idorCrossTenant = await verifyBranchAccess(ctx as any, branchB1.id);
    expect(idorCrossTenant.ok).toBe(false);
    if (!idorCrossTenant.ok) {
      expect(idorCrossTenant.error).toContain("does not exist in this institute");
    }
  });
});
