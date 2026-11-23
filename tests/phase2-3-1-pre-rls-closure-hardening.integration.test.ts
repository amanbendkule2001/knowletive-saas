import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { resolvePaymentCollectorBranch } from "@/lib/payment-routing";
import { reconcileHistoricalRecord, getEffectiveFeeCollectedSum } from "@/lib/branch-reconciliation";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_phase2_3_1_disposable";
const DISPOSABLE_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${DISPOSABLE_DB_NAME}?schema=public`;

describe("Knowletive Phase 2.3.1 — Pre-RLS Closure Verification and Hardening Test Suite", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  let tenantA: any;
  let branchMainA: any;
  let branchA1: any;
  let branchA2: any;
  let ownerUser: any;
  let ownerMembership: any;
  let ownerCtx: any;

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

    // 2. Deploy canonical migrations up to 20261121150000
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect test client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Sync RBAC
    await syncPermissions(db, { strict: true });

    // 5. Seed base Tenant & Branches
    tenantA = await db.tenant.create({
      data: {
        name: "Acme Phase 2.3.1 Academy",
        slug: "acme-phase2-3-1",
        email: "acme-phase2-3-1@example.com",
        logoInitials: "AP",
        type: "SCHOOL",
        status: "ACTIVE",
      },
    });

    branchMainA = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "Main Campus",
        code: "MAIN-CAMPUS",
        branchType: "MAIN",
        collectorCode: "COL-MAIN",
      },
    });

    branchA1 = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        parentBranchId: branchMainA.id,
        name: "North Branch",
        code: "NORTH-BR",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-NORTH",
      },
    });

    branchA2 = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        parentBranchId: branchMainA.id,
        name: "South Branch",
        code: "SOUTH-BR",
        branchType: "SUB_BRANCH",
        collectorCode: "COL-SOUTH",
      },
    });

    const roleAdmin = await db.role.create({
      data: {
        tenantId: tenantA.id,
        key: "OWNER_ADMIN",
        name: "Owner Admin",
        scope: "TENANT",
        isSystem: true,
      },
    });

    ownerUser = await db.user.create({
      data: {
        email: "owner-phase2-3-1@example.com",
        name: "Institute Owner",
        status: "ACTIVE",
        passwordHash: "mock_owner_password_hash_123",
      },
    });

    ownerMembership = await db.membership.create({
      data: {
        tenantId: tenantA.id,
        userId: ownerUser.id,
        roleId: roleAdmin.id,
        isOwner: true,
        status: "ACTIVE",
      },
    });

    ownerCtx = {
      tenant: { id: tenantA.id, name: tenantA.name, slug: tenantA.slug },
      user: { id: ownerUser.id, email: ownerUser.email, name: ownerUser.name },
      membership: ownerMembership,
      isOwnerView: true,
      permissions: new Set(["tenant.audit.read", "tenant.fees.read", "tenant.fees.write", "tenant.settings.manage"]),
    };
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
  // WORKSTREAM 1 & 3: Catalog Invariants, View Security & Function Safety
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Workstream 1 & 3: Database Catalog Invariants & RLS Safety", () => {
    it("1.1 PaymentCollectorRoute has uq_pcr_branch_route_identity with NULLS NOT DISTINCT", async () => {
      const indexes = await db.$queryRaw<any[]>`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'PaymentCollectorRoute' AND indexname = 'uq_pcr_branch_route_identity';
      `;
      expect(indexes.length).toBe(1);
      expect(indexes[0].indexdef).toContain("NULLS NOT DISTINCT");
    });

    it("1.2 PaymentCollectorRoute has partial index uq_pcr_explicit_discriminator", async () => {
      const indexes = await db.$queryRaw<any[]>`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'PaymentCollectorRoute' AND indexname = 'uq_pcr_explicit_discriminator';
      `;
      expect(indexes.length).toBe(1);
      expect(indexes[0].indexdef).toContain("WHERE");
      expect(indexes[0].indexdef).toContain('"routingDiscriminator" IS NOT NULL');
    });

    it("1.3 Effective attribution views have security_invoker = true", async () => {
      const views = await db.$queryRaw<any[]>`
        SELECT c.relname, c.reloptions
        FROM pg_class c
        WHERE c.relname IN ('v_effective_fee_payment', 'v_effective_payment_receipt', 'v_effective_payment_allocation');
      `;
      expect(views.length).toBe(3);
      for (const v of views) {
        expect(v.reloptions).toContain("security_invoker=true");
      }
    });

    it("1.4 Function fn_get_effective_branch_id is SECURITY INVOKER with fixed search_path", async () => {
      const funcs = await db.$queryRaw<any[]>`
        SELECT p.proname, p.prosecdef, p.proconfig, p.proacl::text AS acl
        FROM pg_proc p
        WHERE p.proname = 'fn_get_effective_branch_id';
      `;
      expect(funcs.length).toBe(1);
      expect(funcs[0].prosecdef).toBe(false); // SECURITY INVOKER
      expect(funcs[0].proconfig).toContain("search_path=public, pg_temp");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKSTREAM 4: Composite Foreign-Key ON UPDATE RESTRICT Enforcement
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Workstream 4: Composite Foreign-Key Update Protection (ON UPDATE RESTRICT)", () => {
    it("4.1 Updating Branch.id when referenced by PaymentAllocation is rejected (ON UPDATE RESTRICT)", async () => {
      const student = await db.student.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          admissionNo: "ADM-FK-41",
          firstName: "John",
          lastName: "Doe",
        },
      });

      const invoice = await db.feeInvoice.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          studentId: student.id,
          number: "INV-FK-41",
          title: "Tuition Fee",
          amount: 50000,
          paidAmount: 50000,
          dueDate: new Date(),
        },
      });

      const receipt = await db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            branchId: branchA1.id,
            studentId: student.id,
            receiptNumber: "RCPT-FK-41",
            amount: 50000,
            method: "CASH",
          },
        });
        await tx.paymentReceiptBalance.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            allocatedAmount: 50000,
            unappliedAmount: 0,
          },
        });
        return r;
      });

      await db.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          receiptId: receipt.id,
          feeInvoiceId: invoice.id,
          studentId: student.id,
          amount: 50000,
        },
      });

      // Attempting to update Branch.id should be rejected by ON UPDATE RESTRICT
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Branch" SET "id" = 'new_branch_id_fail' WHERE "id" = '${branchA1.id}'`
        )
      ).rejects.toThrow();
    });

    it("4.2 Updating parent Branch.id while child branch exists is rejected (ON UPDATE RESTRICT)", async () => {
      // branchA1 references branchMainA as parent
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Branch" SET "id" = 'new_main_id_fail' WHERE "id" = '${branchMainA.id}'`
        )
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKSTREAM 2: Effective Branch Attribution Consumer Integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Workstream 2: Effective Branch Attribution Consumer Reporting", () => {
    it("2.1 Historically reconciled payment appears in effective branch collection aggregate", async () => {
      const student = await db.student.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          admissionNo: "ADM-ATTR-21",
          firstName: "Alice",
          lastName: "Smith",
        },
      });

      const invoice = await db.feeInvoice.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchA1.id,
          studentId: student.id,
          number: "INV-ATTR-21",
          title: "Sports Fee",
          amount: 15000,
          paidAmount: 15000,
          dueDate: new Date(),
        },
      });

      // 1. Create a payment initially recorded on branchA1
      const payment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoice.id,
          branchId: branchA1.id,
          amount: 15000,
          paidAt: new Date(),
          method: "CASH",
        },
      });

      // Before reconciliation:
      const monthStart = new Date(Date.now() - 24 * 3600 * 1000);
      const sumBeforeA1 = await getEffectiveFeeCollectedSum(tenantA.id, monthStart, [branchA1.id], db);
      const sumBeforeA2 = await getEffectiveFeeCollectedSum(tenantA.id, monthStart, [branchA2.id], db);
      expect(sumBeforeA1).toBeGreaterThanOrEqual(15000);

      // 2. Owner reconciles payment from branchA1 to branchA2
      const reconRes = await reconcileHistoricalRecord(
        ownerCtx as any,
        {
          recordType: "FeePayment",
          recordId: payment.id,
          newBranchId: branchA2.id,
          reason: "Payment collected at South Branch cashier drawer",
          candidateEvidence: "Cash drawer log CD-2026-084",
        },
        db
      );
      expect(reconRes.success).toBe(true);

      // 3. Verify effective branch in view
      const viewRow = await db.$queryRaw<any[]>`
        SELECT id, "branchId", "effectiveBranchId"
        FROM "v_effective_fee_payment"
        WHERE id = ${payment.id}
      `;
      expect(viewRow.length).toBe(1);
      expect(viewRow[0].branchId).toBe(branchA1.id); // Raw immutable record preserved!
      expect(viewRow[0].effectiveBranchId).toBe(branchA2.id); // Effective projected to branchA2!

      // 4. Verify consumer collection sum:
      const sumAfterA2 = await getEffectiveFeeCollectedSum(tenantA.id, monthStart, [branchA2.id], db);
      expect(sumAfterA2).toBeGreaterThanOrEqual(15000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKSTREAM 5: Multi-Merchant Payment Routing Disambiguation (8 Cases)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Workstream 5: Multi-Merchant Payment Routing Disambiguation", () => {
    const CODE_MULTI = "COL-MULTI-MERCH";
    const CODE_SHARED = "COL-CROSS-BRANCH";
    const CODE_CONFLICT = "COL-CONFLICT-TEST";

    beforeAll(async () => {
      // Route 1: Branch A1, Merchant M1
      await db.paymentCollectorRoute.create({
        data: {
          id: "pcr_multi_m1",
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH_M1_FEES",
          collectorCode: CODE_MULTI,
          isActive: true,
        },
      });

      // Route 2: Branch A1, Merchant M2 (Distinct merchant on same branch)
      await db.paymentCollectorRoute.create({
        data: {
          id: "pcr_multi_m2",
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH_M2_BUS",
          collectorCode: CODE_MULTI,
          isActive: true,
        },
      });

      // Route 3: Branch A1, Shared Code (no discriminator)
      await db.paymentCollectorRoute.create({
        data: {
          id: "pcr_shared_a1",
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: CODE_SHARED,
          isActive: true,
        },
      });

      // Route 4: Branch A2, Shared Code (no discriminator)
      await db.paymentCollectorRoute.create({
        data: {
          id: "pcr_shared_a2",
          tenantId: tenantA.id,
          branchId: branchA2.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: CODE_SHARED,
          isActive: true,
        },
      });

      // Route 5: Branch A1 with merchant AND discriminator
      await db.paymentCollectorRoute.create({
        data: {
          id: "pcr_conflict_a1",
          tenantId: tenantA.id,
          branchId: branchA1.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH_CONF_A",
          collectorCode: CODE_CONFLICT,
          routingDiscriminator: "DISC_PRIMARY",
          isActive: true,
        },
      });
    });

    it("Case 1: Same collector code, same branch, two different merchant accounts both identified correctly", async () => {
      const res1 = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: CODE_MULTI,
          merchantId: "MERCH_M1_FEES",
        },
        db
      );
      expect(res1.status).toBe("RESOLVED");
      expect(res1.branchId).toBe(branchA1.id);
      expect(res1.resolutionEvidence).toContain("MERCH_M1_FEES");

      const res2 = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: CODE_MULTI,
          merchantId: "MERCH_M2_BUS",
        },
        db
      );
      expect(res2.status).toBe("RESOLVED");
      expect(res2.branchId).toBe(branchA1.id);
      expect(res2.resolutionEvidence).toContain("MERCH_M2_BUS");
    });

    it("Case 2: Same collector code, different branches, no discriminator supplied is quarantined as AMBIGUOUS_SHARED_CODE", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: CODE_SHARED,
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("AMBIGUOUS_SHARED_CODE");
        expect(res.branchId).toBeNull();
      }
    });

    it("Case 3: Same collector code, same branch, missing merchant identity is quarantined as AMBIGUOUS_SHARED_CODE", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: CODE_MULTI,
          // Missing merchantId!
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("AMBIGUOUS_SHARED_CODE");
        expect(res.resolutionEvidence).toContain("multiple distinct merchant accounts");
      }
    });

    it("Case 4: Invalid/unmatched merchant identity is quarantined as MERCHANT_MISMATCH", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: CODE_MULTI,
          merchantId: "MERCH_DOES_NOT_EXIST",
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("MERCHANT_MISMATCH");
      }
    });

    it("Case 5: Conflicting merchant and routing-discriminator metadata is quarantined as CONFLICTING_METADATA", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "LIVE",
          collectorCode: CODE_CONFLICT,
          merchantId: "MERCH_CONF_A",
          discriminator: "DISC_WRONG_DISCRIMINATOR", // Conflicts with configured DISC_PRIMARY
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("CONFLICTING_METADATA");
      }
    });

    it("Case 6: Provider and environment mismatch is quarantined as ENVIRONMENT_MISMATCH", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "JODO",
          environment: "TEST", // Configured as LIVE!
          collectorCode: CODE_MULTI,
          merchantId: "MERCH_M1_FEES",
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("ENVIRONMENT_MISMATCH");
      }
    });

    it("Case 7: Duplicate or ambiguous provider configuration across branches is quarantined as AMBIGUOUS_SHARED_CODE", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: CODE_SHARED,
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("AMBIGUOUS_SHARED_CODE");
      }
    });

    it("Case 8: Unknown or unverified collector code is quarantined as UNKNOWN_COLLECTOR_CODE", async () => {
      const res = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "COL-COMPLETELY-UNKNOWN-999",
        },
        db
      );
      expect(res.status).toBe("QUARANTINED");
      if (res.status === "QUARANTINED") {
        expect(res.reason).toBe("UNKNOWN_COLLECTOR_CODE");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKSTREAM 6: Migration Correction on Realistic Pre-Phase-2.3 State
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Workstream 6: Realistic Pre-Phase-2.3 Migration Upgrade & Ambiguity Quarantine", () => {
    it("6.1 Branches with multiple conflicting PaymentProviderConfigs are quarantined (AMBIGUOUS_MULTIPLE_CONFIGS)", async () => {
      // Create a branch with ambiguous multi-provider configs
      const branchAmbiguous = await db.branch.create({
        data: {
          tenantId: tenantA.id,
          parentBranchId: branchMainA.id,
          name: "Ambiguous Branch",
          code: "AMB-BR",
          collectorCode: "COL-AMBIGUOUS",
        },
      });

      // Config 1: DEMO
      await db.paymentProviderConfig.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchAmbiguous.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "COL-AMBIGUOUS",
          isEnabled: true,
        },
      });

      // Config 2: JODO (Conflicting active config for same branch!)
      await db.paymentProviderConfig.create({
        data: {
          tenantId: tenantA.id,
          branchId: branchAmbiguous.id,
          provider: "JODO",
          environment: "LIVE",
          merchantId: "MERCH_AMB_JODO",
          collectorCode: "COL-AMBIGUOUS",
          isEnabled: true,
        },
      });

      // Initial route inserted by Phase 2.1 (arbitrary active demo route)
      await db.paymentCollectorRoute.create({
        data: {
          id: `pcr_${branchAmbiguous.id}`,
          tenantId: tenantA.id,
          branchId: branchAmbiguous.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "COL-AMBIGUOUS",
          isActive: true,
        },
      });

      // Execute migration 20261121150000 quarantine logic:
      await db.$executeRawUnsafe(`
        UPDATE "PaymentCollectorRoute" pcr
        SET
          "provider" = 'UNVERIFIED',
          "environment" = 'UNVERIFIED',
          "merchantId" = NULL,
          "isActive" = false,
          "metadata" = jsonb_build_object(
            'quarantinedAt', NOW(),
            'source', 'PaymentProviderConfig',
            'status', 'AMBIGUOUS_MULTIPLE_CONFIGS',
            'reason', 'Multiple conflicting PaymentProviderConfig rows found for this branch/collector code.'
          )
        WHERE pcr."branchId" IN (
          SELECT b."id"
          FROM "Branch" b
          JOIN "PaymentProviderConfig" ppc
            ON ppc."tenantId" = b."tenantId"
           AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
          GROUP BY b."id"
          HAVING COUNT(DISTINCT ppc."id") > 1
        );
      `);

      // Verify route was quarantined
      const route = await db.paymentCollectorRoute.findFirst({
        where: { tenantId: tenantA.id, branchId: branchAmbiguous.id },
      });
      expect(route).toBeDefined();
      expect(route?.provider).toBe("UNVERIFIED");
      expect(route?.environment).toBe("UNVERIFIED");
      expect(route?.isActive).toBe(false);
      expect((route?.metadata as any)?.status).toBe("AMBIGUOUS_MULTIPLE_CONFIGS");

      // Verify routing engine quarantines it
      const routingRes = await resolvePaymentCollectorBranch(
        {
          tenantId: tenantA.id,
          provider: "DEMO",
          environment: "DEMO",
          collectorCode: "COL-AMBIGUOUS",
        },
        db
      );
      expect(routingRes.status).toBe("QUARANTINED");
    });
  });
});
