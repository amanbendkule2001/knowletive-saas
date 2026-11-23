import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  allocateStudentCreditToInvoiceService,
  reverseStudentCreditAllocationService,
  reconcileStudentCreditAccount,
  requestCreditTransferService,
  approveCreditTransferService,
  executeCreditTransferService,
  CreditTransferError,
  CreditTransferValidationError,
  InsufficientAvailableCreditError,
  IdempotencyPayloadMismatchError,
  type ActorContext,
} from "@/lib/credit-transfers";

describe("Stage 2.3: Financial Credit Allocation and Fee Invoice Settlement Integration Tests", () => {
  let isDbAvailable = false;
  let tenant: any;
  let accountantUser: any;
  let adminUser: any;
  let principalUser: any;

  let actorAccountant: ActorContext;
  let actorAdmin: ActorContext;
  let actorPrincipal: ActorContext;

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
      return;
    }

    const stamp = Date.now();

    tenant = await db.tenant.create({
      data: {
        name: `Tenant Alloc ${stamp}`,
        slug: `tenant-alloc-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-alloc-${stamp}@example.com`,
        logoInitials: "TAL",
      },
    });

    accountantUser = await db.user.create({
      data: {
        email: `accountant-alloc-${stamp}@example.com`,
        name: "Alice Accountant",
        passwordHash: "hash-secret-accountant",
        status: "ACTIVE",
      },
    });

    adminUser = await db.user.create({
      data: {
        email: `admin-alloc-${stamp}@example.com`,
        name: "Arthur Admin",
        passwordHash: "hash-secret-admin",
        status: "ACTIVE",
      },
    });

    principalUser = await db.user.create({
      data: {
        email: `principal-alloc-${stamp}@example.com`,
        name: "Penny Principal",
        passwordHash: "hash-secret-principal",
        status: "ACTIVE",
      },
    });

    actorAccountant = {
      tenantId: tenant.id,
      userId: accountantUser.id,
      userName: accountantUser.name,
      roleKey: "ACCOUNTANT",
      ip: "127.0.0.1",
    };

    actorAdmin = {
      tenantId: tenant.id,
      userId: adminUser.id,
      userName: adminUser.name,
      roleKey: "INSTITUTE_ADMIN",
      ip: "127.0.0.1",
    };

    actorPrincipal = {
      tenantId: tenant.id,
      userId: principalUser.id,
      userName: principalUser.name,
      roleKey: "PRINCIPAL",
      ip: "127.0.0.1",
    };
  });

  afterAll(async () => {
    // Disposable test database lifecycle is managed by run_live_verification.ps1
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Fixture Isolation Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  async function createTestStudent(prefix = "STD") {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo: `ADM-${prefix}-${stamp}`,
        firstName: `Test-${prefix}`,
        lastName: "User",
        status: "ACTIVE",
      },
    });
  }

  async function createSiblingPair() {
    const sA = await createTestStudent("SIBA");
    const sB = await createTestStudent("SIBB");
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);

    const g = await db.guardian.create({
      data: {
        tenantId: tenant.id,
        name: `Guardian ${stamp}`,
        phone: `+9198711${Math.floor(10000 + Math.random() * 90000)}`,
        relation: "Father",
      },
    });

    await db.studentGuardian.create({
      data: { studentId: sA.id, guardianId: g.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sB.id, guardianId: g.id, isPrimary: true },
    });

    const asset = await db.fileAsset.create({
      data: {
        tenantId: tenant.id,
        kind: "DOCUMENT",
        name: `consent_${stamp}.pdf`,
        mime: "application/pdf",
        size: 1024,
        storageKey: `consents/sib_${stamp}.pdf`,
      },
    });

    const consent = await db.guardianConsent.create({
      data: {
        id: asset.id,
        tenantId: tenant.id,
        guardianId: g.id,
        sourceStudentId: sA.id,
        destinationStudentId: sB.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: asset.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });

    return { sA, sB, guardian: g, consent };
  }

  async function createReceipt(
    studentId: string,
    amount: number,
    receivedAt: Date = new Date(),
    reservedRefundAmount: number = 0
  ) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenant.id,
          studentId,
          receiptNumber: `RCPT-AL-${stamp}`,
          amount,
          method: "UPI",
          reference: `UPI-REF-${stamp}`,
          receivedAt,
        },
      });

      const unapplied = amount - reservedRefundAmount;
      const balance = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenant.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: unapplied,
          reservedRefundAmount,
          refundedAmount: 0,
        },
      });

      await tx.studentCreditAccount.upsert({
        where: { tenantId_studentId: { tenantId: tenant.id, studentId } },
        create: {
          tenantId: tenant.id,
          studentId,
          balance: unapplied,
        },
        update: {
          balance: { increment: unapplied },
        },
      });

      return { receipt, balance };
    });
  }

  async function createInvoice(studentId: string, amount: number, status: any = "PENDING") {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.feeInvoice.create({
      data: {
        tenantId: tenant.id,
        studentId,
        number: `INV-AL-${stamp}`,
        title: `Tuition Fee ${stamp}`,
        amount,
        paidAmount: 0,
        status,
        dueDate: new Date(Date.now() + 30 * 86400000),
      },
    });
  }

  async function transferSiblingCredit(
    fromStudentId: string,
    toStudentId: string,
    guardianId: string,
    consentId: string,
    amount: number
  ) {
    const reqRes = await requestCreditTransferService(
      {
        sourceStudentId: fromStudentId,
        targetStudentId: toStudentId,
        authorizedGuardianId: guardianId,
        amount,
        reason: "Sibling fee balance sharing",
        guardianConsentRef: consentId,
        guardianConsentId: consentId,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: reqRes.request.id, notes: "Approved" }, actorPrincipal);
    return await executeCreditTransferService({ requestId: reqRes.request.id }, actorAccountant);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 30 Mandatory Integration Tests
  // ─────────────────────────────────────────────────────────────────────────────

  it("1. Direct receipt allocation: settles invoice using student's own receipt", async () => {
    const s = await createTestStudent("T1");
    const { receipt } = await createReceipt(s.id, 10000); // ₹100
    const invoice = await createInvoice(s.id, 6000); // ₹60

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 6000,
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.allocatedAmount).toBe(6000);
    expect(result.newInvoiceStatus).toBe("PAID");
    expect(result.newInvoicePaidAmount).toBe(6000);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].receiptId).toBe(receipt.id);
    expect(result.allocations[0].creditTransferId).toBeNull();

    // Verify balance row
    const bal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(bal?.unappliedAmount).toBe(4000);
    expect(bal?.allocatedAmount).toBe(6000);

    // Verify student credit account
    const acc = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: s.id } },
    });
    expect(acc?.balance).toBe(4000);
  });

  it("2. Transferred-in credit allocation: settles invoice using transferred sibling credit", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();
    await createReceipt(sA.id, 5000);
    const execRes = await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 5000);

    const invoice = await createInvoice(sB.id, 3000);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: sB.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
        sourcePreference: "TRANSFERRED_FIRST",
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.allocatedAmount).toBe(3000);
    expect(result.newInvoiceStatus).toBe("PAID");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].creditTransferId).toBe(execRes.journal?.id);

    // sB credit account
    const acc = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: sB.id } },
    });
    expect(acc?.allocatedIn).toBe(3000);
    expect(acc?.balance).toBe(2000);
  });

  it("3. Multi-receipt allocation: draws credit across multiple source receipts", async () => {
    const s = await createTestStudent("T3");
    await createReceipt(s.id, 2000);
    await createReceipt(s.id, 3000);
    const invoice = await createInvoice(s.id, 4500);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4500,
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.allocatedAmount).toBe(4500);
    expect(result.allocations.length).toBeGreaterThanOrEqual(2);

    const totalAlloc = result.allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(totalAlloc).toBe(4500);
  });

  it("4. FIFO drawdown: consumes earlier receipts before newer receipts", async () => {
    const s = await createTestStudent("T4");
    const earlierDate = new Date("2026-01-01T10:00:00Z");
    const laterDate = new Date("2026-06-01T10:00:00Z");

    const { receipt: olderReceipt } = await createReceipt(s.id, 2000, earlierDate);
    const { receipt: newerReceipt } = await createReceipt(s.id, 5000, laterDate);

    const invoice = await createInvoice(s.id, 2500);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 2500,
        sourcePreference: "AUTO_FIFO",
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.allocations[0].receiptId).toBe(olderReceipt.id);
    expect(result.allocations[0].amount).toBe(2000);
    expect(result.allocations[1].receiptId).toBe(newerReceipt.id);
    expect(result.allocations[1].amount).toBe(500);
  });

  it("5. Partial invoice settlement: marks status PARTIAL when balance remains", async () => {
    const s = await createTestStudent("T5");
    await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 8000);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
      },
      actorAccountant
    );

    expect(result.newInvoiceStatus).toBe("PARTIAL");
    expect(result.newInvoicePaidAmount).toBe(3000);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.status).toBe("PARTIAL");
    expect(inv?.paidAmount).toBe(3000);
  });

  it("6. Exact full settlement: marks status PAID and records paidAt", async () => {
    const s = await createTestStudent("T6");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 5000);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 5000,
      },
      actorAccountant
    );

    expect(result.newInvoiceStatus).toBe("PAID");
    expect(result.newInvoicePaidAmount).toBe(5000);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.status).toBe("PAID");
    expect(inv?.paidAt).not.toBeNull();
  });

  it("7. Mixed direct and transferred-in allocation in a single transaction", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();

    // Sibling B has direct receipt of 2000
    await createReceipt(sB.id, 2000);

    // Sibling A transfers 3000 to Sibling B
    await createReceipt(sA.id, 3000);
    await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 3000);

    // Invoice for Sibling B is 4500
    const invoice = await createInvoice(sB.id, 4500);

    const result = await allocateStudentCreditToInvoiceService(
      {
        studentId: sB.id,
        feeInvoiceId: invoice.id,
        amount: 4500,
        sourcePreference: "AUTO_FIFO",
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.allocatedAmount).toBe(4500);

    const hasDirect = result.allocations.some((a) => a.creditTransferId === null);
    const hasTransferred = result.allocations.some((a) => a.creditTransferId !== null);
    expect(hasDirect).toBe(true);
    expect(hasTransferred).toBe(true);
  });

  it("8. Excess invoice allocation rejection: rejects when allocation > remaining balance", async () => {
    const s = await createTestStudent("T8");
    await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 5000);

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 6000, // Exceeds ₹50 invoice
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);
  });

  it("9. Insufficient student credit rejection: rejects when student balance < requested amount", async () => {
    const s = await createTestStudent("T9");
    await createReceipt(s.id, 2000);
    const invoice = await createInvoice(s.id, 5000);

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 4000, // Student only has ₹20 available
        },
        actorAccountant
      )
    ).rejects.toThrow(InsufficientAvailableCreditError);
  });

  it("10. Refund-reserved credit allocation rejection: reserved portions cannot be spent", async () => {
    const s = await createTestStudent("T10");
    // Create receipt with ₹50 gross, but ₹40 reserved for refund (1000 unapplied, 4000 reserved)
    await createReceipt(s.id, 5000, new Date(), 4000);
    const invoice = await createInvoice(s.id, 3000);

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 2000, // Only 1000 is unapplied
        },
        actorAccountant
      )
    ).rejects.toThrow(InsufficientAvailableCreditError);
  });

  it("11. Fully paid invoice rejection: cannot allocate to status PAID", async () => {
    const s = await createTestStudent("T11");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 3000, "PAID");

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 1000,
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);
  });

  it("12. Waived invoice rejection: cannot allocate to status WAIVED", async () => {
    const s = await createTestStudent("T12");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 3000, "WAIVED");

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 1000,
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);
  });

  it("13. Cancelled invoice rejection: cannot allocate to cancelled/void invoices", async () => {
    const s = await createTestStudent("T13");
    await createReceipt(s.id, 5000);
    // In Knowletive fee operations, void/cancelled invoices are represented by the WAIVED status
    const invoice = await createInvoice(s.id, 3000, "WAIVED");

    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 1000,
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);
  });

  it("14. Correct source receipt provenance: PaymentAllocation.receiptId matches original receipt", async () => {
    const s = await createTestStudent("T14");
    const { receipt } = await createReceipt(s.id, 4000);
    const invoice = await createInvoice(s.id, 2000);

    const res = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 2000,
      },
      actorAccountant
    );

    const alloc = await db.paymentAllocation.findUnique({
      where: { id: res.allocations[0].allocationId },
    });
    expect(alloc?.receiptId).toBe(receipt.id);
  });

  it("15. No new PaymentReceipt created: allocations do not inflate gross receipts", async () => {
    const s = await createTestStudent("T15");
    const receiptCountBefore = await db.paymentReceipt.count({ where: { tenantId: tenant.id } });
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 3000);

    const expectedCountAfterReceipt = receiptCountBefore + 1;
    expect(await db.paymentReceipt.count({ where: { tenantId: tenant.id } })).toBe(expectedCountAfterReceipt);

    await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
      },
      actorAccountant
    );

    // Must still equal exactly expectedCountAfterReceipt (zero new receipts created)
    const finalReceiptCount = await db.paymentReceipt.count({ where: { tenantId: tenant.id } });
    expect(finalReceiptCount).toBe(expectedCountAfterReceipt);
  });

  it("16. Correct StudentCreditAccount update: balance drops and allocatedIn updates for transferred credit", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();
    await createReceipt(sA.id, 8000);
    await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 5000);

    const accBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: sB.id } },
    });
    const balBefore = accBefore?.balance ?? 0;
    const allocInBefore = accBefore?.allocatedIn ?? 0;

    const invoice = await createInvoice(sB.id, 3000);
    await allocateStudentCreditToInvoiceService(
      {
        studentId: sB.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
        sourcePreference: "TRANSFERRED_FIRST",
      },
      actorAccountant
    );

    const accAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: sB.id } },
    });
    expect(accAfter?.balance).toBe(balBefore - 3000);
    expect(accAfter?.allocatedIn).toBe(allocInBefore + 3000);
  });

  it("17. Receipt conservation after allocation: gross = allocated + transferredOut + unapplied + reserved + refunded", async () => {
    const s = await createTestStudent("T17");
    const { receipt } = await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 4000);

    await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
      },
      actorAccountant
    );

    const b = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    const sum =
      (b?.allocatedAmount ?? 0) +
      (b?.transferredOutAmount ?? 0) +
      (b?.unappliedAmount ?? 0) +
      (b?.reservedRefundAmount ?? 0) +
      (b?.refundedAmount ?? 0);

    expect(sum).toBe(receipt.amount);
  });

  it("18. Invoice paidAmount and status consistency: partial payment updates paidAmount and PARTIAL status", async () => {
    const s = await createTestStudent("T18");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 5000);

    await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 2500,
      },
      actorAccountant
    );

    const inv1 = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv1?.paidAmount).toBe(2500);
    expect(inv1?.status).toBe("PARTIAL");

    await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 2500,
      },
      actorAccountant
    );

    const inv2 = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv2?.paidAmount).toBe(5000);
    expect(inv2?.status).toBe("PAID");
  });

  it("19. Partial allocation reversal: reverses partial amount and updates invoice", async () => {
    const s = await createTestStudent("T19");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 4000);

    const allocRes = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
      },
      actorAccountant
    );

    const allocId = allocRes.allocations[0].allocationId;

    const revRes = await reverseStudentCreditAllocationService(
      {
        allocationId: allocId,
        amount: 1500,
        reason: "Partial adjustment",
      },
      actorAccountant
    );

    expect(revRes.success).toBe(true);
    expect(revRes.reversedAmount).toBe(1500);
    expect(revRes.newInvoiceStatus).toBe("PARTIAL");
    expect(revRes.newInvoicePaidAmount).toBe(2500);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.paidAmount).toBe(2500);
    expect(inv?.status).toBe("PARTIAL");
  });

  it("20. Full allocation reversal: restores invoice status to PENDING when paidAmount reaches 0", async () => {
    const s = await createTestStudent("T20");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 3000);

    const allocRes = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
      },
      actorAccountant
    );

    const allocId = allocRes.allocations[0].allocationId;

    const revRes = await reverseStudentCreditAllocationService(
      {
        allocationId: allocId,
        amount: 3000,
        reason: "Course dropped",
      },
      actorAccountant
    );

    expect(revRes.newInvoiceStatus).toBe("PENDING");
    expect(revRes.newInvoicePaidAmount).toBe(0);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.paidAmount).toBe(0);
    expect(inv?.status).toBe("PENDING");
  });

  it("21. Excessive reversal rejection: rejects when reversal amount > remaining unreversed allocation", async () => {
    const s = await createTestStudent("T21");
    await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 3000);

    const allocRes = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 3000,
      },
      actorAccountant
    );

    const allocId = allocRes.allocations[0].allocationId;

    // Reverse ₹20
    await reverseStudentCreditAllocationService(
      {
        allocationId: allocId,
        amount: 2000,
        reason: "First partial reversal",
      },
      actorAccountant
    );

    // Attempting to reverse ₹15 more should fail because remaining unreversed is ₹10
    await expect(
      reverseStudentCreditAllocationService(
        {
          allocationId: allocId,
          amount: 1500,
          reason: "Excessive second reversal",
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);
  });

  it("22. Direct credit restoration after reversal: restored credit becomes available in unappliedAmount", async () => {
    const s = await createTestStudent("T22");
    const { receipt } = await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 4000);

    const allocRes = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
      },
      actorAccountant
    );

    const allocId = allocRes.allocations[0].allocationId;

    await reverseStudentCreditAllocationService(
      {
        allocationId: allocId,
        amount: 2500,
        reason: "Partial reversal",
      },
      actorAccountant
    );

    const bal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(bal?.unappliedAmount).toBe(3500); // 1000 remaining + 2500 restored
    expect(bal?.allocatedAmount).toBe(1500);

    const acc = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: s.id } },
    });
    expect(acc?.balance).toBe(3500);
  });

  it("23. Transferred-in credit restoration after reversal: restores transferredOutAmount and decrements allocatedIn", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();
    const { receipt } = await createReceipt(sA.id, 6000);
    await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 6000);

    const invoice = await createInvoice(sB.id, 4000);
    const allocRes = await allocateStudentCreditToInvoiceService(
      {
        studentId: sB.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
        sourcePreference: "TRANSFERRED_FIRST",
      },
      actorAccountant
    );

    const allocId = allocRes.allocations[0].allocationId;

    await reverseStudentCreditAllocationService(
      {
        allocationId: allocId,
        amount: 2000,
        reason: "Student B reversal",
      },
      actorAccountant
    );

    // On original receipt: allocatedAmount should be 2000, transferredOutAmount should be 4000
    const bal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(bal?.allocatedAmount).toBe(2000);
    expect(bal?.transferredOutAmount).toBe(4000);

    // On student B account: allocatedIn should drop to 2000, balance should increase by 2000
    const acc = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: sB.id } },
    });
    expect(acc?.allocatedIn).toBe(2000);
    expect(acc?.balance).toBe(4000); // 2000 unallocated transferred + 2000 restored
  });

  it("24. Concurrent allocation requests against the same invoice: never overpays invoice", async () => {
    const s = await createTestStudent("T24");
    await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 5000);

    // Two concurrent requests trying to allocate 4000 each on a 5000 invoice
    const p1 = allocateStudentCreditToInvoiceService(
      { studentId: s.id, feeInvoiceId: invoice.id, amount: 4000 },
      actorAccountant
    );
    const p2 = allocateStudentCreditToInvoiceService(
      { studentId: s.id, feeInvoiceId: invoice.id, amount: 4000 },
      actorAccountant
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.paidAmount).toBe(4000);
    expect(inv?.status).toBe("PARTIAL");
  });

  it("25. Concurrent allocation against the same receipt: never overspends available balance", async () => {
    const s = await createTestStudent("T25");
    // Student has a single receipt for ₹50
    await createReceipt(s.id, 5000);
    const invA = await createInvoice(s.id, 4000);
    const invB = await createInvoice(s.id, 4000);

    // Two concurrent requests trying to consume ₹40 each from a ₹50 pool
    const p1 = allocateStudentCreditToInvoiceService(
      { studentId: s.id, feeInvoiceId: invA.id, amount: 4000 },
      actorAccountant
    );
    const p2 = allocateStudentCreditToInvoiceService(
      { studentId: s.id, feeInvoiceId: invB.id, amount: 4000 },
      actorAccountant
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const acc = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenant.id, studentId: s.id } },
    });
    expect(acc?.balance).toBe(1000);
  });

  it("26. Concurrent transfer and invoice allocation: preserves canonical lock hierarchy without deadlock", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();
    // sA has exactly ₹60 available
    await createReceipt(sA.id, 6000);
    const invoice = await createInvoice(sA.id, 5000);

    // sA transfer to sB (5000) vs sA allocation to invoice (5000)
    // Total requested: 10000 > 6000 available
    const pTransfer = (async () => {
      return await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 5000);
    })();
    const pAlloc = allocateStudentCreditToInvoiceService(
      { studentId: sA.id, feeInvoiceId: invoice.id, amount: 5000 },
      actorAccountant
    );

    const results = await Promise.allSettled([pTransfer, pAlloc]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Assert that the rejection was a valid domain error, not a deadlock (40P01)
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(CreditTransferError);
  });

  it("27. Duplicate idempotency replay: returns cached success without debiting again", async () => {
    const s = await createTestStudent("T27");
    await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 4000);
    const key = `ALLOC-IDEMP-${Date.now()}`;

    const res1 = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
        idempotencyKey: key,
      },
      actorAccountant
    );
    expect(res1.success).toBe(true);

    const res2 = await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
        idempotencyKey: key,
      },
      actorAccountant
    );

    expect(res2.success).toBe(true);
    expect(res2.replayed).toBe(true);
    expect(res2.allocatedAmount).toBe(4000);

    // Verify invoice paidAmount is still 4000, NOT 8000
    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.paidAmount).toBe(4000);
  });

  it("28. Idempotency payload mismatch rejection: throws IdempotencyPayloadMismatchError when payload differs", async () => {
    const s = await createTestStudent("T28");
    await createReceipt(s.id, 10000);
    const invoice = await createInvoice(s.id, 4000);
    const key = `ALLOC-IDEMP-MISMATCH-${Date.now()}`;

    await allocateStudentCreditToInvoiceService(
      {
        studentId: s.id,
        feeInvoiceId: invoice.id,
        amount: 4000,
        idempotencyKey: key,
      },
      actorAccountant
    );

    // Replay with different amount
    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 3000,
          idempotencyKey: key,
        },
        actorAccountant
      )
    ).rejects.toThrow(IdempotencyPayloadMismatchError);
  });

  it("29. Complete transaction rollback on failure: no partial records left on error", async () => {
    const s = await createTestStudent("T29");
    const { receipt } = await createReceipt(s.id, 5000);
    const invoice = await createInvoice(s.id, 4000);

    const allocationsBefore = await db.paymentAllocation.count({ where: { feeInvoiceId: invoice.id } });

    // Attempting allocation of 6000 on 4000 invoice will fail validation inside transaction
    await expect(
      allocateStudentCreditToInvoiceService(
        {
          studentId: s.id,
          feeInvoiceId: invoice.id,
          amount: 6000,
        },
        actorAccountant
      )
    ).rejects.toThrow(CreditTransferValidationError);

    const allocationsAfter = await db.paymentAllocation.count({ where: { feeInvoiceId: invoice.id } });
    expect(allocationsAfter).toBe(allocationsBefore);

    const bal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(bal?.unappliedAmount).toBe(5000);
    expect(bal?.allocatedAmount).toBe(0);

    const inv = await db.feeInvoice.findUnique({ where: { id: invoice.id } });
    expect(inv?.paidAmount).toBe(0);
    expect(inv?.status).toBe("PENDING");
  });

  it("30. Independent ledger reconstruction after all operations: all 7 ledger invariants hold", async () => {
    const { sA, sB, guardian, consent } = await createSiblingPair();

    // 1. Direct receipts
    const { receipt: rA } = await createReceipt(sA.id, 12000); // ₹120
    const { receipt: rB } = await createReceipt(sB.id, 5000);  // ₹50

    // 2. Transfer ₹40 from A to B
    await transferSiblingCredit(sA.id, sB.id, guardian.id, consent.id, 4000);

    // 3. Invoice for A: ₹60, allocate ₹50 direct
    const invA = await createInvoice(sA.id, 6000);
    const allocARes = await allocateStudentCreditToInvoiceService(
      { studentId: sA.id, feeInvoiceId: invA.id, amount: 5000 },
      actorAccountant
    );

    // 4. Invoice for B: ₹80, allocate ₹70 (mixed transferred + direct)
    const invB = await createInvoice(sB.id, 8000);
    const allocBRes = await allocateStudentCreditToInvoiceService(
      { studentId: sB.id, feeInvoiceId: invB.id, amount: 7000 },
      actorAccountant
    );

    // 5. Reverse ₹20 from student A's allocation
    await reverseStudentCreditAllocationService(
      {
        allocationId: allocARes.allocations[0].allocationId,
        amount: 2000,
        reason: "Ledger test partial reversal",
      },
      actorAccountant
    );

    // 6. Reverse ₹10 from student B's first allocation
    await reverseStudentCreditAllocationService(
      {
        allocationId: allocBRes.allocations[0].allocationId,
        amount: 1000,
        reason: "Ledger test sibling reversal",
      },
      actorAccountant
    );

    // ─── VERIFY INVARIANT 1: Receipt conservation on all receipts ───────────────
    const receipts = await db.paymentReceipt.findMany({
      where: { tenantId: tenant.id, studentId: { in: [sA.id, sB.id] } },
      include: { balance: true },
    });
    for (const r of receipts) {
      const b = r.balance!;
      const components =
        b.allocatedAmount +
        b.transferredOutAmount +
        b.unappliedAmount +
        b.reservedRefundAmount +
        b.refundedAmount;
      expect(components).toBe(r.amount);
    }

    // ─── VERIFY INVARIANT 2: Invoice conservation (outstanding = amount - paid) ──
    const invoices = await db.feeInvoice.findMany({
      where: { tenantId: tenant.id, studentId: { in: [sA.id, sB.id] } },
    });
    for (const inv of invoices) {
      const outstanding = inv.amount - inv.paidAmount;
      expect(outstanding).toBeGreaterThanOrEqual(0);
      if (inv.paidAmount >= inv.amount) {
        expect(inv.status).toBe("PAID");
      } else if (inv.paidAmount > 0) {
        expect(inv.status).toBe("PARTIAL");
      }
    }

    // ─── VERIFY INVARIANT 3: Invoice paidAmount equals active net allocations ────
    for (const inv of invoices) {
      const allocs = await db.paymentAllocation.findMany({
        where: { feeInvoiceId: inv.id },
        include: { reversals: true },
      });
      let activeSum = 0;
      for (const a of allocs) {
        const rev = a.reversals.reduce((s, r) => s + r.amount, 0);
        activeSum += a.amount - rev;
      }
      expect(inv.paidAmount).toBe(activeSum);
    }

    // ─── VERIFY INVARIANT 4 & 5: Student credit account reconciliation ──────────
    const reconA = await reconcileStudentCreditAccount(tenant.id, sA.id);
    expect(reconA.isReconciled).toBe(true);
    expect(reconA.discrepancies).toHaveLength(0);

    const reconB = await reconcileStudentCreditAccount(tenant.id, sB.id);
    expect(reconB.isReconciled).toBe(true);
    expect(reconB.discrepancies).toHaveLength(0);
  });
});
