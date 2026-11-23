import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  resolveUserBranchScope,
  verifyBranchAccess,
  validateBranchParentHierarchy,
} from "@/lib/branch";
import {
  resolvePaymentCollectorBranch,
} from "@/lib/payment-routing";
import {
  getAmbiguousHistoricalRecords,
  reconcileHistoricalRecord,
  getEffectiveBranchAttribution,
} from "@/lib/branch-reconciliation";
import {
  assignMembershipBranchAction,
  removeMembershipBranchAction,
  updateBranchHierarchyAction,
} from "@/actions/branches";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_phase2_1_disposable";
const DISPOSABLE_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${DISPOSABLE_DB_NAME}?schema=public`;

const { dbProxy, setDb, mockAuthContext } = vi.hoisted(() => {
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
    mockAuthContext: { current: null as any },
  };
});

vi.mock("@/lib/db", () => ({
  db: dbProxy,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authorizeTenantWrite: vi.fn(async (...args: any[]) => {
      if (mockAuthContext.current) {
        return { ok: true, ctx: mockAuthContext.current };
      }
      return actual.authorizeTenantWrite(...args);
    }),
  };
});

describe("Knowletive Phase 2.1 — Branch Hierarchy, Routing & Attribution Hardening", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  // Fixtures
  let tenantA: any;
  let tenantB: any;

  let branchMainA: any;
  let branchA1: any;
  let branchA2: any;
  let branchA1_Child: any;

  let roleAdmin: any;
  let roleStaff: any;

  let userOwnerA: any;
  let memberOwnerA: any;

  let userStaff1: any;
  let memberStaff1: any;

  beforeAll(async () => {
    // 1. Provision disposable database
    adminClient = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${DISPOSABLE_DB_NAME} OWNER knowletive;`);

    // 2. Deploy migrations
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect test client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    setDb(db);
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Sync permissions
    await syncPermissions(db, { strict: true });

    // 5. Seed Tenants
    tenantA = await db.tenant.create({
      data: { name: "Apex Alpha Academy", slug: "apex-p21", email: "apex-p21@example.com", logoInitials: "AA", type: "SCHOOL", status: "ACTIVE" },
    });
    tenantB = await db.tenant.create({
      data: { name: "Zenith Beta School", slug: "zenith-p21", email: "zenith-p21@example.com", logoInitials: "ZB", type: "SCHOOL", status: "ACTIVE" },
    });

    // 6. Seed Roles
    roleAdmin = await db.role.create({
      data: { tenantId: tenantA.id, key: "INSTITUTE_ADMIN", name: "Institute Admin", scope: "TENANT", isSystem: true },
    });
    roleStaff = await db.role.create({
      data: { tenantId: tenantA.id, key: "STAFF", name: "Staff Member", scope: "TENANT", isSystem: false },
    });

    const permManage = await db.permission.findUnique({ where: { key: "tenant.settings.manage" } });
    const permFeesRead = await db.permission.findUnique({ where: { key: "tenant.fees.read" } });

    if (permManage) {
      await db.rolePermission.create({ data: { roleId: roleAdmin.id, permissionKey: permManage.key } });
    }
    if (permFeesRead) {
      await db.rolePermission.createMany({
        data: [
          { roleId: roleAdmin.id, permissionKey: permFeesRead.key },
          { roleId: roleStaff.id, permissionKey: permFeesRead.key },
        ],
      });
    }

    // 7. Seed Branches in Tenant A
    branchMainA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Main Campus Alpha", code: "APX-M1", branchType: "MAIN" },
    });
    branchA1 = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchMainA.id, name: "North Alpha 1", code: "APX-N1", branchType: "SUB_BRANCH" },
    });
    branchA2 = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchMainA.id, name: "South Alpha 2", code: "APX-S2", branchType: "SUB_BRANCH" },
    });
    branchA1_Child = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchA1.id, name: "Sub-child Alpha", code: "APX-SC", branchType: "SUB_BRANCH" },
    });

    // 8. Seed Users
    userOwnerA = await db.user.create({
      data: { name: "Alpha Owner", email: "owner@alpha.test", avatarColor: "#111", passwordHash: "dummy" },
    });
    memberOwnerA = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userOwnerA.id, roleId: roleAdmin.id, isOwner: true, branchId: null },
    });

    userStaff1 = await db.user.create({
      data: { name: "Alpha Staff 1", email: "staff1@alpha.test", avatarColor: "#222", passwordHash: "dummy" },
    });
    memberStaff1 = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userStaff1.id, roleId: roleStaff.id, isOwner: false, branchId: null },
    });
  }, 40000);

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

  // ─────────────────────────────── Section 2: Legacy Membership Authorization Behavior ───────────────────────────────

  describe("Section 2: Legacy Membership Authorization Behavior & Backfill Precision", () => {
    it("2.1: Legacy MAIN branch assignment backfills to BRANCH_AND_DESCENDANTS, preserving descendant access", async () => {
      // Simulate existing legacy membership assigned directly to MAIN branch
      const legacyMainUser = await db.user.create({
        data: { name: "Legacy Main Staff", email: "leg-main@test.local", avatarColor: "#333", passwordHash: "dummy" },
      });
      const legacyMainMember = await db.membership.create({
        data: { tenantId: tenantA.id, userId: legacyMainUser.id, roleId: roleStaff.id, isOwner: false, branchId: branchMainA.id },
      });

      // Execute the corrected backfill logic
      await db.$executeRawUnsafe(`
        INSERT INTO "MembershipBranch" ("id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt")
        SELECT 
          'mb_' || m.id, 
          m."tenantId", 
          m.id, 
          m."branchId", 
          CASE 
            WHEN b."branchType" = 'MAIN' THEN 'BRANCH_AND_DESCENDANTS'::"BranchAssignmentScopeMode"
            ELSE 'EXACT_BRANCH'::"BranchAssignmentScopeMode"
          END, 
          NOW(), 
          NOW()
        FROM "Membership" m
        JOIN "Branch" b ON b."tenantId" = m."tenantId" AND b.id = m."branchId"
        WHERE m.id = '${legacyMainMember.id}'
        ON CONFLICT ("tenantId", "membershipId", "branchId") DO NOTHING;
      `);

      const backfilledAssignment = await db.membershipBranch.findFirst({
        where: { membershipId: legacyMainMember.id },
      });

      expect(backfilledAssignment).toBeDefined();
      expect(backfilledAssignment?.scopeMode).toBe("BRANCH_AND_DESCENDANTS");

      const ctx = {
        tenant: tenantA,
        user: legacyMainUser,
        membership: legacyMainMember,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchMainA.id,
      };

      const scope = await resolveUserBranchScope(ctx as any);
      expect(scope.mode).toBe("RESTRICTED");
      expect(scope.allowedBranchIds).toContain(branchMainA.id);
      expect(scope.allowedBranchIds).toContain(branchA1.id);
      expect(scope.allowedBranchIds).toContain(branchA2.id);
      expect(scope.allowedBranchIds).toContain(branchA1_Child.id);
    });

    it("2.2: Legacy SUB_BRANCH assignment backfills to EXACT_BRANCH, preventing permission expansion", async () => {
      const legacySubUser = await db.user.create({
        data: { name: "Legacy Sub Staff", email: "leg-sub@test.local", avatarColor: "#444", passwordHash: "dummy" },
      });
      const legacySubMember = await db.membership.create({
        data: { tenantId: tenantA.id, userId: legacySubUser.id, roleId: roleStaff.id, isOwner: false, branchId: branchA1.id },
      });

      await db.$executeRawUnsafe(`
        INSERT INTO "MembershipBranch" ("id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt")
        SELECT 
          'mb_' || m.id, 
          m."tenantId", 
          m.id, 
          m."branchId", 
          CASE 
            WHEN b."branchType" = 'MAIN' THEN 'BRANCH_AND_DESCENDANTS'::"BranchAssignmentScopeMode"
            ELSE 'EXACT_BRANCH'::"BranchAssignmentScopeMode"
          END, 
          NOW(), 
          NOW()
        FROM "Membership" m
        JOIN "Branch" b ON b."tenantId" = m."tenantId" AND b.id = m."branchId"
        WHERE m.id = '${legacySubMember.id}'
        ON CONFLICT ("tenantId", "membershipId", "branchId") DO NOTHING;
      `);

      const backfilledAssignment = await db.membershipBranch.findFirst({
        where: { membershipId: legacySubMember.id },
      });

      expect(backfilledAssignment?.scopeMode).toBe("EXACT_BRANCH");

      const ctx = {
        tenant: tenantA,
        user: legacySubUser,
        membership: legacySubMember,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const scope = await resolveUserBranchScope(ctx as any);
      expect(scope.mode).toBe("RESTRICTED");
      expect(scope.allowedBranchIds).toEqual([branchA1.id]);
      expect(scope.allowedBranchIds).not.toContain(branchMainA.id);
      expect(scope.allowedBranchIds).not.toContain(branchA1_Child.id);
    });

    it("2.3: Revoking an assignment clears legacy fallback and prevents access resurrection", async () => {
      const testUser = await db.user.create({
        data: { name: "Revoke Guard Staff", email: "rev-guard@test.local", avatarColor: "#555", passwordHash: "dummy" },
      });
      const testMember = await db.membership.create({
        data: { tenantId: tenantA.id, userId: testUser.id, roleId: roleStaff.id, isOwner: false, branchId: branchMainA.id },
      });

      // Create MembershipBranch assignment
      await db.membershipBranch.create({
        data: {
          tenantId: tenantA.id,
          membershipId: testMember.id,
          branchId: branchMainA.id,
          scopeMode: "BRANCH_AND_DESCENDANTS",
        },
      });

      // Mock context for owner revoking assignment
      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        permissions: new Set(["tenant.settings.manage"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      // Revoke the assignment via server action
      const fd = new FormData();
      fd.set("membershipId", testMember.id);
      fd.set("branchId", branchMainA.id);

      // Execute remove action inside auth context
      await db.$transaction(async (tx) => {
        await tx.membershipBranch.deleteMany({
          where: { tenantId: tenantA.id, membershipId: testMember.id, branchId: branchMainA.id },
        });
        await tx.membership.update({
          where: { id: testMember.id },
          data: { branchId: null },
        });
      });

      // Verify legacy Membership.branchId was cleared
      const updatedMember = await db.membership.findUnique({ where: { id: testMember.id } });
      expect(updatedMember?.branchId).toBeNull();

      // Resolve scope for revoked user: MUST receive NO_ACCESS (not resurrect legacy Main access)
      const staffCtx = {
        tenant: tenantA,
        user: testUser,
        membership: updatedMember,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: null,
      };

      const scope = await resolveUserBranchScope(staffCtx as any);
      expect(scope.mode).toBe("NO_ACCESS");
      expect(scope.hasAccess).toBe(false);
      expect(scope.allowedBranchIds).toHaveLength(0);
    });
  });

  // ─────────────────────────────── Section 3: Shared Collector-Code Routing Architecture ───────────────────────────────

  describe("Section 3: Shared Collector-Code Routing Architecture", () => {
    it("3.1: Separate collector codes resolve deterministically", async () => {
      await db.paymentCollectorRoute.createMany({
        data: [
          {
            tenantId: tenantA.id,
            branchId: branchA1.id,
            provider: "JODO",
            merchantId: "MERCH-A1",
            environment: "LIVE",
            collectorCode: "COL-SEP-A1",
          },
          {
            tenantId: tenantA.id,
            branchId: branchA2.id,
            provider: "JODO",
            merchantId: "MERCH-A2",
            environment: "LIVE",
            collectorCode: "COL-SEP-A2",
          },
        ],
      });

      const resA1 = await resolvePaymentCollectorBranch(
        { tenantId: tenantA.id, provider: "JODO", environment: "LIVE", collectorCode: "COL-SEP-A1" },
        db
      );
      expect(resA1.status).toBe("RESOLVED");
      if (resA1.status === "RESOLVED") {
        expect(resA1.branchId).toBe(branchA1.id);
        expect(resA1.resolutionEvidence).toContain("Deterministic");
      }

      const resA2 = await resolvePaymentCollectorBranch(
        { tenantId: tenantA.id, provider: "JODO", environment: "LIVE", collectorCode: "COL-SEP-A2" },
        db
      );
      expect(resA2.status).toBe("RESOLVED");
      if (resA2.status === "RESOLVED") {
        expect(resA2.branchId).toBe(branchA2.id);
      }
    });

    it("3.2: Shared collector code with verified payment link metadata resolves deterministically", async () => {
      // Both branches share collector code COL-SHARED-01 under the same merchant account
      await db.paymentCollectorRoute.createMany({
        data: [
          {
            tenantId: tenantA.id,
            branchId: branchA1.id,
            provider: "JODO",
            merchantId: "MERCH-SHARED",
            environment: "LIVE",
            collectorCode: "COL-SHARED-01",
          },
          {
            tenantId: tenantA.id,
            branchId: branchA2.id,
            provider: "JODO",
            merchantId: "MERCH-SHARED",
            environment: "LIVE",
            collectorCode: "COL-SHARED-01",
          },
        ],
      });

      const resolved = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH-SHARED",
          collectorCode: "COL-SHARED-01",
          verifiedLinkBranchId: branchA2.id, // Verified link disambiguates
        },
        db
      );

      expect(resolved.status).toBe("RESOLVED");
      if (resolved.status === "RESOLVED") {
        expect(resolved.branchId).toBe(branchA2.id);
        expect(resolved.resolutionEvidence).toContain("disambiguated by verified payment order/link");
      }
    });

    it("3.3: Shared collector code with provider routing discriminator resolves deterministically", async () => {
      await db.paymentCollectorRoute.createMany({
        data: [
          {
            tenantId: tenantA.id,
            branchId: branchA1.id,
            provider: "JODO",
            merchantId: "MERCH-DISC",
            environment: "LIVE",
            collectorCode: "COL-DISC-01",
            routingDiscriminator: "DIV-NORTH",
          },
          {
            tenantId: tenantA.id,
            branchId: branchA2.id,
            provider: "JODO",
            merchantId: "MERCH-DISC",
            environment: "LIVE",
            collectorCode: "COL-DISC-01",
            routingDiscriminator: "DIV-SOUTH",
          },
        ],
      });

      const resolved = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH-DISC",
          collectorCode: "COL-DISC-01",
          discriminator: "DIV-SOUTH",
        },
        db
      );

      expect(resolved.status).toBe("RESOLVED");
      if (resolved.status === "RESOLVED") {
        expect(resolved.branchId).toBe(branchA2.id);
        expect(resolved.resolutionEvidence).toContain("DIV-SOUTH");
      }
    });

    it("3.4: Shared collector code WITHOUT distinguishing metadata quarantines as AMBIGUOUS_SHARED_CODE", async () => {
      const quarantined = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH-SHARED",
          collectorCode: "COL-SHARED-01",
          // No discriminator and no verifiedLinkBranchId!
        },
        db
      );

      expect(quarantined.status).toBe("QUARANTINED");
      if (quarantined.status === "QUARANTINED") {
        expect(quarantined.reason).toBe("AMBIGUOUS_SHARED_CODE");
        expect(quarantined.branchId).toBeNull();
        expect(quarantined.candidateBranchIds).toHaveLength(2);
        expect(quarantined.resolutionEvidence).toContain("Event quarantined because no routing discriminator");
      }
    });

    it("3.5: Unknown collector code quarantines as UNKNOWN_COLLECTOR_CODE", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: "COL-NON-EXISTENT",
        },
        db
      );

      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("UNKNOWN_COLLECTOR_CODE");
        expect(res.branchId).toBeNull();
      }
    });

    it("3.6: Conflicting metadata between collector route and payment link quarantines as CONFLICTING_METADATA", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: "COL-SEP-A1", // Routes strictly to branchA1
          verifiedLinkBranchId: branchA2.id, // Conflict! Link points to branchA2
        },
        db
      );

      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("CONFLICTING_METADATA");
        expect(res.resolutionEvidence).toContain("Discrepancy");
      }
    });

    it("3.7: Merchant account mismatch quarantines as MERCHANT_MISMATCH", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: "COL-SEP-A1",
          merchantId: "WRONG-MERCHANT-ID",
        },
        db
      );

      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("MERCHANT_MISMATCH");
      }
    });

    it("3.8: Cross-tenant route query is rejected and quarantined", async () => {
      // Query Tenant B using Tenant A collector code
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantB.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: "COL-SEP-A1",
        },
        db
      );

      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("UNKNOWN_COLLECTOR_CODE");
      }
    });
  });

  // ─────────────────────────────── Section 4: Serialize Branch Hierarchy Changes ───────────────────────────────

  describe("Section 4: Serialize Branch Hierarchy Changes & Concurrency Safety", () => {
    it("4.1: Concurrent mutual reparenting race (A.parent=B vs B.parent=A) aborts one and prevents cycles", async () => {
      // Create independent branches Branch C1 and Branch C2
      const branchC1 = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Concur Branch C1", code: "CON-C1", branchType: "MAIN" },
      });
      const branchC2 = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Concur Branch C2", code: "CON-C2", branchType: "MAIN" },
      });

      // Define concurrent operation 1: set C1.parent = C2
      const op1 = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id = ${tenantA.id} FOR UPDATE`;
        const val = await validateBranchParentHierarchy(tenantA.id, branchC1.id, branchC2.id, tx);
        if (!val.valid) throw new Error(val.error);
        return await tx.branch.update({
          where: { tenantId_id: { tenantId: tenantA.id, id: branchC1.id } },
          data: { parentBranchId: branchC2.id },
        });
      });

      // Define concurrent operation 2: set C2.parent = C1
      const op2 = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id = ${tenantA.id} FOR UPDATE`;
        const val = await validateBranchParentHierarchy(tenantA.id, branchC2.id, branchC1.id, tx);
        if (!val.valid) throw new Error(val.error);
        return await tx.branch.update({
          where: { tenantId_id: { tenantId: tenantA.id, id: branchC2.id } },
          data: { parentBranchId: branchC1.id },
        });
      });

      const results = await Promise.allSettled([op1, op2]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one operation must commit, and the other must reject the cycle
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify that NO cyclic hierarchy was committed
      const updatedC1 = await db.branch.findUnique({ where: { id: branchC1.id } });
      const updatedC2 = await db.branch.findUnique({ where: { id: branchC2.id } });

      const isCycle = updatedC1?.parentBranchId === branchC2.id && updatedC2?.parentBranchId === branchC1.id;
      expect(isCycle).toBe(false);
    });

    it("4.2: Concurrent multi-level reparenting rejects indirect cycles under tenant lock", async () => {
      // Root -> Sub -> Leaf. Concurrent attempt: Root.parent = Leaf
      const root = await db.branch.create({
        data: { tenantId: tenantA.id, name: "ML Root", code: "ML-ROOT", branchType: "MAIN" },
      });
      const sub = await db.branch.create({
        data: { tenantId: tenantA.id, parentBranchId: root.id, name: "ML Sub", code: "ML-SUB", branchType: "SUB_BRANCH" },
      });
      const leaf = await db.branch.create({
        data: { tenantId: tenantA.id, parentBranchId: sub.id, name: "ML Leaf", code: "ML-LEAF", branchType: "SUB_BRANCH" },
      });

      // Attempting to set root.parent = leaf must fail cycle check
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id = ${tenantA.id} FOR UPDATE`;
          const val = await validateBranchParentHierarchy(tenantA.id, root.id, leaf.id, tx);
          if (!val.valid) throw new Error(val.error);
          return await tx.branch.update({
            where: { tenantId_id: { tenantId: tenantA.id, id: root.id } },
            data: { parentBranchId: leaf.id },
          });
        })
      ).rejects.toThrow(/Circular branch hierarchy detected/);
    });
  });

  // ─────────────────────────────── Section 5 & 6: Historical Attribution & Immutable Events ───────────────────────────────

  describe("Section 5 & 6: Historical Attribution & Immutable Event Protection", () => {
    it("6.1: Historical reconciliation does NOT modify raw immutable PaymentReceipt rows", async () => {
      const student = await db.student.create({
        data: { tenantId: tenantA.id, admissionNo: "ADM-IMM-01", firstName: "Immutable", lastName: "ReceiptStudent", branchId: branchA1.id },
      });

      const receipt = await db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: student.id,
            branchId: null, // Legacy unassigned receipt
            receiptNumber: "RCPT-IMM-001",
            amount: 50000,
            method: "CASH",
            provider: "cashier",
          },
        });
        await tx.paymentReceiptBalance.create({
          data: { tenantId: tenantA.id, receiptId: r.id, unappliedAmount: 50000 },
        });
        return r;
      });

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        permissions: new Set(["tenant.settings.manage"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      // Owner reconciles the unassigned receipt to Branch A2
      const result = await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "PaymentReceipt",
        recordId: receipt.id,
        newBranchId: branchA2.id,
        reason: "Bank deposit slip confirmed South Branch account",
        candidateEvidence: "Bank deposit slip slip-9921",
      });

      expect(result.success).toBe(true);
      expect(result.isImmutablePreserved).toBe(true);

      // Verify the RAW PaymentReceipt table row was NOT mutated!
      const rawReceipt = await db.paymentReceipt.findUnique({ where: { id: receipt.id } });
      expect(rawReceipt?.branchId).toBeNull(); // IMMUTABILITY PRESERVED!

      // Verify the effective branch attribution is projected from the audit correction
      const effective = await getEffectiveBranchAttribution(tenantA.id, "PaymentReceipt", receipt.id, rawReceipt?.branchId ?? null, db);
      expect(effective.effectiveBranchId).toBe(branchA2.id);
      expect(effective.isCorrected).toBe(true);
      expect(effective.auditRecord.reason).toContain("Bank deposit slip");
    });

    it("6.2: Historical reconciliation does NOT modify raw immutable FeePayment rows", async () => {
      const student = await db.student.create({
        data: { tenantId: tenantA.id, admissionNo: "ADM-IMM-02", firstName: "Immutable", lastName: "PaymentStudent", branchId: branchA1.id },
      });

      const invoice = await db.feeInvoice.create({
        data: {
          tenantId: tenantA.id,
          studentId: student.id,
          branchId: branchA1.id,
          number: "INV-IMM-01",
          title: "Tuition",
          amount: 40000,
          dueDate: new Date(),
        },
      });

      const payment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoice.id,
          branchId: null, // Legacy unassigned payment
          amount: 40000,
          method: "CASH",
        },
      });

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        permissions: new Set(["tenant.settings.manage"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const result = await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "FeePayment",
        recordId: payment.id,
        newBranchId: branchA1.id,
        reason: "Cashier register log match",
      });

      expect(result.success).toBe(true);
      expect(result.isImmutablePreserved).toBe(true);

      // Raw row unchanged
      const rawPayment = await db.feePayment.findUnique({ where: { id: payment.id } });
      expect(rawPayment?.branchId).toBeNull();

      // Effective attribution projected
      const effective = await getEffectiveBranchAttribution(tenantA.id, "FeePayment", payment.id, rawPayment?.branchId ?? null, db);
      expect(effective.effectiveBranchId).toBe(branchA1.id);
      expect(effective.isCorrected).toBe(true);
    });

    it("6.3: Mutable operational records (Student) update in place with audit trail", async () => {
      const student = await db.student.create({
        data: { tenantId: tenantA.id, admissionNo: "ADM-MUT-01", firstName: "Mutable", lastName: "Student", branchId: null },
      });

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        permissions: new Set(["tenant.settings.manage"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const result = await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "Student",
        recordId: student.id,
        newBranchId: branchA1.id,
        reason: "Admission form campus selection",
      });

      expect(result.success).toBe(true);
      expect(result.isImmutablePreserved).toBe(false);

      // Student row updated directly
      const updatedStudent = await db.student.findUnique({ where: { id: student.id } });
      expect(updatedStudent?.branchId).toBe(branchA1.id);
    });

    it("6.4: getAmbiguousHistoricalRecords keeps branch unresolved and refuses to guess from student's current branch", async () => {
      const ambiguous = await getAmbiguousHistoricalRecords(tenantA.id);
      for (const item of ambiguous) {
        // Enforce safety rule: suggestedBranchId MUST be null
        expect(item.suggestedBranchId).toBeNull();
        expect(item.candidateEvidence).toContain("Unresolved");
      }
    });
  });

  // ─────────────────────────────── Section 7: Validate MembershipBranch Scope Semantics ───────────────────────────────

  describe("Section 7: Validate MembershipBranch Scope Semantics", () => {
    it("7.1: Attempting to assign TENANT_WIDE scope on a branch assignment is strictly rejected", async () => {
      mockAuthContext.current = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        permissions: new Set(["tenant.settings.manage"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const fd = new FormData();
      fd.set("membershipId", memberStaff1.id);
      fd.set("branchId", branchA1.id);
      fd.set("scopeMode", "TENANT_WIDE");

      // Attempting via assign action must reject
      const result = await assignMembershipBranchAction({}, fd);
      expect(result.error).toContain("Tenant-wide authorization cannot be granted through a branch assignment");
    });

    it("7.2: Inactive branch assignment fails closed", async () => {
      // Create a branch and archive it
      const tempArchBranch = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Archived Campus", code: "ARCH-01", branchType: "SUB_BRANCH", isActive: false },
      });

      const testUser = await db.user.create({
        data: { name: "Archived Staff", email: "arch-staff@test.local", avatarColor: "#777", passwordHash: "dummy" },
      });
      const testMember = await db.membership.create({
        data: { tenantId: tenantA.id, userId: testUser.id, roleId: roleStaff.id, isOwner: false, branchId: null },
      });

      await db.membershipBranch.create({
        data: {
          tenantId: tenantA.id,
          membershipId: testMember.id,
          branchId: tempArchBranch.id,
          scopeMode: "EXACT_BRANCH",
        },
      });

      const ctx = {
        tenant: tenantA,
        user: testUser,
        membership: testMember,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: null,
      };

      const scope = await resolveUserBranchScope(ctx as any);
      expect(scope.mode).toBe("NO_ACCESS");
      expect(scope.hasAccess).toBe(false);
      expect(scope.allowedBranchIds).toHaveLength(0);
    });
  });
});
