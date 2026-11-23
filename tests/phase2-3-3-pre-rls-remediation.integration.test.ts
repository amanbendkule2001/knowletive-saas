import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { syncPermissions } from "../scripts/sync-permissions";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_phase2_3_3_disposable";
const DISPOSABLE_DB_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DISPOSABLE_DB_NAME}?schema=public`;
const APP_DB_URL = `postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/${DISPOSABLE_DB_NAME}?schema=public`;

describe("Knowletive Phase 2.3.3 — Critical Pre-RLS Remediation, Role Separation & Canonical Closure", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;
  let appDb: PrismaClient;

  let tenantA: any;
  let tenantB: any;
  let branchA1: any;
  let branchB1: any;
  let studentA: any;
  let invoiceA: any;

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

    // 2. Deploy canonical migrations up to 20261121160000
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect admin client and app client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    appDb = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Sync RBAC
    await syncPermissions(db, { strict: true });

    // 5. Seed test Tenants and Branches
    tenantA = await db.tenant.create({
      data: {
        name: "Tenant Alpha Academy",
        slug: "tenant-alpha-233",
        email: "admin@alpha233.edu",
        logoInitials: "TA",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        name: "Tenant Beta Institute",
        slug: "tenant-beta-233",
        email: "admin@beta233.edu",
        logoInitials: "TB",
      },
    });

    branchA1 = await db.branch.create({
      data: {
        tenantId: tenantA.id,
        name: "Alpha Main Campus",
        code: "ALPHA-MAIN",
        branchType: "MAIN",
        verificationStatus: "VERIFIED",
      },
    });

    branchB1 = await db.branch.create({
      data: {
        tenantId: tenantB.id,
        name: "Beta North Campus",
        code: "BETA-NORTH",
        branchType: "MAIN",
        verificationStatus: "VERIFIED",
      },
    });

    studentA = await db.student.create({
      data: {
        tenantId: tenantA.id,
        branchId: branchA1.id,
        admissionNo: "ADM-ALPHA-001",
        firstName: "Aarav",
        lastName: "Sharma",
      },
    });

    invoiceA = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        branchId: branchA1.id,
        studentId: studentA.id,
        number: "INV-ALPHA-001",
        title: "Tuition Fee",
        amount: 2500000,
        paidAmount: 0,
        status: "PENDING",
        dueDate: new Date(Date.now() + 86400000),
      },
    });
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
    if (appDb) await appDb.$disconnect();
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

  // ==========================================================================
  // PART 3 — COMPOSITE TENANT-AWARE FINANCIAL FOREIGN KEYS
  // ==========================================================================

  describe("Part 3 — Tenant-Aware Foreign Key Tests", () => {
    it("3.1: Valid tenant and branch pair succeeds on PaymentReceipt", async () => {
      const receipt = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA.id,
          branchId: branchA1.id,
          receiptNumber: "RCPT-233-001",
          amount: 500000,
          method: "CASH",
          provider: "cashier",
          balance: {
            create: {
              allocatedAmount: 0,
              transferredOutAmount: 0,
              unappliedAmount: 500000,
            },
          },
        },
      });
      expect(receipt.id).toBeDefined();
      expect(receipt.branchId).toBe(branchA1.id);
      expect(receipt.tenantId).toBe(tenantA.id);
    });

    it("3.2: Cross-tenant branch pair fails on PaymentReceipt", async () => {
      // Attempting to create a receipt for Tenant A pointing to Branch B1 (Tenant B)
      await expect(
        db.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA.id,
            branchId: branchB1.id, // CROSS-TENANT!
            receiptNumber: "RCPT-233-CROSS",
            amount: 500000,
            method: "CASH",
            provider: "cashier",
            balance: {
              create: {
                allocatedAmount: 0,
                transferredOutAmount: 0,
                unappliedAmount: 500000,
              },
            },
          },
        })
      ).rejects.toThrow();
    });

    it("3.3: Valid NULL branch attribution succeeds on PaymentReceipt", async () => {
      const nullReceipt = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA.id,
          branchId: null, // Historical unassigned
          receiptNumber: "RCPT-233-NULL",
          amount: 300000,
          method: "CASH",
          provider: "cashier",
          balance: {
            create: {
              allocatedAmount: 0,
              transferredOutAmount: 0,
              unappliedAmount: 300000,
            },
          },
        },
      });
      expect(nullReceipt.id).toBeDefined();
      expect(nullReceipt.branchId).toBeNull();
    });

    it("3.4: Valid tenant and branch pair succeeds on FeePayment", async () => {
      const payment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoiceA.id,
          branchId: branchA1.id,
          amount: 250000,
          method: "CASH",
        },
      });
      expect(payment.id).toBeDefined();
      expect(payment.branchId).toBe(branchA1.id);
    });

    it("3.5: Cross-tenant branch pair fails on FeePayment", async () => {
      // Attempting to create a payment for Tenant A pointing to Branch B1 (Tenant B)
      await expect(
        db.feePayment.create({
          data: {
            tenantId: tenantA.id,
            feeInvoiceId: invoiceA.id,
            branchId: branchB1.id, // CROSS-TENANT!
            amount: 250000,
            method: "CASH",
          },
        })
      ).rejects.toThrow();
    });

    it("3.6: Valid NULL branch attribution succeeds on FeePayment", async () => {
      const nullPayment = await db.feePayment.create({
        data: {
          tenantId: tenantA.id,
          feeInvoiceId: invoiceA.id,
          branchId: null, // Historical unassigned
          amount: 150000,
          method: "CASH",
        },
      });
      expect(nullPayment.id).toBeDefined();
      expect(nullPayment.branchId).toBeNull();
    });

    it("3.7: Branch deletion is restricted when referenced by PaymentReceipt or FeePayment", async () => {
      await expect(
        db.branch.delete({
          where: { id: branchA1.id },
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // PART 4 — RUNTIME DATABASE ROLE SEPARATION & LEAST PRIVILEGE
  // ==========================================================================

  describe("Part 4 — Runtime Database Role Separation", () => {
    it("4.1: Role knowletive_app is NOT a superuser and does NOT have BYPASSRLS", async () => {
      const roles: any[] = await db.$queryRaw`
        SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
        FROM pg_roles
        WHERE rolname = 'knowletive_app';
      `;
      expect(roles.length).toBe(1);
      expect(roles[0].rolsuper).toBe(false);
      expect(roles[0].rolbypassrls).toBe(false);
      expect(roles[0].rolcanlogin).toBe(true);
    });

    it("4.2: Role knowletive_app cannot execute DDL (CREATE TABLE rejected)", async () => {
      await expect(
        appDb.$executeRawUnsafe(`CREATE TABLE evil_table (id text);`)
      ).rejects.toThrow();
    });

    it("4.3: Role knowletive_app cannot execute TRUNCATE", async () => {
      await expect(
        appDb.$executeRawUnsafe(`TRUNCATE TABLE "Student";`)
      ).rejects.toThrow();
    });

    it("4.4: Role knowletive_app can read operational tables", async () => {
      const students = await appDb.student.findMany({
        where: { tenantId: tenantA.id },
      });
      expect(students.length).toBeGreaterThan(0);
    });

    it("4.5: Immutable financial event tables reject UPDATE and DELETE from knowletive_app", async () => {
      // 1. UPDATE PaymentReceipt should be rejected
      await expect(
        appDb.$executeRawUnsafe(`UPDATE "PaymentReceipt" SET amount = 999999 WHERE "tenantId" = '${tenantA.id}';`)
      ).rejects.toThrow();

      // 2. DELETE PaymentReceipt should be rejected
      await expect(
        appDb.$executeRawUnsafe(`DELETE FROM "PaymentReceipt" WHERE "tenantId" = '${tenantA.id}';`)
      ).rejects.toThrow();

      // 3. UPDATE FeePayment should be rejected
      await expect(
        appDb.$executeRawUnsafe(`UPDATE "FeePayment" SET amount = 999999 WHERE "tenantId" = '${tenantA.id}';`)
      ).rejects.toThrow();

      // 4. DELETE FeePayment should be rejected
      await expect(
        appDb.$executeRawUnsafe(`DELETE FROM "FeePayment" WHERE "tenantId" = '${tenantA.id}';`)
      ).rejects.toThrow();
    });

    it("4.6: Reporting views can be queried by knowletive_app", async () => {
      const viewResult: any[] = await appDb.$queryRaw`
        SELECT * FROM v_effective_fee_payment WHERE "tenantId" = ${tenantA.id};
      `;
      expect(Array.isArray(viewResult)).toBe(true);
      expect(viewResult.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // PART 5 — CANONICAL COPILOT AND WEBHOOKEVENT MIGRATIONS
  // ==========================================================================

  describe("Part 5 — Canonical Copilot and WebhookEvent Verification", () => {
    it("5.1: CopilotThread and CopilotMessage tables exist and support CRUD", async () => {
      // Create user for chat thread
      const testUser = await db.user.create({
        data: {
          email: "teacher.chat@alpha233.edu",
          name: "Chat Teacher",
          passwordHash: "hash",
        },
      });

      const thread = await db.copilotThread.create({
        data: {
          tenantId: tenantA.id,
          userId: testUser.id,
          title: "Fee Collection Guidance",
        },
      });
      expect(thread.id).toBeDefined();

      const message = await db.copilotMessage.create({
        data: {
          threadId: thread.id,
          role: "USER",
          content: "How much fee is outstanding for Class 10?",
          status: "COMPLETE",
        },
      });
      expect(message.id).toBeDefined();
      expect(message.role).toBe("USER");
    });

    it("5.2: WebhookEvent supports rawPayload, tenantId, branchId, and status fields", async () => {
      const event = await db.webhookEvent.create({
        data: {
          provider: "DEMO",
          eventId: "evt-test-233-canonical",
          eventType: "PAYMENT_SUCCESS",
          status: "PROCESSING",
          rawPayload: { sample: "payload", amount: 5000 },
          tenantId: tenantA.id,
          branchId: branchA1.id,
        },
      });
      expect(event.id).toBeDefined();
      expect(event.status).toBe("PROCESSING");
      expect(event.tenantId).toBe(tenantA.id);
      expect(event.branchId).toBe(branchA1.id);
    });
  });
});
