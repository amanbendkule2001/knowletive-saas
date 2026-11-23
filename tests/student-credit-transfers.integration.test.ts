import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { PrismaClient } from "@prisma/client";

describe("Stage 2.1: Student Credit Accounts & Double-Entry Transfer Models Integration Tests", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any; // Sibling 1 (Aarav)
  let studentA2: any; // Sibling 2 (Ananya)
  let studentB1: any; // Student in Tenant B
  let invoiceA1: any;
  let invoiceA2: any;

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
      return;
    }

    const stamp = Date.now();

    // 1. Setup Tenant A
    tenantA = await db.tenant.create({
      data: {
        name: `Tenant Credit A ${stamp}`,
        slug: `tenant-credit-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-credit-a-${stamp}@example.com`,
        logoInitials: "TCA",
      },
    });

    // 2. Setup Tenant B (for cross-tenant checks)
    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Credit B ${stamp}`,
        slug: `tenant-credit-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-credit-b-${stamp}@example.com`,
        logoInitials: "TCB",
      },
    });

    // 3. Students in Tenant A
    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-CR-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-CR-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    // 4. Student in Tenant B
    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-CR-B1-${stamp}`,
        firstName: "Rohan",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    // 5. Invoices
    invoiceA1 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        number: `INV-CR-A1-${stamp}`,
        title: "Tuition Term 1",
        amount: 500000, // ₹5,000
        dueDate: new Date(),
      },
    });

    invoiceA2 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA2.id,
        number: `INV-CR-A2-${stamp}`,
        title: "Tuition Term 1 Sibling",
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
      // Best effort cleanup (RESTRICT triggers prevent cascade delete if receipts exist)
    }
  });

  // Helper to create an unapplied receipt & balance for studentA1
  async function createTestReceipt(amount: number) {
    const stamp = Date.now() + Math.floor(Math.random() * 100000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-CR-${stamp}`,
          amount: amount,
          method: "BANK_TRANSFER",
          reference: `UTR-${stamp}`,
        },
      });

      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: amount,
          reservedRefundAmount: 0,
          refundedAmount: 0,
          status: "OVERPAID_UNALLOCATED",
        },
      });

      return receipt;
    });
  }

  // 1. Same-tenant student credit account creation
  it("1. Same-tenant student credit account creation succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const account = await db.studentCreditAccount.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        balance: 100000, // ₹1,000
        status: "ACTIVE",
      },
    });

    expect(account.id).toBeDefined();
    expect(account.tenantId).toBe(tenantA.id);
    expect(account.studentId).toBe(studentA1.id);
    expect(account.balance).toBe(100000);
    expect(account.status).toBe("ACTIVE");
  });

  // 2. Duplicate account rejection for the same tenant/student
  it("2. Duplicate account rejection for the same tenant/student", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      db.studentCreditAccount.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id, // studentA1 already has an account from test 1
          balance: 50000,
        },
      })
    ).rejects.toThrow();
  });

  // 3. Cross-tenant account rejection
  it("3. Cross-tenant account rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Attempt to link Tenant A account to studentB1 (who belongs to Tenant B)
    await expect(
      db.studentCreditAccount.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentB1.id,
          balance: 0,
        },
      })
    ).rejects.toThrow();
  });

  // 4. Valid credit transfer journal creation
  it("4. Valid credit transfer journal creation succeeds with balanced postings", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(500000); // ₹5,000
    const transferAmount = 200000; // ₹2,000
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      // Create journal header
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          receiptProvenanceRef: `UTR-${stamp}`,
          amount: transferAmount,
          reason: "Cross-sibling fee adjustment",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });

      // Insert balanced DEBIT posting
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receipt.id,
          amount: transferAmount,
        },
      });

      // Insert balanced CREDIT posting
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: receipt.id,
          amount: transferAmount,
        },
      });

      return j;
    });

    expect(journal.id).toBeDefined();
    expect(journal.amount).toBe(transferAmount);
    expect(journal.status).toBe("COMPLETED");

    const postings = await db.creditTransferPosting.findMany({
      where: { journalId: journal.id },
    });
    expect(postings).toHaveLength(2);
    expect(postings.find((p) => p.entryType === "DEBIT")?.amount).toBe(transferAmount);
    expect(postings.find((p) => p.entryType === "CREDIT")?.amount).toBe(transferAmount);
  });

  // 5. Cross-tenant transfer rejection
  it("5. Cross-tenant transfer rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // Attempt to transfer from studentA1 (tenant A) to studentB1 (tenant B)
    await expect(
      db.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-CROSS-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentB1.id, // Cross-tenant!
          sourceReceiptId: receipt.id,
          amount: 100000,
          reason: "Cross-tenant attempt",
          requestedById: "usr_attacker",
        },
      })
    ).rejects.toThrow();
  });

  // 6. Invalid transfer amount rejection
  it("6. Invalid transfer amount rejection (amount <= 0 or same student)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // 6a. Zero amount
    await expect(
      db.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-ZERO-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 0, // Invalid!
          reason: "Zero amount",
          requestedById: "usr_accountant",
        },
      })
    ).rejects.toThrow();

    // 6b. Same student transfer
    await expect(
      db.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-SAME-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA1.id, // Same student!
          sourceReceiptId: receipt.id,
          amount: 100000,
          reason: "Self transfer",
          requestedById: "usr_accountant",
        },
      })
    ).rejects.toThrow();
  });

  // 7. Valid balanced debit/credit postings
  it("7. Valid balanced debit/credit postings preserve net zero liability", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const result = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-BAL-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 150000,
          reason: "Balanced test",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });

      const pDebit = await tx.creditTransferPosting.create({
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

      const pCredit = await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "CREDIT",
          studentId: studentA2.id,
          counterpartyStudentId: studentA1.id,
          receiptId: receipt.id,
          amount: 150000,
        },
      });

      return { j, pDebit, pCredit };
    });

    expect(result.pDebit.amount).toBe(150000);
    expect(result.pCredit.amount).toBe(150000);
    expect(result.pDebit.amount - result.pCredit.amount).toBe(0);
  });

  // 8. Unbalanced posting rejection at commit
  it("8. Unbalanced posting rejection at commit via deferred constraint trigger", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // Attempt transfer of ₹2,000 with only a DEBIT of ₹2,000 and NO credit posting
    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-UNBAL-${stamp}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            sourceReceiptId: receipt.id,
            amount: 200000,
            reason: "Unbalanced missing credit",
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
        // Missing CREDIT posting!
      })
    ).rejects.toThrow();

    // Attempt transfer of ₹2,000 with mismatched amounts (DEBIT 200000, CREDIT 100000)
    const stamp2 = stamp + 1;
    await expect(
      db.$transaction(async (tx) => {
        const j = await tx.creditTransferJournal.create({
          data: {
            tenantId: tenantA.id,
            transferNumber: `TRNS-MISMATCH-${stamp2}`,
            sourceStudentId: studentA1.id,
            targetStudentId: studentA2.id,
            sourceReceiptId: receipt.id,
            amount: 200000,
            reason: "Mismatched amounts",
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

  // 9. Posting referencing a different tenant's receipt rejection
  it("9. Posting referencing a different tenant's receipt rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receiptA = await createTestReceipt(300000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // Create receipt in Tenant B
    const receiptB = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantB.id,
          studentId: studentB1.id,
          receiptNumber: `RCPT-TB-${stamp}`,
          amount: 300000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantB.id,
          receiptId: r.id,
          unappliedAmount: 300000,
          status: "OVERPAID_UNALLOCATED",
        },
      });
      return r;
    });

    // Journal in Tenant A
    const journalA = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-TB-RCPT-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receiptA.id,
          amount: 100000,
          reason: "Cross receipt test",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });
      // Attempt posting in Tenant A referencing receiptB from Tenant B
      await tx.creditTransferPosting.create({
        data: {
          tenantId: tenantA.id,
          journalId: j.id,
          entryType: "DEBIT",
          studentId: studentA1.id,
          counterpartyStudentId: studentA2.id,
          receiptId: receiptB.id, // Cross-tenant receipt!
          amount: 100000,
        },
      });
    }).catch((e) => e);

    expect(journalA).toBeInstanceOf(Error);
  });

  // 10. Invalid StudentCreditAccount reference rejection
  it("10. Invalid StudentCreditAccount reference rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Attempt to create account with nonexistent student ID
    await expect(
      db.studentCreditAccount.create({
        data: {
          tenantId: tenantA.id,
          studentId: "nonexistent-student-id",
          balance: 0,
        },
      })
    ).rejects.toThrow();
  });

  // 11. Updating and deleting immutable transfer journal rejection
  it("11. Updating and deleting immutable transfer journal rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-IMMUT-${stamp}`,
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

    // 11a. UPDATE attempt rejected
    await expect(
      db.creditTransferJournal.update({
        where: { id: journal.id },
        data: { amount: 999999 },
      })
    ).rejects.toThrow();

    // 11b. DELETE attempt rejected
    await expect(
      db.creditTransferJournal.delete({
        where: { id: journal.id },
      })
    ).rejects.toThrow();
  });

  // 12. Updating and deleting immutable posting rejection
  it("12. Updating and deleting immutable posting rejection", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(400000);
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    let postingId = "";
    await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-POST-IMMUT-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 100000,
          reason: "Posting immutability check",
          status: "COMPLETED",
          requestedById: "usr_accountant",
        },
      });
      const p = await tx.creditTransferPosting.create({
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
      postingId = p.id;
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
    });

    // 12a. UPDATE attempt rejected
    await expect(
      db.creditTransferPosting.update({
        where: { id: postingId },
        data: { amount: 999999 },
      })
    ).rejects.toThrow();

    // 12b. DELETE attempt rejected
    await expect(
      db.creditTransferPosting.delete({
        where: { id: postingId },
      })
    ).rejects.toThrow();
  });

  // 13. Valid same-student allocation still succeeds
  it("13. Valid same-student allocation still succeeds without requiring a transfer", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(300000);

    const alloc = await db.$transaction(async (tx) => {
      // Allocate directly from receipt to studentA1 invoice
      const a = await tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 300000,
          creditTransferId: null, // Direct allocation
        },
      });
      await tx.paymentReceiptBalance.update({
        where: { receiptId: receipt.id },
        data: {
          allocatedAmount: 300000,
          unappliedAmount: 0,
          status: "FULLY_ALLOCATED",
        },
      });
      return a;
    });

    expect(alloc.id).toBeDefined();
    expect(alloc.creditTransferId).toBeNull();
    expect(alloc.amount).toBe(300000);
  });

  // 14. Sibling allocation without transfer provenance remains rejected
  it("14. Sibling allocation without transfer provenance remains rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(300000); // Receipt owned by studentA1

    // Attempt to allocate studentA1's receipt to studentA2's invoice without a creditTransferId
    await expect(
      db.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          studentId: studentA2.id, // Sibling beneficiary
          feeInvoiceId: invoiceA2.id,
          amount: 200000,
          creditTransferId: null, // Missing transfer provenance!
        },
      })
    ).rejects.toThrow();
  });

  // 15. Valid transfer provenance is represented by an actual foreign key
  it("15. Valid transfer provenance is represented by an actual foreign key, not a loose string", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(300000); // Owned by studentA1
    const stamp = Date.now() + Math.floor(Math.random() * 100000);

    // 15a. Rejects loose or non-existent creditTransferId
    await expect(
      db.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          studentId: studentA2.id,
          feeInvoiceId: invoiceA2.id,
          amount: 200000,
          creditTransferId: "nonexistent-transfer-id-xyz", // Loose string rejected by FK!
        },
      })
    ).rejects.toThrow();

    // 15b. Create valid COMPLETED transfer journal
    const journal = await db.$transaction(async (tx) => {
      const j = await tx.creditTransferJournal.create({
        data: {
          tenantId: tenantA.id,
          transferNumber: `TRNS-FK-${stamp}`,
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          sourceReceiptId: receipt.id,
          amount: 200000,
          reason: "Sibling transfer for FK test",
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
          amount: 200000,
        },
      });
      return j;
    });

    // 15c. Sibling allocation with valid creditTransferId succeeds!
    const alloc = await db.paymentAllocation.create({
      data: {
        tenantId: tenantA.id,
        receiptId: receipt.id,
        studentId: studentA2.id,
        feeInvoiceId: invoiceA2.id,
        amount: 200000,
        creditTransferId: journal.id, // Valid FK!
      },
    });

    expect(alloc.id).toBeDefined();
    expect(alloc.creditTransferId).toBe(journal.id);
  });

  // 16. Original receipt conservation remains enforced
  it("16. Original receipt conservation remains enforced with transferredOutAmount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const receipt = await createTestReceipt(500000); // ₹5,000 gross

    // 16a. Attempt to violate conservation:
    // unapplied (500000) + transferredOut (200000) = 700000 != 500000
    await expect(
      db.paymentReceiptBalance.update({
        where: { receiptId: receipt.id },
        data: {
          transferredOutAmount: 200000,
          unappliedAmount: 500000, // Should be 300000 to conserve!
        },
      })
    ).rejects.toThrow();

    // 16b. Conserved state succeeds:
    // unapplied (300000) + transferredOut (200000) = 500000 == 500000
    const updated = await db.paymentReceiptBalance.update({
      where: { receiptId: receipt.id },
      data: {
        transferredOutAmount: 200000,
        unappliedAmount: 300000,
      },
    });

    expect(updated.transferredOutAmount).toBe(200000);
    expect(updated.unappliedAmount).toBe(300000);
    expect(
      updated.allocatedAmount +
        updated.transferredOutAmount +
        updated.unappliedAmount +
        updated.reservedRefundAmount +
        updated.refundedAmount
    ).toBe(receipt.amount);
  });
});
