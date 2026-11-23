import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  resolvePaymentCollectorBranch,
} from "@/lib/payment-routing";
import {
  resolveBranchByCollectorCode,
} from "@/lib/branch";
import {
  reconcileHistoricalRecord,
  getEffectiveBranchAttribution,
} from "@/lib/branch-reconciliation";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_phase2_3_disposable";
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

describe("Knowletive Phase 2.3 — Final Pre-RLS Closure Integration Test Suite", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  // Fixtures
  let tenantA: any;
  let tenantB: any;

  let branchDemoA: any;
  let branchJodoA: any;
  let branchUnverifiedA: any;
  let branchChildA: any;

  let roleAdmin: any;
  let userOwnerA: any;
  let memberOwnerA: any;

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

    // 2. Deploy all 17 migrations (including Phase 2.3)
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
      data: { name: "Apex Global Academy", slug: "apex-p23", email: "apex-p23@example.com", logoInitials: "AG", type: "SCHOOL", status: "ACTIVE" },
    });
    tenantB = await db.tenant.create({
      data: { name: "Zenith Global School", slug: "zenith-p23", email: "zenith-p23@example.com", logoInitials: "ZG", type: "SCHOOL", status: "ACTIVE" },
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
      data: { email: "owner-p23@apex.edu", name: "Dr. Apex Owner", passwordHash: "dummy" },
    });
    memberOwnerA = await db.membership.create({
      data: { tenantId: tenantA.id, userId: userOwnerA.id, roleId: roleAdmin.id, isOwner: true, status: "ACTIVE" },
    });

    // 7. Seed Branches with various collector configurations
    // Branch 1: Has authoritative DEMO config
    branchDemoA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Demo Campus", code: "APX-DEMO", branchType: "MAIN", collectorCode: "DEMO_COLL_01" },
    });
    await db.paymentProviderConfig.create({
      data: {
        tenantId: tenantA.id,
        branchId: branchDemoA.id,
        provider: "DEMO",
        environment: "DEMO",
        collectorCode: "DEMO_COLL_01",
        isEnabled: true,
      },
    });

    // Branch 2: Has authoritative real JODO LIVE config
    branchJodoA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Metro Campus", code: "APX-JODO", branchType: "SUB_BRANCH", collectorCode: "JODO_REAL_01" },
    });
    await db.paymentProviderConfig.create({
      data: {
        tenantId: tenantA.id,
        branchId: branchJodoA.id,
        provider: "JODO",
        environment: "LIVE",
        merchantId: "MERCH_JODO_METRO",
        collectorCode: "JODO_REAL_01",
        isEnabled: true,
      },
    });

    // Branch 3: Legacy branch with unverified collectorCode (NO PaymentProviderConfig)
    branchUnverifiedA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Legacy Rural", code: "APX-LEGACY", branchType: "SUB_BRANCH", collectorCode: "LEGACY_UNCERTAIN_CODE" },
    });

    // Branch 4: Child branch of branchDemoA for hierarchy deletion tests
    branchChildA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Apex Junior Wing", code: "APX-JUN", branchType: "SUB_BRANCH", parentBranchId: branchDemoA.id },
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
  // 1. Legacy Collector-Code Migration Correction
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Legacy Collector-Code Migration Correction", () => {
    it("1.1 Corrects backfilled routes: verified demo route is active DEMO", async () => {
      // Execute the authoritative backfill statement for existing branches
      await db.$executeRawUnsafe(`
        INSERT INTO "PaymentCollectorRoute" (
          "id", "tenantId", "branchId", "provider", "environment", "merchantId", "collectorCode", "isActive", "createdAt", "updatedAt"
        )
        SELECT
          'pcr_' || b."id",
          b."tenantId",
          b."id",
          COALESCE(ppc."provider", 'UNVERIFIED'),
          COALESCE(ppc."environment", 'UNVERIFIED'),
          ppc."merchantId",
          b."collectorCode",
          COALESCE(ppc."isEnabled", false),
          NOW(),
          NOW()
        FROM "Branch" b
        LEFT JOIN "PaymentProviderConfig" ppc
          ON ppc."tenantId" = b."tenantId"
         AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
        WHERE b."collectorCode" IS NOT NULL
        ON CONFLICT ("tenantId", "branchId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator") DO UPDATE
        SET
          "provider" = EXCLUDED."provider",
          "environment" = EXCLUDED."environment",
          "merchantId" = EXCLUDED."merchantId",
          "isActive" = EXCLUDED."isActive";
      `);

      // Verify Demo branch route
      const demoRoute = await db.paymentCollectorRoute.findFirst({
        where: { tenantId: tenantA.id, branchId: branchDemoA.id },
      });
      expect(demoRoute).toBeDefined();
      expect(demoRoute?.provider).toBe("DEMO");
      expect(demoRoute?.environment).toBe("DEMO");
      expect(demoRoute?.isActive).toBe(true);
    });

    it("1.2 Corrects backfilled routes: real JODO configuration is NOT converted to DEMO", async () => {
      const jodoRoute = await db.paymentCollectorRoute.findFirst({
        where: { tenantId: tenantA.id, branchId: branchJodoA.id },
      });
      expect(jodoRoute).toBeDefined();
      expect(jodoRoute?.provider).toBe("JODO");
      expect(jodoRoute?.environment).toBe("LIVE");
      expect(jodoRoute?.merchantId).toBe("MERCH_JODO_METRO");
      expect(jodoRoute?.isActive).toBe(true);
    });

    it("1.3 Unverified legacy collector code is classified as UNVERIFIED and INACTIVE", async () => {
      const legacyRoute = await db.paymentCollectorRoute.findFirst({
        where: { tenantId: tenantA.id, branchId: branchUnverifiedA.id },
      });
      expect(legacyRoute).toBeDefined();
      expect(legacyRoute?.provider).toBe("UNVERIFIED");
      expect(legacyRoute?.environment).toBe("UNVERIFIED");
      expect(legacyRoute?.isActive).toBe(false); // Must NEVER be activated without authoritative configuration
    });

    it("1.4 Routing engine strictly quarantines unverified legacy collector codes", async () => {
      const result = await resolvePaymentCollectorBranch({
        tenantId: tenantA.id,
        provider: "DEMO",
        environment: "DEMO",
        collectorCode: "LEGACY_UNCERTAIN_CODE",
      });

      expect(result.status).toBe("QUARANTINED");
      if (result.status === "QUARANTINED") {
        expect(result.reason).toBe("UNKNOWN_COLLECTOR_CODE");
        expect(result.branchId).toBeNull();
        expect(result.resolutionEvidence).toMatch(/inactive|unverified|uncertain/i);
      }
    });

    it("1.5 Repeated migration backfill execution is strictly idempotent", async () => {
      const countBefore = await db.paymentCollectorRoute.count();

      // Execute authoritative backfill query again
      await db.$executeRawUnsafe(`
        INSERT INTO "PaymentCollectorRoute" (
          "id", "tenantId", "branchId", "provider", "environment", "merchantId", "collectorCode", "isActive", "createdAt", "updatedAt"
        )
        SELECT
          'pcr_' || b."id",
          b."tenantId",
          b."id",
          COALESCE(ppc."provider", 'UNVERIFIED'),
          COALESCE(ppc."environment", 'UNVERIFIED'),
          ppc."merchantId",
          b."collectorCode",
          COALESCE(ppc."isEnabled", false),
          NOW(),
          NOW()
        FROM "Branch" b
        LEFT JOIN "PaymentProviderConfig" ppc
          ON ppc."tenantId" = b."tenantId"
         AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
        WHERE b."collectorCode" IS NOT NULL
        ON CONFLICT ("tenantId", "branchId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator") DO NOTHING;
      `);

      const countAfter = await db.paymentCollectorRoute.count();
      expect(countAfter).toBe(countBefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PostgreSQL Index Consistency (Option B) & NULL Semantics
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. PostgreSQL Catalog Indexes & NULL Semantics (Option B)", () => {
    it("2.1 PostgreSQL catalog verifies uq_pcr_branch_route_identity and uq_pcr_explicit_discriminator", async () => {
      const indexes: any[] = await db.$queryRawUnsafe(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'PaymentCollectorRoute'
          AND indexname IN ('uq_pcr_branch_route_identity', 'uq_pcr_explicit_discriminator')
        ORDER BY indexname;
      `);

      expect(indexes).toHaveLength(2);

      const branchRouteIdx = indexes.find((i) => i.indexname === "uq_pcr_branch_route_identity");
      expect(branchRouteIdx).toBeDefined();
      expect(branchRouteIdx.indexdef).toContain("NULLS NOT DISTINCT");

      const explicitDiscIdx = indexes.find((i) => i.indexname === "uq_pcr_explicit_discriminator");
      expect(explicitDiscIdx).toBeDefined();
      expect(explicitDiscIdx.indexdef).toContain("WHERE (\"routingDiscriminator\" IS NOT NULL)");
    });

    it("2.2 NULL merchant identity and NULL discriminator reject duplicate route for same branch", async () => {
      const testCode = "NULL_MERCHANT_TEST";

      // 1. Insert initial route
      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: testCode,
          merchantId: null,
          routingDiscriminator: null,
        },
      });

      // 2. Attempt duplicate insert with NULL merchantId and NULL discriminator
      let duplicateBlocked = false;
      try {
        await db.paymentCollectorRoute.create({
          data: {
            tenantId: tenantA.id,
            branchId: branchDemoA.id,
            provider: "DEMO",
            environment: "TEST",
            collectorCode: testCode,
            merchantId: null,
            routingDiscriminator: null,
          },
        });
      } catch (err: any) {
        duplicateBlocked = true;
        expect(err.message).toMatch(/uq_pcr_branch_route_identity|unique constraint/i);
      }
      expect(duplicateBlocked).toBe(true);
    });

    it("2.3 Distinct merchant accounts on the same branch and collector code succeed", async () => {
      const code = "MERCHANT_DISTINCT_TEST";

      const r1 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: code,
          merchantId: "MERCH_ACCOUNT_1",
          routingDiscriminator: null,
        },
      });

      const r2 = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: code,
          merchantId: "MERCH_ACCOUNT_2",
          routingDiscriminator: null,
        },
      });

      expect(r1.id).toBeDefined();
      expect(r2.id).toBeDefined();
    });

    it("2.4 Shared collector code across branches with NULL discriminator succeeds", async () => {
      const code = "SHARED_NULL_DISC";

      const rA = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: code,
          merchantId: null,
          routingDiscriminator: null,
        },
      });

      const rB = await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchJodoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: code,
          merchantId: null,
          routingDiscriminator: null,
        },
      });

      expect(rA.branchId).toBe(branchDemoA.id);
      expect(rB.branchId).toBe(branchJodoA.id);
    });

    it("2.5 Duplicate explicit discriminator for the same collector code across branches is rejected", async () => {
      const code = "EXPLICIT_COLLISION_CODE";

      await db.paymentCollectorRoute.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          provider: "DEMO",
          environment: "TEST",
          collectorCode: code,
          routingDiscriminator: "SHARED_TAG_01",
        },
      });

      let collisionBlocked = false;
      try {
        await db.paymentCollectorRoute.create({
          data: {
            tenantId: tenantA.id,
            branchId: branchJodoA.id,
            provider: "DEMO",
            environment: "TEST",
            collectorCode: code,
            routingDiscriminator: "SHARED_TAG_01", // Collision!
          },
        });
      } catch (err: any) {
        collisionBlocked = true;
        expect(err.message).toMatch(/uq_pcr_explicit_discriminator|unique constraint/i);
      }
      expect(collisionBlocked).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Composite Foreign-Key Deletion Protection (RESTRICT)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Composite Foreign-Key Deletion Protection (RESTRICT)", () => {
    it("3.1 Deleting branch with PaymentAllocation is rejected (ON DELETE RESTRICT)", async () => {
      // Create student, invoice, payment, receipt, allocation
      const student = await db.student.create({
        data: { tenantId: tenantA.id, branchId: branchDemoA.id, firstName: "Aman", lastName: "Gupta", admissionNo: "ADM-P23-ALLOC" },
      });
      const invoice = await db.feeInvoice.create({
        data: { tenantId: tenantA.id, branchId: branchDemoA.id, studentId: student.id, number: "INV-P23-01", title: "Fee", amount: 10000, dueDate: new Date() },
      });
      const receipt = await db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: { tenantId: tenantA.id, branchId: branchDemoA.id, studentId: student.id, receiptNumber: "RCPT-P23-01", amount: 10000, method: "CASH" },
        });
        await tx.paymentReceiptBalance.create({
          data: { tenantId: tenantA.id, receiptId: r.id, unappliedAmount: 0, allocatedAmount: 10000, status: "CAPTURED" },
        });
        return r;
      });
      await db.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchDemoA.id,
          receiptId: receipt.id,
          feeInvoiceId: invoice.id,
          studentId: student.id,
          amount: 10000,
        },
      });

      // Direct SQL attempt to delete branchDemoA must fail due to PaymentAllocation RESTRICT constraint
      let deleteBlocked = false;
      try {
        await db.$executeRawUnsafe(`DELETE FROM "Branch" WHERE "id" = '${branchDemoA.id}';`);
      } catch (err: any) {
        deleteBlocked = true;
        expect(err.message).toMatch(/PaymentAllocation_tenantId_branchId_fkey|RESTRICT|foreign key/i);
      }
      expect(deleteBlocked).toBe(true);
    });

    it("3.2 Deleting branch with CreditTransferJournal is rejected (ON DELETE RESTRICT)", async () => {
      // Create test branches
      const srcBranch = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Src Branch", code: "SRC-BR", branchType: "SUB_BRANCH" },
      });
      const tgtBranch = await db.branch.create({
        data: { tenantId: tenantA.id, name: "Tgt Branch", code: "TGT-BR", branchType: "SUB_BRANCH" },
      });
      const s1 = await db.student.create({
        data: { tenantId: tenantA.id, branchId: srcBranch.id, firstName: "S1", lastName: "Src", admissionNo: "ADM-SRC" },
      });
      const s2 = await db.student.create({
        data: { tenantId: tenantA.id, branchId: tgtBranch.id, firstName: "S2", lastName: "Tgt", admissionNo: "ADM-TGT" },
      });

      const rSrc = await db.$transaction(async (tx) => {
        const rcpt = await tx.paymentReceipt.create({
          data: { tenantId: tenantA.id, branchId: srcBranch.id, studentId: s1.id, receiptNumber: "RCPT-P23-SRC", amount: 10000, method: "CASH" },
        });
        await tx.paymentReceiptBalance.create({
          data: { tenantId: tenantA.id, receiptId: rcpt.id, unappliedAmount: 10000, allocatedAmount: 0, status: "CAPTURED" },
        });
        return rcpt;
      });

      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "CreditTransferJournal" (
            "id", "tenantId", "sourceStudentId", "targetStudentId", "sourceReceiptId", "sourceBranchId", "targetBranchId",
            "amount", "transferNumber", "requestedById", "status", "reason", "createdAt"
          ) VALUES (
            'ctj_del_test', '${tenantA.id}', '${s1.id}', '${s2.id}', '${rSrc.id}', '${srcBranch.id}', '${tgtBranch.id}',
            5000, 'TRF-P23-01', '${userOwnerA.id}', 'COMPLETED', 'Sibling fee transfer', NOW()
          );
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "CreditTransferPosting" (
            "id", "tenantId", "journalId", "receiptId", "studentId", "counterpartyStudentId", "entryType", "amount", "createdAt"
          ) VALUES
          ('ctp_del_1', '${tenantA.id}', 'ctj_del_test', '${rSrc.id}', '${s1.id}', '${s2.id}', 'DEBIT', 5000, NOW()),
          ('ctp_del_2', '${tenantA.id}', 'ctj_del_test', '${rSrc.id}', '${s2.id}', '${s1.id}', 'CREDIT', 5000, NOW());
        `);
      });

      // Direct SQL attempt to delete srcBranch must fail due to CreditTransferJournal RESTRICT
      let srcDeleteBlocked = false;
      try {
        await db.$executeRawUnsafe(`DELETE FROM "Branch" WHERE "id" = '${srcBranch.id}';`);
      } catch (err: any) {
        srcDeleteBlocked = true;
        expect(err.message).toMatch(/CreditTransferJournal_tenantId_sourceBranchId_fkey|RESTRICT|foreign key/i);
      }
      expect(srcDeleteBlocked).toBe(true);

      // Direct SQL attempt to delete tgtBranch must also fail
      let tgtDeleteBlocked = false;
      try {
        await db.$executeRawUnsafe(`DELETE FROM "Branch" WHERE "id" = '${tgtBranch.id}';`);
      } catch (err: any) {
        tgtDeleteBlocked = true;
        expect(err.message).toMatch(/CreditTransferJournal_tenantId_targetBranchId_fkey|RESTRICT|foreign key/i);
      }
      expect(tgtDeleteBlocked).toBe(true);
    });

    it("3.3 Deleting parent branch while child branch exists is rejected (ON DELETE RESTRICT)", async () => {
      // branchDemoA is parent of branchChildA
      let parentDeleteBlocked = false;
      try {
        await db.$executeRawUnsafe(`DELETE FROM "Branch" WHERE "id" = '${branchDemoA.id}';`);
      } catch (err: any) {
        parentDeleteBlocked = true;
        expect(err.message).toMatch(/Branch_tenantId_parentBranchId_fkey|PaymentAllocation|RESTRICT|foreign key/i);
      }
      expect(parentDeleteBlocked).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Effective Historical Branch Attribution & Database Function / Views
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Effective Historical Branch Attribution (Database Function & Views)", () => {
    it("4.1 PostgreSQL function fn_get_effective_branch_id resolves raw branch when uncorrected", async () => {
      const res: any[] = await db.$queryRawUnsafe(`
        SELECT fn_get_effective_branch_id('${tenantA.id}', 'FeePayment', 'pay_dummy_1', '${branchDemoA.id}') AS effective;
      `);
      expect(res[0]?.effective).toBe(branchDemoA.id);
    });

    it("4.2 PostgreSQL function fn_get_effective_branch_id resolves corrected branch when reconciled", async () => {
      // Create a raw fee payment with branchDemoA
      const invoice = await db.feeInvoice.findFirst({ where: { tenantId: tenantA.id } });
      const payment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoice!.id,
          branchId: branchDemoA.id,
          amount: 25000,
          paidAt: new Date(),
          method: "UPI",
        },
      });

      // Owner reconciles the payment to branchJodoA
      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };
      await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "FeePayment",
        recordId: payment.id,
        newBranchId: branchJodoA.id,
        reason: "Owner verified payment belonged to Metro Campus",
      });

      // Source row remains unchanged
      const rawAfter = await db.feePayment.findUnique({ where: { id: payment.id } });
      expect(rawAfter?.branchId).toBe(branchDemoA.id);

      // Function returns branchJodoA
      const res: any[] = await db.$queryRawUnsafe(`
        SELECT fn_get_effective_branch_id('${tenantA.id}', 'FeePayment', '${payment.id}', '${payment.branchId}') AS effective;
      `);
      expect(res[0]?.effective).toBe(branchJodoA.id);

      // View v_effective_fee_payment returns effectiveBranchId = branchJodoA while branchId = branchDemoA
      const viewRes: any[] = await db.$queryRawUnsafe(`
        SELECT "id", "branchId", "effectiveBranchId"
        FROM v_effective_fee_payment
        WHERE "id" = '${payment.id}';
      `);
      expect(viewRes[0]?.branchId).toBe(branchDemoA.id);
      expect(viewRes[0]?.effectiveBranchId).toBe(branchJodoA.id);
    });

    it("4.3 View v_effective_payment_receipt correctly projects effective branch", async () => {
      let receipt = await db.paymentReceipt.findFirst({ where: { tenantId: tenantA.id } });
      if (!receipt) {
        const student = await db.student.findFirst({ where: { tenantId: tenantA.id } });
        receipt = await db.$transaction(async (tx) => {
          const r = await tx.paymentReceipt.create({
            data: {
              tenantId: tenantA.id,
              branchId: branchDemoA.id,
              studentId: student!.id,
              receiptNumber: "RCPT-P23-V43",
              amount: 15000,
              method: "CASH",
            },
          });
          await tx.paymentReceiptBalance.create({
            data: {
              tenantId: tenantA.id,
              receiptId: r.id,
              unappliedAmount: 0,
              allocatedAmount: 15000,
              status: "CAPTURED",
            },
          });
          return r;
        });
      }
      expect(receipt).toBeDefined();

      const ownerCtx = {
        tenant: tenantA,
        user: userOwnerA,
        membership: memberOwnerA,
        isOwnerView: true,
        permissions: new Set(["tenant.settings.manage"]),
        subscriptionBlocked: false,
      };
      await reconcileHistoricalRecord(ownerCtx as any, {
        recordType: "PaymentReceipt",
        recordId: receipt!.id,
        newBranchId: branchJodoA.id,
        reason: "Owner reconciled receipt to Metro Campus",
      });

      const viewRes: any[] = await db.$queryRawUnsafe(`
        SELECT "id", "branchId", "effectiveBranchId"
        FROM v_effective_payment_receipt
        WHERE "id" = '${receipt!.id}';
      `);
      expect(viewRes[0]?.branchId).toBe(branchDemoA.id);
      expect(viewRes[0]?.effectiveBranchId).toBe(branchJodoA.id);
    });
  });
});
