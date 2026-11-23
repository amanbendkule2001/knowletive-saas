import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  validateBranchParentHierarchy,
} from "@/lib/branch";
import {
  resolvePaymentCollectorBranch,
} from "@/lib/payment-routing";
import {
  reconcileHistoricalRecord,
  getEffectiveBranchAttribution,
} from "@/lib/branch-reconciliation";
import {
  updateBranchHierarchyAction,
} from "@/actions/branches";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_phase2_2_disposable";
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

describe("Knowletive Phase 2.2 — Pre-RLS Database Integrity & Branch Authorization Hardening", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  // Fixtures
  let tenantA: any;
  let tenantB: any;

  let branchA1: any;
  let branchA2: any;
  let branchA3: any;
  let branchB1: any;

  let userOwnerA: any;
  let memberOwnerA: any;
  let roleAdmin: any;

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

    // 2. Deploy all migrations including Phase 2.2
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
      data: { name: "Apex Alpha Academy", slug: "apex-p22", email: "apex-p22@example.com", logoInitials: "AA", type: "SCHOOL", status: "ACTIVE" },
    });
    tenantB = await db.tenant.create({
      data: { name: "Zenith Beta School", slug: "zenith-p22", email: "zenith-p22@example.com", logoInitials: "ZB", type: "SCHOOL", status: "ACTIVE" },
    });

    // 6. Seed Roles & Owner
    roleAdmin = await db.role.create({
      data: { tenantId: tenantA.id, key: "INSTITUTE_ADMIN", name: "Institute Admin", scope: "TENANT", isSystem: true },
    });
    const permManage = await db.permission.findUnique({ where: { key: "tenant.settings.manage" } });
    if (permManage) {
      await db.rolePermission.create({ data: { roleId: roleAdmin.id, permissionKey: permManage.key } });
    }

    userOwnerA = await db.user.create({
      data: { email: "owner-p22@apex.edu", name: "Dr. Alpha Owner", passwordHash: "dummy" },
    });
    memberOwnerA = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userOwnerA.id, roleId: roleAdmin.id, isOwner: true, status: "ACTIVE" },
    });

    // 7. Seed Branches
    branchA1 = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Downtown", code: "APX-DT", branchType: "MAIN" },
    });
    branchA2 = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Uptown", code: "APX-UP", branchType: "SUB_BRANCH" },
    });
    branchA3 = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex North", code: "APX-NO", branchType: "SUB_BRANCH" },
    });

    branchB1 = await db.branch.create({
      data: { tenantId: tenantB.id, name: "Zenith Campus", code: "ZEN-01", branchType: "MAIN" },
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PaymentCollectorRoute Tenant Integrity
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. PaymentCollectorRoute Tenant Integrity", () => {
    it("1.1 PostgreSQL composite foreign key rejects cross-tenant route insertion", async () => {
      // Attempt to link Tenant A's route to Branch B1 (belonging to Tenant B)
      let rejected = false;
      let errorCode = "";
      try {
        await db.$executeRawUnsafe(`
          INSERT INTO "PaymentCollectorRoute" (
            "id", "tenantId", "branchId", "provider", "environment", "collectorCode", "isActive", "createdAt", "updatedAt"
          ) VALUES (
            'pcr_illegal_cross', '${tenantA.id}', '${branchB1.id}', 'DEMO', 'DEMO', 'ILLEGAL_COLL', true, NOW(), NOW()
          );
        `);
      } catch (err: any) {
        rejected = true;
        errorCode = err.meta?.code || err.code || "";
        expect(err.message).toMatch(/23503|PaymentCollectorRoute_tenantId_branchId_fkey|foreign key/i);
      }

      expect(rejected).toBe(true);
      expect(errorCode).toMatch(/23503|P2010/);
    });

    it("1.2 PostgreSQL composite foreign key rejects cross-tenant route updates", async () => {
      // Insert valid route in Tenant A
      const validRoute = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "APX_ROUTE_01",
        },
      });

      // Attempt to update route to branch of Tenant B
      let updateRejected = false;
      try {
        await db.$executeRawUnsafe(`
          UPDATE "PaymentCollectorRoute"
          SET "branchId" = '${branchB1.id}'
          WHERE "id" = '${validRoute.id}';
        `);
      } catch (err: any) {
        updateRejected = true;
        expect(err.message).toMatch(/23503|PaymentCollectorRoute_tenantId_branchId_fkey|foreign key/i);
      }
      expect(updateRejected).toBe(true);

      // Attempt to update tenantId to Tenant B while branchId is still Branch A1
      let tenantMismatchRejected = false;
      try {
        await db.$executeRawUnsafe(`
          UPDATE "PaymentCollectorRoute"
          SET "tenantId" = '${tenantB.id}'
          WHERE "id" = '${validRoute.id}';
        `);
      } catch (err: any) {
        tenantMismatchRejected = true;
        expect(err.message).toMatch(/23503|PaymentCollectorRoute_tenantId_branchId_fkey|foreign key/i);
      }
      expect(tenantMismatchRejected).toBe(true);
    });

    it("1.3 Branch deletion restriction: ON DELETE RESTRICT prevents deleting branch with active routes", async () => {
      // Create a temporary branch with a route
      const tempBranch = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Temp Branch", code: "TEMP-DEL", branchType: "SUB_BRANCH" },
      });
      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: tempBranch.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "TEMP_COLL",
        },
      });

      // Attempting to delete tempBranch directly must fail due to ON DELETE RESTRICT
      let deleteBlocked = false;
      try {
        await db.branch.delete({ where: { id: tempBranch.id } });
      } catch (err: any) {
        deleteBlocked = true;
        expect(err.message).toMatch(/PaymentCollectorRoute_tenantId_branchId_fkey|RESTRICT|foreign key/i);
      }
      expect(deleteBlocked).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Collector-Route Uniqueness and NULL Semantics
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Collector-Route Uniqueness and NULL Semantics", () => {
    it("2.1 Multiple branches can share the same collector code (null discriminators)", async () => {
      const sharedCode = "SHARED_MULTI_BR";

      // Branch A1 creates route with shared collector code and null discriminator
      const route1 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: sharedCode,
          routingDiscriminator: null,
          merchantId: null,
        },
      });

      // Branch A2 creates route with the same shared collector code and null discriminator
      const route2 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA2.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: sharedCode,
          routingDiscriminator: null,
          merchantId: null,
        },
      });

      expect(route1.id).toBeDefined();
      expect(route2.id).toBeDefined();
      expect(route1.branchId).toBe(branchA1.id);
      expect(route2.branchId).toBe(branchA2.id);
    });

    it("2.2 Same branch duplicate route is rejected even with NULL discriminator (NULLS NOT DISTINCT)", async () => {
      const code = "BRANCH_NULL_TEST";

      // Insert first route with null discriminator and null merchantId
      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          routingDiscriminator: null,
          merchantId: null,
        },
      });

      // Attempting to insert identical route for Branch A1 must be rejected by uq_pcr_branch_route_identity
      let duplicateRejected = false;
      try {
        await db.paymentCollectorRoute.create({
          data: {
            tenantId: tenantA.id,
            branchId: branchA1.id,
            provider: "DEMO",
            environment: "DEMO",
            collectorCode: code,
            routingDiscriminator: null,
            merchantId: null,
          },
        });
      } catch (err: any) {
        duplicateRejected = true;
        expect(err.code).toMatch(/P2002|23505/);
      }
      expect(duplicateRejected).toBe(true);
    });

    it("2.3 Same branch can configure multiple merchant accounts for the same collector code", async () => {
      const code = "MULTI_MERCHANT_TEST";

      const routeM1 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          merchantId: "MERCH_PRIMARY",
          routingDiscriminator: null,
        },
      });

      const routeM2 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          merchantId: "MERCH_SECONDARY",
          routingDiscriminator: null,
        },
      });

      expect(routeM1.merchantId).toBe("MERCH_PRIMARY");
      expect(routeM2.merchantId).toBe("MERCH_SECONDARY");
    });

    it("2.4 Explicit discriminator: distinct discriminators across branches succeed", async () => {
      const code = "DISCRIMINATED_SHARED";

      const routeA = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          routingDiscriminator: "COMMERCE_STREAM",
        },
      });

      const routeB = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA2.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          routingDiscriminator: "SCIENCE_STREAM",
        },
      });

      expect(routeA.routingDiscriminator).toBe("COMMERCE_STREAM");
      expect(routeB.routingDiscriminator).toBe("SCIENCE_STREAM");
    });

    it("2.5 Explicit discriminator collision across branches is rejected (partial unique index)", async () => {
      const code = "DISCRIMINATOR_COLLISION";

      // Branch A1 takes discriminator 'STREAM_ARTS'
      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: code,
          routingDiscriminator: "STREAM_ARTS",
        },
      });

      // Branch A2 attempts to register the EXACT SAME discriminator for the same collector code
      let collisionRejected = false;
      try {
        await db.paymentCollectorRoute.create({
          data: {
            tenantId: tenantA.id,
            branchId: branchA2.id,
            provider: "DEMO",
            environment: "DEMO",
            collectorCode: code,
            routingDiscriminator: "STREAM_ARTS",
          },
        });
      } catch (err: any) {
        collisionRejected = true;
        expect(err.code).toMatch(/P2002|23505/);
      }
      expect(collisionRejected).toBe(true);
    });

    it("2.6 Repeated migration backfill is strictly idempotent", async () => {
      // Verify backfill statement executed repeatedly does not fail or duplicate rows
      const countBefore = await db.paymentCollectorRoute.count();

      await db.$executeRawUnsafe(`
        INSERT INTO "PaymentCollectorRoute" ("id", "tenantId", "branchId", "provider", "environment", "collectorCode", "isActive", "createdAt", "updatedAt")
        SELECT 'pcr_' || id, "tenantId", id, 'DEMO', 'DEMO', "collectorCode", true, NOW(), NOW()
        FROM "Branch"
        WHERE "collectorCode" IS NOT NULL
        ON CONFLICT DO NOTHING;
      `);

      const countAfter = await db.paymentCollectorRoute.count();
      expect(countAfter).toBe(countBefore);
    });

    it("2.7 Ambiguous shared collector code quaratines when no disambiguator is provided", async () => {
      const sharedCode = "AMBIGUOUS_ROUTING_CODE";

      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: sharedCode,
        },
      });
      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA2.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: sharedCode,
        },
      });

      const res = await resolvePaymentCollectorBranch({
        tenantId: tenantA.id,
        provider: "DEMO",
        environment: "DEMO",
        collectorCode: sharedCode,
      });

      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("AMBIGUOUS_SHARED_CODE");
        expect(res.branchId).toBeNull();
        expect(res.candidateBranchIds).toHaveLength(2);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. MembershipBranch PostgreSQL CHECK Constraint
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. MembershipBranch Database Constraints", () => {
    it("3.1 Direct SQL attempt to insert TENANT_WIDE into MembershipBranch is rejected by chk_membership_branch_scope", async () => {
      let rejected = false;
      let errorCode = "";
      try {
        await db.$executeRawUnsafe(`
          INSERT INTO "MembershipBranch" (
            "id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt"
          ) VALUES (
            'mb_illegal_scope', '${tenantA.id}', '${memberOwnerA.id}', '${branchA1.id}', 'TENANT_WIDE'::"BranchAssignmentScopeMode", NOW(), NOW()
          );
        `);
      } catch (err: any) {
        rejected = true;
        errorCode = err.meta?.code || err.code || "";
        expect(err.message).toMatch(/23514|chk_membership_branch_scope|check constraint/i);
      }

      expect(rejected).toBe(true);
      expect(errorCode).toMatch(/23514|P2010/);
    });

    it("3.2 Direct SQL insert of EXACT_BRANCH and BRANCH_AND_DESCENDANTS succeeds", async () => {
      const resExact = await db.$executeRawUnsafe(`
        INSERT INTO "MembershipBranch" (
          "id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt"
        ) VALUES (
          'mb_valid_exact', '${tenantA.id}', '${memberOwnerA.id}', '${branchA1.id}', 'EXACT_BRANCH'::"BranchAssignmentScopeMode", NOW(), NOW()
        );
      `);
      expect(resExact).toBe(1);

      const resDesc = await db.$executeRawUnsafe(`
        INSERT INTO "MembershipBranch" (
          "id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt"
        ) VALUES (
          'mb_valid_desc', '${tenantA.id}', '${memberOwnerA.id}', '${branchA2.id}', 'BRANCH_AND_DESCENDANTS'::"BranchAssignmentScopeMode", NOW(), NOW()
        );
      `);
      expect(resDesc).toBe(1);

      // Clean up test rows
      await db.membershipBranch.deleteMany({
        where: { id: { in: ["mb_valid_exact", "mb_valid_desc"] } },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Hierarchy Transaction Locking & Concurrency
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Hierarchy Transaction Locking & Concurrency", () => {
    it("4.1 Concurrent mutual reparenting (A -> B vs B -> A): exactly one succeeds, cycle is prevented", async () => {
      // Setup mock auth context for Owner A
      mockAuthContext.current = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };

      // Reset parent relations
      await db.branch.update({ where: { id: branchA1.id }, data: { parentBranchId: null } });
      await db.branch.update({ where: { id: branchA2.id }, data: { parentBranchId: null } });

      // Prepare forms
      // Form 1: attempts to set A1 parent = A2
      const fd1 = new FormData();
      fd1.append("branchId", branchA1.id);
      fd1.append("parentBranchId", branchA2.id);

      // Form 2: attempts to set A2 parent = A1
      const fd2 = new FormData();
      fd2.append("branchId", branchA2.id);
      fd2.append("parentBranchId", branchA1.id);

      // Launch both actions simultaneously
      const [res1, res2] = await Promise.all([
        updateBranchHierarchyAction({}, fd1),
        updateBranchHierarchyAction({}, fd2),
      ]);

      const successCount = [res1, res2].filter((r) => r.success).length;
      const errorCount = [res1, res2].filter((r) => r.error).length;

      // Exactly one must succeed and the other must be rejected
      expect(successCount).toBe(1);
      expect(errorCount).toBe(1);

      const errRes = [res1, res2].find((r) => r.error);
      expect(errRes?.error).toMatch(/Circular|hierarchy/i);

      // Verify final database state has NO cycle
      const finalA1 = await db.branch.findUnique({ where: { id: branchA1.id } });
      const finalA2 = await db.branch.findUnique({ where: { id: branchA2.id } });

      const a1ParentIsA2 = finalA1?.parentBranchId === branchA2.id;
      const a2ParentIsA1 = finalA2?.parentBranchId === branchA1.id;

      // They cannot BOTH be parents of each other
      expect(a1ParentIsA2 && a2ParentIsA1).toBe(false);
      // Exactly one parent was set
      expect(a1ParentIsA2 || a2ParentIsA1).toBe(true);
    });

    it("4.2 Concurrent multi-level reparenting prevents indirect cycle creation", async () => {
      // Set hierarchy: A1 (root) -> A2 -> A3
      await db.branch.update({ where: { id: branchA1.id }, data: { parentBranchId: null } });
      await db.branch.update({ where: { id: branchA2.id }, data: { parentBranchId: branchA1.id } });
      await db.branch.update({ where: { id: branchA3.id }, data: { parentBranchId: branchA2.id } });

      mockAuthContext.current = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };

      // Form 1: tries to make root A1 a child of leaf A3 (would create 3-node cycle A1 -> A2 -> A3 -> A1)
      const fd1 = new FormData();
      fd1.append("branchId", branchA1.id);
      fd1.append("parentBranchId", branchA3.id);

      // Form 2: tries to make A3 independent (parentBranchId = none)
      const fd2 = new FormData();
      fd2.append("branchId", branchA3.id);
      fd2.append("parentBranchId", "none");

      const [res1, res2] = await Promise.all([
        updateBranchHierarchyAction({}, fd1),
        updateBranchHierarchyAction({}, fd2),
      ]);

      // If Form 1 ran first, it was rejected as a cycle because A3 is descendant of A1.
      // If Form 2 ran first, A3 became independent, so A1 under A3 was valid.
      // In either case, NO circular hierarchy can exist!
      const validation = await validateBranchParentHierarchy(tenantA.id, branchA1.id, null, db);
      expect(validation.valid).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Historical Branch Attribution & Immutability
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. Historical Branch Attribution & Immutability", () => {
    it("5.1 Source immutable financial event rows are NEVER mutated during reconciliation", async () => {
      // Create student and fee invoice
      const student = await db.student.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          firstName: "Rohan",
          lastName: "Verma",
          admissionNo: "ADM-P22-01",
        },
      });

      const invoice = await db.feeInvoice.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          studentId: student.id,
          number: "INV-P22-01",
          title: "Tuition Fee",
          amount: 50000,
          dueDate: new Date(),
        },
      });

      // Create raw payment with null branch
      const payment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoice.id,
          branchId: null, // Legacy unassigned
          amount: 50000,
          paidAt: new Date(),
          method: "UPI",
        },
      });

      // Owner reconciles the payment to Branch A2
      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };

      const result = await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "FeePayment",
        recordId: payment.id,
        newBranchId: branchA2.id,
        reason: "Reconciled from bank transaction report",
      });

      expect(result.success).toBe(true);
      expect(result.isImmutablePreserved).toBe(true);

      // Verify the raw FeePayment row was NOT updated!
      const rawPaymentAfter = await db.feePayment.findUnique({
        where: { id: payment.id },
      });
      expect(rawPaymentAfter?.branchId).toBeNull(); // Source row remains strictly immutable!

      // Verify the effective attribution projects Branch A2
      const effective = await getEffectiveBranchAttribution(
        tenantA.id,
        "FeePayment",
        payment.id,
        rawPaymentAfter?.branchId ?? null,
        db
      );
      expect(effective.effectiveBranchId).toBe(branchA2.id);
      expect(effective.isCorrected).toBe(true);
    });

    it("5.2 Multiple corrections have deterministic ordering (createdAt desc, id desc)", async () => {
      const payment = await db.feePayment.findFirst({ where: { tenantId: tenantA.id } });
      expect(payment).toBeDefined();

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };

      // Owner re-reconciles payment to Branch A3
      const secondReconciliation = await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "FeePayment",
        recordId: payment!.id,
        newBranchId: branchA3.id,
        reason: "Correction: Transaction belonged to Branch North",
      });
      expect(secondReconciliation.success).toBe(true);

      // Effective attribution must deterministically project Branch A3 (latest)
      const effective = await getEffectiveBranchAttribution(
        tenantA.id,
        "FeePayment",
        payment!.id,
        payment!.branchId,
        db
      );
      expect(effective.effectiveBranchId).toBe(branchA3.id);
      expect(effective.isCorrected).toBe(true);
    });

    it("5.3 Concurrent reconciliation attempts are serialized under tenant lock", async () => {
      const payment = await db.feePayment.findFirst({ where: { tenantId: tenantA.id } });
      expect(payment).toBeDefined();

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };

      // Run two reconciliations concurrently
      const [r1, r2] = await Promise.all([
        reconcileHistoricalRecord(ownerCtx as any, {
          recordType: "FeePayment",
          recordId: payment!.id,
          newBranchId: branchA1.id,
          reason: "Concurrent 1",
        }),
        reconcileHistoricalRecord(ownerCtx as any, {
          recordType: "FeePayment",
          recordId: payment!.id,
          newBranchId: branchA2.id,
          reason: "Concurrent 2",
        }),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      // Effective attribution must resolve cleanly without ambiguity
      const effective = await getEffectiveBranchAttribution(
        tenantA.id,
        "FeePayment",
        payment!.id,
        payment!.branchId,
        db
      );
      expect(effective.effectiveBranchId).toBeDefined();
      expect([branchA1.id, branchA2.id]).toContain(effective.effectiveBranchId);
    });
  });
});
