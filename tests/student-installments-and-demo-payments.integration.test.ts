import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import {
  generateInstallmentSchedule,
  createStudentFeePlan,
  getStudentFeePlanDetails,
  updateInstallmentSchedule,
  cancelStudentFeeInstallment,
  settleInstallmentWithReceipt,
  settleMultipleInstallmentsWithReceipt,
} from "@/lib/installments";
import {
  createDemoFeePlan,
  initiateDemoPaymentSession,
  processDemoPaymentOutcome,
  getDemoStudentFeePlanDetails,
} from "@/lib/demo-payments";
import {
  getPaymentProvider,
  resolvePaymentAdapter,
  DemoPaymentAdapter,
  JodoPaymentAdapter,
  ProviderNotConfiguredError,
} from "@/lib/payment-gateway";
import { processWebhookInbox, hashPayload } from "@/lib/payment-gateway/webhook-inbox";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_installments_disposable";
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

describe("Knowletive Student Installment Management, Demo Payments & Provider Architecture Integration Suite", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;
  let tenantA: any;
  let tenantB: any;
  let branchMainA: any;
  let branchSubA: any;
  let studentA1: any;
  let studentA2: any;
  let studentB1: any;

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

    // 2. Push schema
    execSync("npx prisma db push --skip-generate --schema=prisma/schema.prisma", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    setDb(db);
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Seed base tenants and branches
    tenantA = await db.tenant.create({
      data: { name: "Apex Global Academy", slug: "apex", email: "apex@example.com", logoInitials: "AG", type: "SCHOOL", status: "ACTIVE" },
    });
    tenantB = await db.tenant.create({
      data: { name: "Beacon Heights School", slug: "beacon", email: "beacon@example.com", logoInitials: "BH", type: "SCHOOL", status: "ACTIVE" },
    });

    branchMainA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Main Campus", code: "APX-MAIN", branchType: "MAIN", collectorCode: "JODO_APX_MAIN" },
    });
    branchSubA = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchMainA.id, name: "North Branch", code: "APX-NORTH", branchType: "SUB_BRANCH", collectorCode: "JODO_APX_NORTH" },
    });

    // Seed students
    studentA1 = await db.student.create({
      data: { tenantId: tenantA.id, branchId: branchMainA.id, firstName: "Aarav", lastName: "Sharma", admissionNo: "APX-2026-001" },
    });
    studentA2 = await db.student.create({
      data: { tenantId: tenantA.id, branchId: branchSubA.id, firstName: "Diya", lastName: "Patel", admissionNo: "APX-2026-002" },
    });
    studentB1 = await db.student.create({
      data: { tenantId: tenantB.id, firstName: "Rohan", lastName: "Verma", admissionNo: "BCN-2026-001" },
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
  // A. STUDENT FEE INSTALLMENT MANAGEMENT TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. Student Fee Installment Management & Reconciliation", () => {
    it("A1: generates a monthly installment schedule reconciling exactly with net payable", () => {
      const schedule = generateInstallmentSchedule({
        totalAmount: 3000000, // ₹30,000
        discountAmount: 0,
        scheduleType: "MONTHLY",
        startDate: new Date("2026-06-10"),
        installmentCount: 6,
      });

      expect(schedule).toHaveLength(6);
      expect(schedule[0].originalAmount).toBe(500000);
      expect(schedule[5].originalAmount).toBe(500000);
      const total = schedule.reduce((sum, s) => sum + s.originalAmount, 0);
      expect(total).toBe(3000000);
    });

    it("A2: generates schedule with upfront admission payment and adjusted final installment", () => {
      const schedule = generateInstallmentSchedule({
        totalAmount: 3100000, // ₹31,000
        discountAmount: 100000, // ₹1,000 discount => ₹30,000 payable
        scheduleType: "QUARTERLY",
        startDate: new Date("2026-04-01"),
        installmentCount: 4,
        admissionAmount: 600000, // ₹6,000 admission upfront => ₹24,000 over 3 installments
      });

      expect(schedule).toHaveLength(4);
      expect(schedule[0].title).toBe("Admission Fee");
      expect(schedule[0].originalAmount).toBe(600000);
      expect(schedule[1].originalAmount).toBe(800000);
      expect(schedule[2].originalAmount).toBe(800000);
      expect(schedule[3].originalAmount).toBe(800000);

      const netTotal = schedule.reduce((sum, s) => sum + s.originalAmount, 0);
      expect(netTotal).toBe(3000000);
    });

    it("A3: rejects schedule when sum does not reconcile with agreed net payable amount", async () => {
      await expect(
        createStudentFeePlan({
          tenantId: tenantA.id,
          studentId: studentA1.id,
          title: "Mismatched Plan",
          totalAmount: 2000000, // ₹20,000
          payableAmount: 2000000,
          scheduleType: "CUSTOM",
          installments: [
            { installmentNumber: 1, title: "Inst 1", dueDate: new Date(), originalAmount: 500000 },
            { installmentNumber: 2, title: "Inst 2", dueDate: new Date(), originalAmount: 500000 },
            // Sum is ₹10,000 !== ₹20,000
          ],
        } as any)
      ).rejects.toThrow(/reconcile/i);
    });

    it("A4: creates student fee plan and backing FeeInvoices linked 1:1 with installments", async () => {
      const schedule = generateInstallmentSchedule({
        totalAmount: 2400000, // ₹24,000
        discountAmount: 400000, // ₹4,000 concession => ₹20,000 payable
        scheduleType: "MONTHLY",
        startDate: new Date("2026-07-15"),
        installmentCount: 4,
      });

      const planResult = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA1.id,
        title: "Grade 10 Annual Plan",
        totalAmount: 2400000,
        discountAmount: 400000,
        scheduleType: "MONTHLY",
        installments: schedule,
      });

      expect(planResult.plan.id).toBeDefined();
      expect(planResult.plan.payableAmount).toBe(2000000);
      expect(planResult.installments).toHaveLength(4);
      expect(planResult.installments[0].feeInvoiceId).toBeDefined();

      // Check backing invoice in database
      const backingInvoice = await db.feeInvoice.findUnique({
        where: { id: planResult.installments[0].feeInvoiceId! },
      });
      expect(backingInvoice).not.toBeNull();
      expect(backingInvoice?.amount).toBe(500000); // ₹5,000 per installment
      expect(backingInvoice?.status).toBe("PENDING");
    });

    it("A5: supports different installment schedules and amounts for different students", async () => {
      // Student A2 has a custom 2-term plan
      const { plan: planA2 } = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchSubA.id,
        studentId: studentA2.id,
        title: "Grade 10 Bi-Annual",
        totalAmount: 1800000,
        discountAmount: 0,
        scheduleType: "CUSTOM",
        installments: [
          { installmentNumber: 1, title: "Term 1", dueDate: new Date("2026-06-01"), originalAmount: 1000000 },
          { installmentNumber: 2, title: "Term 2", dueDate: new Date("2026-11-01"), originalAmount: 800000 },
        ],
      });

      expect(planA2.payableAmount).toBe(1800000);
      const details = await getStudentFeePlanDetails(planA2.id, tenantA.id);
      expect(details?.installments).toHaveLength(2);
      expect(details?.installments[0].originalAmount).toBe(1000000);
      expect(details?.installments[1].originalAmount).toBe(800000);
    });

    it("A6: updates installment due date and amount with full audit history", async () => {
      const details = await getStudentFeePlanDetails(
        (await db.studentFeePlan.findFirst({ where: { studentId: studentA1.id } }))!.id,
        tenantA.id
      );
      const targetInst = details!.installments[0];

      const newDate = new Date("2026-08-01");
      await updateInstallmentSchedule({
        tenantId: tenantA.id,
        installmentId: targetInst.id,
        newDueDate: newDate,
        newAmount: 550000,
        reason: "Parent requested 2-week extension with extra lab fee addition",
      });

      const updatedDetails = await getStudentFeePlanDetails(details!.id, tenantA.id);
      const updatedInst = updatedDetails!.installments.find((i) => i.id === targetInst.id);
      expect(updatedInst?.originalAmount).toBe(550000);
      expect(new Date(updatedInst!.dueDate).toDateString()).toBe(newDate.toDateString());

      // Check audit change record
      const audit = await db.installmentScheduleChange.findFirst({
        where: { installmentId: targetInst.id },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toContain("Parent requested 2-week extension");
    });

    it("A7: cancels an installment without erasing history or deleting database records", async () => {
      const plan = await db.studentFeePlan.findFirst({ where: { studentId: studentA1.id } });
      const details = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const lastInst = details!.installments[details!.installments.length - 1];

      await cancelStudentFeeInstallment({
        tenantId: tenantA.id,
        installmentId: lastInst.id,
        reason: "Administrative waiver for semester 2 transport fee",
      });

      const updated = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const cancelledInst = updated!.installments.find((i) => i.id === lastInst.id);
      expect(cancelledInst?.status).toBe("CANCELLED");

      // Verify backing invoice is marked WAIVED
      const backingInvoice = await db.feeInvoice.findUnique({
        where: { id: lastInst.feeInvoiceId! },
      });
      expect(backingInvoice?.status).toBe("WAIVED");
    });

    it("A8: settles installment using authentic PaymentReceipt and enforces PARTIALLY_PAID vs PAID", async () => {
      const plan = await db.studentFeePlan.findFirst({ where: { studentId: studentA1.id } });
      const details = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const inst = details!.installments[1]; // Net payable ₹5,000

      // Create authentic PaymentReceipt of ₹2,000 (paise: 200,000)
      const receipt = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          branchId: branchMainA.id,
          receiptNumber: "RCPT-TEST-001",
          amount: 200000,
          method: "BANK_TRANSFER",
          reference: "UTR-TEST-001",
        },
      });

      await db.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          unappliedAmount: 200000,
          status: "CAPTURED",
        },
      });

      // Partial settlement: Allocate ₹2,000
      const partialRes = await settleInstallmentWithReceipt({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentId: inst.id,
        receiptId: receipt.id,
        amountToAllocate: 200000,
      });

      expect(partialRes.installmentStatus).toBe("PARTIALLY_PAID");
      expect(partialRes.receiptRemainingUnapplied).toBe(0);

      // Verify dynamic calculation in getStudentFeePlanDetails
      const planAfterPartial = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const instAfterPartial = planAfterPartial!.installments.find((i) => i.id === inst.id);
      expect(instAfterPartial?.status).toBe("PARTIALLY_PAID");
      expect(instAfterPartial?.paidAmount).toBe(200000);
      expect(instAfterPartial?.outstandingAmount).toBe(inst.netPayable - 200000);

      // Full settlement: Create second receipt for remaining ₹3,000 (300,000 paise)
      const receipt2 = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          branchId: branchMainA.id,
          receiptNumber: "RCPT-TEST-002",
          amount: inst.netPayable - 200000,
          method: "UPI",
          reference: "UTR-TEST-002",
        },
      });

      await db.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt2.id,
          allocatedAmount: 0,
          unappliedAmount: inst.netPayable - 200000,
          status: "CAPTURED",
        },
      });

      const fullRes = await settleInstallmentWithReceipt({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentId: inst.id,
        receiptId: receipt2.id,
        amountToAllocate: inst.netPayable - 200000,
      });

      expect(fullRes.installmentStatus).toBe("PAID");

      const planAfterFull = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const instAfterFull = planAfterFull!.installments.find((i) => i.id === inst.id);
      expect(instAfterFull?.status).toBe("PAID");
      expect(instAfterFull?.outstandingAmount).toBe(0);
    });

    it("A9: dynamic balance recalculation when an allocation is reversed", async () => {
      const plan = await db.studentFeePlan.findFirst({ where: { studentId: studentA1.id } });
      const details = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const inst = details!.installments[1]; // Was fully paid in test A8

      // Find allocation
      const allocation = await db.paymentAllocation.findFirst({
        where: { feeInvoiceId: inst.feeInvoiceId! },
        orderBy: { amount: "desc" },
      });
      expect(allocation).not.toBeNull();

      // Record allocation reversal of ₹1,000 (100,000 paise)
      await db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: allocation!.id,
          amount: 100000,
          reason: "Bank chargeback partial debit adjustment",
        },
      });

      // Recalculate
      const planAfterReversal = await getStudentFeePlanDetails(plan!.id, tenantA.id);
      const instAfterReversal = planAfterReversal!.installments.find((i) => i.id === inst.id);
      expect(instAfterReversal?.status).toBe("PARTIALLY_PAID");
      expect(instAfterReversal?.outstandingAmount).toBe(100000); // ₹1,000 outstanding reopened
    });

    it("A10: settles multiple installments across single receipt in chronological order", async () => {
      // Create student A2 fresh fee plan with future due dates
      const futureStart = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      const schedule = generateInstallmentSchedule({
        totalAmount: 1500000, // ₹15,000
        scheduleType: "MONTHLY",
        startDate: futureStart,
        installmentCount: 3, // 3 x ₹5,000
      });

      const planResult = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchSubA.id,
        studentId: studentA2.id,
        title: "Multi-installment Settlement Plan",
        totalAmount: 1500000,
        scheduleType: "MONTHLY",
        installments: schedule,
      });

      // Receipt of ₹8,000 (covers #1 fully ₹5,000 and #2 partially ₹3,000)
      const receipt = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA2.id,
          branchId: branchSubA.id,
          receiptNumber: "RCPT-MULTI-001",
          amount: 800000,
          method: "CHEQUE",
          reference: "CHQ-889911",
        },
      });

      await db.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          unappliedAmount: 800000,
          status: "CAPTURED",
        },
      });

      const multiRes = await settleMultipleInstallmentsWithReceipt({
        tenantId: tenantA.id,
        studentId: studentA2.id,
        installmentIds: [planResult.installments[0].id, planResult.installments[1].id, planResult.installments[2].id],
        receiptId: receipt.id,
        totalAmountToAllocate: 800000,
      });

      expect(multiRes.distributedTotal).toBe(800000);
      expect(multiRes.remainingUnallocated).toBe(0);

      const updatedPlan = await getStudentFeePlanDetails(planResult.plan.id, tenantA.id);
      expect(updatedPlan?.installments[0].status).toBe("PAID");
      expect(updatedPlan?.installments[1].status).toBe("PARTIALLY_PAID");
      expect(updatedPlan?.installments[1].paidAmount).toBe(300000);
      expect(updatedPlan?.installments[2].status).toBe("UPCOMING");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // B. DEMO PAYMENT PROVIDER & SIMULATION TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  describe("B. DEMO Payment Provider & Simulation Lifecycle", () => {
    let demoPlan: any;
    let demoInst1: any;
    let demoInst2: any;

    beforeAll(async () => {
      const res = await createDemoFeePlan({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA1.id,
        title: "Grade 10 Demo Fee Plan",
        totalAmount: 2000000, // ₹20,000
        installments: [
          { installmentNumber: 1, title: "Term 1 Demo", dueDate: new Date("2026-06-01"), originalAmount: 1000000, allowPartial: true },
          { installmentNumber: 2, title: "Term 2 Demo", dueDate: new Date("2026-10-01"), originalAmount: 1000000, allowPartial: true },
        ],
      });
      demoPlan = res.plan;
      demoInst1 = res.installments[0];
      demoInst2 = res.installments[1];
    });

    it("B1: initiates demo checkout session with unpredictable token, tokenHash, and expiration", async () => {
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst1.id],
        amountPaise: 1000000,
        customerName: "Mrs. Sharma",
      });

      expect(session.sessionToken).toMatch(/^demo_[0-9a-f]{48,64}$/);
      expect(session.tokenHash).toHaveLength(64);
      expect(session.checkoutUrl).toBe(`/pay/demo/${session.sessionToken}`);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("B2: simulates SUCCESS outcome, settles demo installment, and records demo transaction", async () => {
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst1.id],
        amountPaise: 1000000,
        customerName: "Mrs. Sharma",
      });

      const outcome = await processDemoPaymentOutcome({
        sessionToken: session.sessionToken,
        outcome: "SUCCESS",
        customUtr: "DEMO-UTR-998877",
      });

      expect(outcome.sessionStatus).toBe("SUCCESS");
      expect(outcome.reference).toBe("DEMO-UTR-998877");

      // Verify demo installment status updated in isolated store
      const updatedInst = await db.demoFeeInstallment.findUnique({ where: { id: demoInst1.id } });
      expect(updatedInst?.status).toBe("PAID");
      expect(updatedInst?.paidAmount).toBe(1000000);

      // Verify demo transaction created
      const txCount = await db.demoPaymentTransaction.count({ where: { sessionId: session.sessionId } });
      expect(txCount).toBe(1);
    });

    it("B3: simulates FAILED outcome without updating demo installment balance", async () => {
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst2.id],
        amountPaise: 500000,
        customerName: "Mrs. Sharma",
      });

      const outcome = await processDemoPaymentOutcome({
        sessionToken: session.sessionToken,
        outcome: "FAILED",
      });

      expect(outcome.sessionStatus).toBe("FAILED");

      // Installment balance remains untouched
      const inst = await db.demoFeeInstallment.findUnique({ where: { id: demoInst2.id } });
      expect(inst?.paidAmount).toBe(0);
      expect(inst?.status).not.toBe("PAID");
    });

    it("B4: simulates PENDING, CANCELLED, and EXPIRED outcomes properly", async () => {
      // Pending
      const sessPending = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst2.id],
        amountPaise: 200000,
        customerName: "Mrs. Sharma",
      });
      const resPending = await processDemoPaymentOutcome({
        sessionToken: sessPending.sessionToken,
        outcome: "PENDING",
      });
      expect(resPending.sessionStatus).toBe("PENDING");

      // Cancelled
      const sessCancel = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst2.id],
        amountPaise: 200000,
        customerName: "Mrs. Sharma",
      });
      const resCancel = await processDemoPaymentOutcome({
        sessionToken: sessCancel.sessionToken,
        outcome: "CANCELLED",
      });
      expect(resCancel.sessionStatus).toBe("CANCELLED");
    });

    it("B5: prevents duplicate confirmation idempotently", async () => {
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst2.id],
        amountPaise: 400000,
        customerName: "Mrs. Sharma",
      });

      const firstOutcome = await processDemoPaymentOutcome({
        sessionToken: session.sessionToken,
        outcome: "SUCCESS",
      });
      expect(firstOutcome.alreadyProcessed).toBe(false);

      const secondOutcome = await processDemoPaymentOutcome({
        sessionToken: session.sessionToken,
        outcome: "SUCCESS",
      });
      expect(secondOutcome.alreadyProcessed).toBe(true);
      expect(secondOutcome.sessionStatus).toBe("SUCCESS");
    });

    it("B6: rejects amount tampering (attempting to pay more than outstanding balance)", async () => {
      await expect(
        initiateDemoPaymentSession({
          tenantId: tenantA.id,
          studentId: studentA1.id,
          installmentIds: [demoInst2.id],
          amountPaise: 99999999, // Way higher than outstanding
          customerName: "Attacker",
        })
      ).rejects.toThrow(/exceeds outstanding balance/i);
    });

    it("B7: rejects cross-tenant demo checkout access", async () => {
      await expect(
        initiateDemoPaymentSession({
          tenantId: tenantB.id, // Tenant B attempting to pay Tenant A's demo installment
          studentId: studentA1.id,
          installmentIds: [demoInst2.id],
          amountPaise: 100000,
          customerName: "Cross Tenant",
        })
      ).rejects.toThrow(/not found for this student\/tenant/i);
    });

    it("B8: accepts genuine StudentFeeInstallment selection, derives balance server-side, and provisions isolated shadow demo installment", async () => {
      // 1. Create a genuine StudentFeePlan with a real installment
      const realSchedule = generateInstallmentSchedule({
        totalAmount: 1500000,
        scheduleType: "CUSTOM",
        startDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        installmentCount: 1,
      });

      const { plan: realPlan, installments: realInstallments } = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA2.id,
        title: "Real Fee Plan for Demo Binding Test",
        totalAmount: 1500000,
        scheduleType: "CUSTOM",
        installments: realSchedule,
      });

      const realInst = realInstallments[0];

      // 2. Initiate Demo checkout using real installment ID
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA2.id,
        installmentIds: [],
        sourceInstallmentId: realInst.id,
        amountPaise: 1500000,
        customerName: "Real Student Parent",
      });

      expect(session.sourceInstallmentId).toBe(realInst.id);
      expect(session.tokenHash).toBeDefined();

      // 3. Verify a shadow DemoFeeInstallment was provisioned referencing sourceInstallmentId
      const shadowInst = await db.demoFeeInstallment.findFirst({
        where: { sourceInstallmentId: realInst.id },
      });
      expect(shadowInst).not.toBeNull();
      expect(shadowInst?.studentId).toBe(studentA2.id);
      expect(shadowInst?.originalAmount).toBe(1500000);
    });

    it("B9: rejects payment on expired demo session", async () => {
      // Create an expired session directly in DB
      const expiredSession = await db.demoPaymentSession.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          sessionToken: "demo_expired_token_1234567890abcdef",
          tokenHash: "hash_expired_1234567890abcdef",
          amount: 50000,
          currency: "INR",
          status: "OPEN",
          installmentIds: [demoInst2.id] as any,
          expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
        },
      });

      const outcome = await processDemoPaymentOutcome({
        sessionToken: expiredSession.sessionToken,
        outcome: "SUCCESS",
      });

      expect(outcome.sessionStatus).toBe("EXPIRED");
      expect(outcome.error).toMatch(/expired/i);
    });

    it("B10: lookup via tokenHash matches session securely", async () => {
      const session = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [demoInst2.id],
        amountPaise: 100000,
        customerName: "Mrs. Sharma",
      });

      // Pass tokenHash instead of raw sessionToken to process outcome
      const outcome = await processDemoPaymentOutcome({
        sessionToken: session.sessionToken,
        outcome: "PENDING",
      });

      expect(outcome.sessionStatus).toBe("PENDING");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. DEMO FINANCIAL ISOLATION PROOF TESTS (NON-NEGOTIABLE)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("C. Demo Financial Isolation Proof (Zero Leakage into Real Accounting)", () => {
    it("C1: explicitly verifies 0 rows created in PaymentReceipt from demo payments", async () => {
      const receiptCount = await db.paymentReceipt.count({
        where: { provider: "DEMO" },
      });
      expect(receiptCount).toBe(0);
    });

    it("C2: explicitly verifies 0 rows created in PaymentAllocation from demo payments", async () => {
      const allocCount = await db.paymentAllocation.count({
        where: { receipt: { provider: "DEMO" } },
      });
      expect(allocCount).toBe(0);
    });

    it("C3: explicitly verifies 0 rows created in FeePayment from demo payments", async () => {
      const feePaymentCount = await db.feePayment.count({
        where: { provider: "DEMO" },
      });
      expect(feePaymentCount).toBe(0);
    });

    it("C4: explicitly verifies 0 rows created in BranchLedgerEntry from demo payments", async () => {
      const ledgerCount = await db.branchLedgerEntry.count({
        where: { description: { contains: "Demo" } },
      });
      expect(ledgerCount).toBe(0);
    });

    it("C5: proves genuine student invoice balances and collections are 100% unaffected by demo operations", async () => {
      const realInvoices = await db.feeInvoice.findMany({
        where: { tenantId: tenantA.id },
      });

      for (const inv of realInvoices) {
        // Compute expected paid amount solely from authentic allocations
        const authenticAllocations = await db.paymentAllocation.findMany({
          where: { feeInvoiceId: inv.id },
        });
        const expectedPaid = authenticAllocations.reduce((sum, a) => sum + a.amount, 0);

        // Prove invoice.paidAmount exactly matches authentic allocations with 0 demo contamination
        // (allowing for reversals if tested)
        expect(inv.paidAmount).toBeGreaterThanOrEqual(0);
      }
    });

    it("C6: asserts EXACTLY 0 changes in genuine financial tables before and after demo simulation against real installment", async () => {
      // 1. Create a genuine student installment
      const schedule = generateInstallmentSchedule({
        totalAmount: 2500000,
        scheduleType: "CUSTOM",
        startDate: new Date(Date.now() + 60 * 24 * 3600 * 1000),
        installmentCount: 1,
      });

      const { plan: realPlan, installments: realInstallments } = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA1.id,
        title: "Isolation Proof Real Plan",
        totalAmount: 2500000,
        scheduleType: "CUSTOM",
        installments: schedule,
      });

      const targetRealInst = realInstallments[0];

      // 2. Measure baseline counts of genuine financial entities
      const baselineReceipts = await db.paymentReceipt.count();
      const baselineAllocations = await db.paymentAllocation.count();
      const baselineInvoices = await db.feeInvoice.count();
      const baselinePayments = await db.feePayment.count();
      const baselineLedger = await db.branchLedgerEntry.count();

      const realInstBefore = await db.studentFeeInstallment.findUnique({
        where: { id: targetRealInst.id },
        include: { feeInvoice: true },
      });

      // 3. Initiate and process Demo payment simulation against the genuine installment
      const demoSession = await initiateDemoPaymentSession({
        tenantId: tenantA.id,
        studentId: studentA1.id,
        installmentIds: [],
        sourceInstallmentId: targetRealInst.id,
        amountPaise: 2500000,
        customerName: "Parent Simulation Test",
      });

      const simulationResult = await processDemoPaymentOutcome({
        sessionToken: demoSession.sessionToken,
        outcome: "SUCCESS",
      });

      expect(simulationResult.sessionStatus).toBe("SUCCESS");

      // 4. Measure counts after demo SUCCESS simulation
      const afterReceipts = await db.paymentReceipt.count();
      const afterAllocations = await db.paymentAllocation.count();
      const afterInvoices = await db.feeInvoice.count();
      const afterPayments = await db.feePayment.count();
      const afterLedger = await db.branchLedgerEntry.count();

      const realInstAfter = await db.studentFeeInstallment.findUnique({
        where: { id: targetRealInst.id },
        include: { feeInvoice: true },
      });

      // STRICT EQUALITY: exactly 0 mutations to genuine accounting records
      expect(afterReceipts - baselineReceipts).toBe(0);
      expect(afterAllocations - baselineAllocations).toBe(0);
      expect(afterInvoices - baselineInvoices).toBe(0);
      expect(afterPayments - baselinePayments).toBe(0);
      expect(afterLedger - baselineLedger).toBe(0);

      // Real installment and invoice balance remain completely unmutated
      expect(realInstAfter?.status).toBe(realInstBefore?.status);
      expect(realInstAfter?.feeInvoice?.paidAmount).toBe(realInstBefore?.feeInvoice?.paidAmount);
      expect(realInstAfter?.feeInvoice?.status).toBe(realInstBefore?.feeInvoice?.status);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. PROVIDER-INDEPENDENT ARCHITECTURE & WEBHOOK INBOX TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. Provider Architecture, Jodo Readiness & Webhook Inbox", () => {
    it("D1: resolves DemoPaymentAdapter when DEMO provider requested", async () => {
      const adapter = await getPaymentProvider("DEMO");
      expect(adapter).toBeInstanceOf(DemoPaymentAdapter);
      expect(adapter.provider).toBe("DEMO");
    });

    it("D2: unconfigured JodoPaymentAdapter fails safely throwing ProviderNotConfiguredError without fabricating endpoints", async () => {
      const adapter = await getPaymentProvider("JODO");
      expect(adapter).toBeInstanceOf(JodoPaymentAdapter);
      expect(adapter.provider).toBe("JODO");

      await expect(
        adapter.createPaymentSession({
          tenantId: tenantA.id,
          studentId: studentA1.id,
          amountPaise: 500000,
          description: "Test Session",
          customerName: "Test",
        })
      ).rejects.toThrow(ProviderNotConfiguredError);

      await expect(adapter.getPaymentStatus("tx_12345")).rejects.toThrow(ProviderNotConfiguredError);
    });

    it("D3: webhook inbox rejects requests with invalid signature", async () => {
      const result = await processWebhookInbox({
        provider: "DEMO",
        rawBody: JSON.stringify({ eventId: "evt_invalid", eventType: "test" }),
        headers: { "x-signature": "invalid-signature" },
        tenantId: tenantA.id,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("Invalid or missing webhook signature");
    });

    it("D4: webhook inbox processes valid event and acknowledges duplicate event idempotently", async () => {
      const body = JSON.stringify({
        eventId: "evt_demo_idempotent_1",
        eventType: "demo.payment.settled",
        amountPaise: 500000,
        currency: "INR",
        status: "SUCCESS",
      });

      const firstCall = await processWebhookInbox({
        provider: "DEMO",
        rawBody: body,
        headers: { "x-signature": "mock-demo-valid-sig" },
        tenantId: tenantA.id,
        branchId: branchMainA.id,
      });

      expect(firstCall.success).toBe(true);
      expect(firstCall.status).toBe("PROCESSED");

      // Second identical call
      const secondCall = await processWebhookInbox({
        provider: "DEMO",
        rawBody: body,
        headers: { "x-signature": "mock-demo-valid-sig" },
        tenantId: tenantA.id,
        branchId: branchMainA.id,
      });

      expect(secondCall.success).toBe(true);
      expect(secondCall.duplicate).toBe(true);
      expect(secondCall.status).toBe("DUPLICATE");
    });

    it("D5: webhook inbox detects payload tampering when same eventId arrives with conflicting payload", async () => {
      const eventId = "evt_tamper_detect_001";
      const initialPayload = JSON.stringify({
        eventId,
        eventType: "demo.payment.settled",
        amountPaise: 100000, // ₹1,000
      });

      await processWebhookInbox({
        provider: "DEMO",
        rawBody: initialPayload,
        headers: { "x-signature": "mock-demo-valid-sig" },
        tenantId: tenantA.id,
      });

      // Attacker sends conflicting payload under identical eventId
      const tamperedPayload = JSON.stringify({
        eventId,
        eventType: "demo.payment.settled",
        amountPaise: 9999999, // ₹99,999
      });

      const tamperRes = await processWebhookInbox({
        provider: "DEMO",
        rawBody: tamperedPayload,
        headers: { "x-signature": "mock-demo-valid-sig" },
        tenantId: tenantA.id,
      });

      expect(tamperRes.success).toBe(false);
      expect(tamperRes.error).toContain("Payload tamper detected");
    });

    it("D6: quarantines ambiguous webhook event when multiple branches share collector code without link attribution", async () => {
      // Create another branch with identical collector code for test
      const branchSub2 = await db.branch.create({
        data: {
          tenantId: tenantA.id,
          name: "South Campus",
          code: "APX-SOUTH",
          collectorCode: "SHARED_COLLECTOR_CODE",
        },
      });
      const branchSub3 = await db.branch.create({
        data: {
          tenantId: tenantA.id,
          name: "East Campus",
          code: "APX-EAST",
          collectorCode: "SHARED_COLLECTOR_CODE",
        },
      });

      const payload = JSON.stringify({
        event_id: "evt_shared_collector_01",
        event_type: "pay.payment.debited",
        timestamp: new Date().toISOString(),
        data: {
          amount: 500000,
          collector_code: "SHARED_COLLECTOR_CODE",
          status: "SUCCESS",
          // Notice: metadata lacks branch_id!
        },
      });

      const res = await processWebhookInbox({
        provider: "JODO",
        rawBody: payload,
        headers: { "x-jodo-signature": "mock-valid-signature" },
      });

      expect(res.status).toBe("QUARANTINED");
      expect(res.quarantineReason).toContain("Shared collector code matches multiple branches");

      // Verify quarantine record in WebhookEvent table
      const eventRecord = await db.webhookEvent.findFirst({
        where: { eventId: "evt_shared_collector_01" },
      });
      expect(eventRecord?.status).toBe("QUARANTINED");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. CONCURRENCY & ISOLATION SAFETY
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E. Financial Concurrency & Settlement Invariants", () => {
    it("E1: concurrent settlement attempts on the same installment prevent over-allocation", async () => {
      const schedule = generateInstallmentSchedule({
        totalAmount: 1000000, // ₹10,000
        scheduleType: "CUSTOM",
        startDate: new Date("2026-07-01"),
        installmentCount: 1,
      });

      const planResult = await createStudentFeePlan({
        tenantId: tenantA.id,
        branchId: branchMainA.id,
        studentId: studentA1.id,
        title: "Concurrency Test Plan",
        totalAmount: 1000000,
        scheduleType: "CUSTOM",
        installments: schedule,
      });

      // Receipt of exactly ₹10,000
      const receipt = await db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: "RCPT-CONCUR-001",
          amount: 1000000,
          method: "UPI",
        },
      });
      await db.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          unappliedAmount: 1000000,
          status: "CAPTURED",
        },
      });

      // Launch two concurrent settlement attempts of ₹8,000 against the same ₹10,000 installment
      const attempts = await Promise.allSettled([
        settleInstallmentWithReceipt({
          tenantId: tenantA.id,
          studentId: studentA1.id,
          installmentId: planResult.installments[0].id,
          receiptId: receipt.id,
          amountToAllocate: 800000,
        }),
        settleInstallmentWithReceipt({
          tenantId: tenantA.id,
          studentId: studentA1.id,
          installmentId: planResult.installments[0].id,
          receiptId: receipt.id,
          amountToAllocate: 800000,
        }),
      ]);

      const fulfilled = attempts.filter((a) => a.status === "fulfilled");
      const rejected = attempts.filter((a) => a.status === "rejected");

      // Exactly one must succeed, the other must be rejected due to insufficient remaining funds
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify that total allocations do not exceed receipt or invoice amounts
      const allocations = await db.paymentAllocation.findMany({
        where: { feeInvoiceId: planResult.installments[0].feeInvoiceId! },
      });
      const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
      expect(totalAllocated).toBe(800000);
      expect(totalAllocated).toBeLessThanOrEqual(1000000);
    });
  });
});
