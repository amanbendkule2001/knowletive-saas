import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("Stage 2.1.1: Credit Transfer Lifecycle & Multi-Receipt Provenance Integration Tests", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any; // Sibling 1 (Source)
  let studentA2: any; // Sibling 2 (Target)
  let studentB1: any; // Tenant B student
  let invoiceA2: any; // Invoice for Target Sibling

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
      return;
    }

    const stamp = Date.now();

    tenantA = await db.tenant.create({
      data: {
        name: `Tenant Lifecycle A ${stamp}`,
        slug: `tenant-lc-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-lc-a-${stamp}@example.com`,
        logoInitials: "TLA",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Lifecycle B ${stamp}`,
        slug: `tenant-lc-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-lc-b-${stamp}@example.com`,
        logoInitials: "TLB",
      },
    });

    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-LC-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Kapoor",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-LC-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Kapoor",
        status: "ACTIVE",
      },
    });

    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-LC-B1-${stamp}`,
        firstName: "Kabir",
        lastName: "Das",
        status: "ACTIVE",
      },
    });

    invoiceA2 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA2.id,
        number: `INV-LC-A2-${stamp}`,
        title: "Ananya Term Fee",
        amount: 300000, // ₹3,000
        dueDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    try {
      if (tenantA?.id) await db.tenant.delete({ where: { id: tenantA.id } });
      if (tenantB?.id) await db.tenant.delete({ where: { id: tenantB.id } });
    } catch {
      // Best effort cleanup (RESTRICT triggers prevent cascade delete if financial history exists)
    }
  });

  async function createReceiptWithBalance(amount: number, studentId: string = studentA1.id, tenantId: string = tenantA.id) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId,
          studentId,
          receiptNumber: `RCPT-LC-${stamp}`,
          amount,
          method: "BANK_TRANSFER",
          reference: `UTR-${stamp}`,
        },
      });

      const balance = await tx.paymentReceiptBalance.create({
        data: {
          tenantId,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: amount,
          reservedRefundAmount: 0,
          refundedAmount: 0,
          status: "OVERPAID_UNALLOCATED",
        },
      });

      return { receipt, balance };
    });
  }

  // 1. Pending request can be created without ledger postings
  it("1. Pending request can be created without ledger postings", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const req = await db.creditTransferRequest.create({
      data: {
        tenantId: tenantA.id,
        requestNumber: `CREQ-${stamp}`,
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 200000,
        reason: "Cross-sibling adjustment",
        status: "PENDING_APPROVAL",
        requestedById: "usr_accountant",
      },
    });

    expect(req.id).toBeDefined();
    expect(req.status).toBe("PENDING_APPROVAL");
    expect(req.journalId).toBeNull();

    // Verify zero postings exist for this request
    const postings = await db.creditTransferPosting.findMany({
      where: { tenantId: tenantA.id, studentId: studentA1.id },
    });
    expect(postings).toHaveLength(0);
  });

  // 2. Pending request does not change source or target balances
  it("2. Pending request does not change source or target balances", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt, balance } = await createReceiptWithBalance(500000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const sourceAccount = await db.studentCreditAccount.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        balance: 500000,
      },
    });

    const targetAccount = await db.studentCreditAccount.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA2.id,
        balance: 0,
      },
    });

    // Create pending request
    await db.creditTransferRequest.create({
      data: {
        tenantId: tenantA.id,
        requestNumber: `CREQ-BAL-${stamp}`,
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 200000,
        reason: "Pending balance check",
        status: "PENDING_APPROVAL",
        requestedById: "usr_accountant",
      },
    });

    // Verify receipt balance unchanged
    const currentRcptBalance = await db.paymentReceiptBalance.findUnique({
      where: { receiptId: receipt.id },
    });
    expect(currentRcptBalance?.unappliedAmount).toBe(500000);
    expect(currentRcptBalance?.transferredOutAmount).toBe(0);

    // Verify student accounts unchanged
    const currentSource = await db.studentCreditAccount.findUnique({ where: { id: sourceAccount.id } });
    const currentTarget = await db.studentCreditAccount.findUnique({ where: { id: targetAccount.id } });
    expect(currentSource?.balance).toBe(500000);
    expect(currentTarget?.balance).toBe(0);
  });

  // 3. Rejected request does not create completed financial postings
  it("3. Rejected request does not create completed financial postings", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const req = await db.creditTransferRequest.create({
      data: {
        tenantId: tenantA.id,
        requestNumber: `CREQ-REJ-${stamp}`,
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 150000,
        reason: "Request to reject",
        status: "PENDING_APPROVAL",
        requestedById: "usr_accountant",
      },
    });

    // Reviewer rejects the request
    const rejectedReq = await db.$transaction(async (tx) => {
      const r = await tx.creditTransferRequest.update({
        where: { id: req.id },
        data: {
          status: "REJECTED",
          reviewedById: "usr_principal",
          reviewedAt: new Date(),
          rejectionReason: "Guardian consent document missing",
        },
      });

      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId: tenantA.id,
          requestId: req.id,
          action: "REJECTED",
          actorId: "usr_principal",
          notes: "Guardian consent document missing",
        },
      });

      return r;
    });

    expect(rejectedReq.status).toBe("REJECTED");
    expect(rejectedReq.rejectionReason).toBe("Guardian consent document missing");

    // Verify zero postings or journals exist
    const journals = await db.creditTransferJournal.findMany({
      where: { requestId: req.id },
    });
    expect(journals).toHaveLength(0);
  });

  // 4. Unauthorized execution is rejected by the service/database boundary as designed
  it("4. Unauthorized execution is rejected by lifecycle guard", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // 4a. Cannot transition from REJECTED to EXECUTED
    const req = await db.creditTransferRequest.create({
      data: {
        tenantId: tenantA.id,
        requestNumber: `CREQ-TERM-${stamp}`,
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 100000,
        reason: "Terminal test",
        status: "REJECTED",
        requestedById: "usr_accountant",
        reviewedById: "usr_principal",
        rejectionReason: "Invalid",
      },
    });

    await expect(
      db.creditTransferRequest.update({
        where: { id: req.id },
        data: { status: "EXECUTED" },
      })
    ).rejects.toThrow();

    // 4b. Cannot mutate immutable core request fields (amount, sourceStudentId, targetStudentId)
    await expect(
      db.creditTransferRequest.update({
        where: { id: req.id },
        data: { amount: 999999 },
      })
    ).rejects.toThrow();
  });

  // 5. Approved transfer can create its immutable journal and balanced postings atomically
  it("5. Approved transfer can create its immutable journal and balanced postings atomically", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // 1. Create and approve request
    const req = await db.creditTransferRequest.create({
      data: {
        tenantId: tenantA.id,
        requestNumber: `CREQ-APP-${stamp}`,
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 250000,
        reason: "Approved transfer",
        status: "APPROVED",
        requestedById: "usr_accountant",
        reviewedById: "usr_principal",
        reviewedAt: new Date(),
      },
    });

    // 2. Atomic execution: create journal, create balanced postings, update request to EXECUTED
    const result = await db.$transaction(async (tx) => {
      const journal = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-EXEC-${stamp}`,
          requestId: req.id,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 250000,
          reason: "Approved transfer execution",
          status: "COMPLETED",
          requestedById: "usr_accountant",
          approvedById: "usr_principal",
          executedAt: new Date(),
        },
      });

      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: journal.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receipt.id,
          amount: 250000,
        },
      });

      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: journal.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: receipt.id,
          amount: 250000,
        },
      });

      await tx.creditTransferRequest.update({
        where: { id: req.id },
        data: {
          status: "EXECUTED",
          journalId: journal.id,
        },
      });

      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId: tenantA.id,
          requestId: req.id,
          action: "EXECUTED",
          actorId: "usr_accountant",
          notes: `Executed via journal ${journal.id}`,
        },
      });

      return journal;
    });

    expect(result.id).toBeDefined();
    expect(result.amount).toBe(250000);
    expect(result.requestId).toBe(req.id);

    const updatedReq = await db.creditTransferRequest.findUnique({ where: { id: req.id } });
    expect(updatedReq?.status).toBe("EXECUTED");
    expect(updatedReq?.journalId).toBe(result.id);
  });

  // 6. Completed journal cannot be updated or deleted
  it("6. Completed journal cannot be updated or deleted", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-IMM-J-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 100000,
          reason: "Immutability check",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receipt.id,
          amount: 100000,
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: receipt.id,
          amount: 100000,
        },
      });
      return j;
    });

    // UPDATE rejected
    await expect(
      db.creditTransferJournal.update({
        where: { id: journal.id },
        data: { amount: 999999 },
      })
    ).rejects.toThrow();

    // DELETE rejected
    await expect(
      db.creditTransferJournal.delete({
        where: { id: journal.id },
      })
    ).rejects.toThrow();
  });

  // 7. Posting cannot be inserted for an uncompleted/nonexistent journal
  it("7. Posting cannot be inserted for a nonexistent journal", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(200000);

    await expect(
      db.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: "nonexistent-journal-id",
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receipt.id,
          amount: 100000,
        },
      })
    ).rejects.toThrow();
  });

  // 8. Missing debit or credit posting is rejected at commit
  it("8. Missing debit or credit posting is rejected at commit", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-MISS-${stamp}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            sourceReceiptId: receipt.id,
            amount: 150000,
            reason: "Missing credit test",
            status: "COMPLETED",
            requestedById: "usr_accountant",
          },
        });
        // Only DEBIT inserted; CREDIT is omitted!
        await tx.creditTransferPosting.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            entryType: "DEBIT",
            studentId: studentA1.id,
            counterpartyStudentId: studentA2.id,
            receiptId: receipt.id,
            amount: 150000,
          },
        });
      })
    ).rejects.toThrow();
  });

  // 9. Unbalanced postings are rejected
  it("9. Unbalanced postings are rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-UNB-P-${stamp}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            sourceReceiptId: receipt.id,
            amount: 200000,
            reason: "Unbalanced amount test",
            status: "COMPLETED",
            requestedById: "usr_accountant",
          },
        });
        await tx.creditTransferPosting.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            entryType: "DEBIT",
            studentId: studentA1.id,
            counterpartyStudentId: studentA2.id,
            receiptId: receipt.id,
            amount: 200000,
          },
        });
        await tx.creditTransferPosting.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            entryType: "CREDIT",
            studentId: studentA2.id,
            counterpartyStudentId: studentA1.id,
            receiptId: receipt.id,
            amount: 100000, // Mismatched!
          },
        });
      })
    ).rejects.toThrow();
  });

  // 10. Exact posting totals match the completed transfer amount
  it("10. Exact posting totals match the completed transfer amount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(500000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-EXACT-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 300000,
          reason: "Exact match test",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receipt.id,
          amount: 300000,
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: receipt.id,
          amount: 300000,
        },
      });
      return j;
    });

    const postings = await db.creditTransferPosting.findMany({ where: { journalId: journal.id } });
    const debitSum = postings.filter((p) => p.entryType === "DEBIT").reduce((s, p) => s + p.amount, 0);
    const creditSum = postings.filter((p) => p.entryType === "CREDIT").reduce((s, p) => s + p.amount, 0);

    expect(debitSum).toBe(300000);
    expect(creditSum).toBe(300000);
    expect(journal.amount).toBe(300000);
  });

  // 11. Multi-receipt FIFO source allocation preserves every original receipt ID
  it("11. Multi-receipt FIFO source allocation preserves every original receipt ID (₹1000 + ₹1500 + ₹500 = ₹3000)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    // 3 distinct receipts for student A1
    const { receipt: rcptA } = await createReceiptWithBalance(100000); // ₹1,000
    const { receipt: rcptB } = await createReceiptWithBalance(150000); // ₹1,500
    const { receipt: rcptC } = await createReceiptWithBalance(50000);  // ₹500
    const totalTransfer = 300000; // ₹3,000
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      // 1. Create multi-receipt completed journal (sourceReceiptId is null)
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-MULTI-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: totalTransfer,
          reason: "Multi-receipt FIFO transfer",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });

      // 2. Insert 3 source allocation lines
      const lineA = await tx.creditTransferSourceAllocation.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceReceiptId: rcptA.id,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 100000,
        },
      });

      const lineB = await tx.creditTransferSourceAllocation.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceReceiptId: rcptB.id,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 150000,
        },
      });

      const lineC = await tx.creditTransferSourceAllocation.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceReceiptId: rcptC.id,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 50000,
        },
      });

      // 3. Insert paired postings for each receipt
      // Receipt A postings
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineA.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: rcptA.id,
          amount: 100000,
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineA.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: rcptA.id,
          amount: 100000,
        },
      });

      // Receipt B postings
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineB.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: rcptB.id,
          amount: 150000,
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineB.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: rcptB.id,
          amount: 150000,
        },
      });

      // Receipt C postings
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineC.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: rcptC.id,
          amount: 50000,
        },
      });
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceAllocationId: lineC.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: rcptC.id,
          amount: 50000,
        },
      });

      // 4. Update receipt balances to reflect transferredOut
      await tx.paymentReceiptBalance.update({
        where: { receiptId: rcptA.id },
        data: { unappliedAmount: 0, transferredOutAmount: 100000 },
      });
      await tx.paymentReceiptBalance.update({
        where: { receiptId: rcptB.id },
        data: { unappliedAmount: 0, transferredOutAmount: 150000 },
      });
      await tx.paymentReceiptBalance.update({
        where: { receiptId: rcptC.id },
        data: { unappliedAmount: 0, transferredOutAmount: 50000 },
      });

      return j;
    });

    expect(journal.id).toBeDefined();
    expect(journal.amount).toBe(300000);

    // Verify source allocation lines
    const allocations = await db.creditTransferSourceAllocation.findMany({
      where: { journalId: journal.id },
    });
    expect(allocations).toHaveLength(3);
    const totalAllocPaise = allocations.reduce((s, a) => s + a.amount, 0);
    expect(totalAllocPaise).toBe(300000);

    // Verify postings
    const postings = await db.creditTransferPosting.findMany({
      where: { journalId: journal.id },
    });
    expect(postings).toHaveLength(6);
    expect(postings.filter((p) => p.receiptId === rcptA.id)).toHaveLength(2);
    expect(postings.filter((p) => p.receiptId === rcptB.id)).toHaveLength(2);
    expect(postings.filter((p) => p.receiptId === rcptC.id)).toHaveLength(2);
  });

  // 12. Transfer provenance cannot reference another tenant's receipt
  it("12. Transfer provenance cannot reference another tenant's receipt", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt: rcptB } = await createReceiptWithBalance(200000, studentB1.id, tenantB.id);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-CROSS-RCPT-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 200000,
          reason: "Cross tenant check",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });

      // Attempt source allocation with Tenant B receipt
      await tx.creditTransferSourceAllocation.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          sourceReceiptId: rcptB.id, // Cross-tenant!
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 200000,
        },
      });
      return j;
    }).catch((e) => e);

    expect(journal).toBeInstanceOf(Error);
  });

  // 13. Source account available credit decreases correctly
  it("13. Source account available credit decreases correctly", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const current = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA1.id } },
    });
    const initialBalance = current?.balance ?? 500000;

    const updated = await db.studentCreditAccount.update({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA1.id } },
      data: {
        balance: initialBalance - 200000,
        transferredOut: (current?.transferredOut ?? 0) + 200000,
      },
    });

    expect(updated.balance).toBe(initialBalance - 200000);
    expect(updated.transferredOut).toBe((current?.transferredOut ?? 0) + 200000);
  });

  // 14. Destination account available credit increases correctly
  it("14. Destination account available credit increases correctly", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const current = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA2.id } },
    });
    const initialBalance = current?.balance ?? 0;

    const updated = await db.studentCreditAccount.update({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA2.id } },
      data: {
        balance: initialBalance + 200000,
        transferredIn: (current?.transferredIn ?? 0) + 200000,
      },
    });

    expect(updated.balance).toBe(initialBalance + 200000);
    expect(updated.transferredIn).toBe((current?.transferredIn ?? 0) + 200000);
  });

  // 15. Total financial credit is conserved across internal transfer
  it("15. Total financial credit is conserved across internal transfer", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const source = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA1.id } },
    });
    const target = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: studentA2.id } },
    });

    // In tests 13 and 14, ₹2,000 was moved from source to target.
    // Total combined available balance must equal 500,000 paise (the initial ₹5,000 deposit)
    const totalCredit = (source?.balance ?? 0) + (target?.balance ?? 0);
    expect(totalCredit).toBe(500000);
  });

  // 16. Duplicate or invalid source allocation cannot consume credit twice
  it("16. Duplicate or invalid source allocation cannot consume credit twice", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const { receipt } = await createReceiptWithBalance(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // 16a. Duplicate source allocation for same (journalId, sourceReceiptId)
    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-DUP-${stamp}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            amount: 200000,
            reason: "Duplicate source allocation test",
            status: "COMPLETED",
            requestedById: "usr_accountant",
          },
        });

        // First allocation line for receipt
        await tx.creditTransferSourceAllocation.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            sourceReceiptId: receipt.id,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            amount: 100000,
          },
        });

        // Duplicate allocation line for SAME receipt in SAME journal!
        await tx.creditTransferSourceAllocation.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            sourceReceiptId: receipt.id, // Duplicate!
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            amount: 100000,
          },
        });
      })
    ).rejects.toThrow();

    // 16b. Source allocation line amount mismatch with postings rejected at commit
    const stamp2 = stamp + 1;
    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-MISMATCH-LINE-${stamp2}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            amount: 200000,
            reason: "Line amount mismatch test",
            status: "COMPLETED",
            requestedById: "usr_accountant",
          },
        });

        await tx.creditTransferSourceAllocation.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            sourceReceiptId: receipt.id,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            amount: 200000,
          },
        });

        // Postings for receipt only sum to 100000 instead of 200000
        await tx.creditTransferPosting.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            entryType: "DEBIT",
            studentId: studentA1.id,
            counterpartyStudentId: studentA2.id,
            receiptId: receipt.id,
            amount: 100000, // Mismatched with source allocation amount of 200000!
          },
        });

        await tx.creditTransferPosting.create({
          data: {
            tenantId: tenantA.id,
            journalId: j.id,
            entryType: "CREDIT",
            studentId: studentA2.id,
            counterpartyStudentId: studentA1.id,
            receiptId: receipt.id,
            amount: 100000,
          },
        });
      })
    ).rejects.toThrow();
  });
});
