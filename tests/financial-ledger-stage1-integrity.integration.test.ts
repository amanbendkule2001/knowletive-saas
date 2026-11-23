import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("Stage 1 & Stage 1.2: Core Financial Ledger Database Integrity Test Suite (28 Conditions)", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any;
  let studentA2: any;
  let studentB1: any;
  let invoiceA1: any;
  let invoiceA2: any;
  let invoiceB1: any;

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
        name: `Tenant A ${stamp}`,
        slug: `tenant-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-a-${stamp}@example.com`,
        logoInitials: "TA",
      },
    });

    // 2. Setup Tenant B (for cross-tenant checks)
    tenantB = await db.tenant.create({
      data: {
        name: `Tenant B ${stamp}`,
        slug: `tenant-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-b-${stamp}@example.com`,
        logoInitials: "TB",
      },
    });

    // 3. Students for Tenant A
    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    // 4. Student for Tenant B
    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-B1-${stamp}`,
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
        number: `INV-A1-${stamp}`,
        title: "Term 1 Tuition",
        amount: 800000, // ₹8,000
        dueDate: new Date(),
      },
    });

    invoiceA2 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA2.id,
        number: `INV-A2-${stamp}`,
        title: "Term 1 Tuition Sibling",
        amount: 800000,
        dueDate: new Date(),
      },
    });

    invoiceB1 = await db.feeInvoice.create({
      data: {
        tenantId: tenantB.id,
        studentId: studentB1.id,
        number: `INV-B1-${stamp}`,
        title: "Term 1 Tuition B",
        amount: 800000,
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
      // Cleanup best effort
    }
  });

  // =========================================================================
  // GROUP 1: RECEIPT AND BALANCE INTEGRITY (CONDITIONS 1-9)
  // =========================================================================

  it("1. Valid same-tenant receipt and balance insert succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-1-${stamp}`,
          amount: 500000,
          method: "CASH",
          provider: "cashier",
        },
      });

      const balance = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: 500000,
          reservedRefundAmount: 0,
          refundedAmount: 0,
          status: "CAPTURED",
        },
      });

      expect(receipt.id).toBeDefined();
      expect(balance.id).toBeDefined();
      expect(balance.unappliedAmount).toBe(500000);
    });
  });

  it("2. Receipt without balance is rejected at transaction commit", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.$transaction(async (tx) => {
        await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id,
            receiptNumber: `RCPT-NO-BAL-${stamp}`,
            amount: 500000,
            method: "CASH",
          },
        });
        // Deliberately do not insert PaymentReceiptBalance
      })
    ).rejects.toThrow();
  });

  it("3. Balance deletion is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const receipt = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-DEL-BAL-${stamp}`,
          amount: 100000,
          method: "CASH",
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

    await expect(
      db.paymentReceiptBalance.delete({
        where: { receiptId: receipt.id },
      })
    ).rejects.toThrow();
  });

  it("4. Balance truncation is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    await expect(
      db.$executeRawUnsafe(`TRUNCATE TABLE "PaymentReceiptBalance" CASCADE;`)
    ).rejects.toThrow();
  });

  it("5. Changing balance receiptId is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const { balance } = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-ID-CHANGE-${stamp}`,
          amount: 100000,
          method: "CASH",
        },
      });
      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          unappliedAmount: 100000,
        },
      });
      return { receipt: r, balance: b };
    });

    await expect(
      db.paymentReceiptBalance.update({
        where: { id: balance.id },
        data: { receiptId: "fake_other_receipt_id" },
      })
    ).rejects.toThrow();
  });

  it("6. Changing balance tenantId is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const { balance } = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-TEN-CHANGE-${stamp}`,
          amount: 100000,
          method: "CASH",
        },
      });
      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          unappliedAmount: 100000,
        },
      });
      return { receipt: r, balance: b };
    });

    await expect(
      db.paymentReceiptBalance.update({
        where: { id: balance.id },
        data: { tenantId: tenantB.id },
      })
    ).rejects.toThrow();
  });

  it("7. Negative balance components are rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id,
            receiptNumber: `RCPT-NEG-BAL-${stamp}`,
            amount: 500000,
            method: "CASH",
          },
        });
        await tx.paymentReceiptBalance.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            allocatedAmount: -100, // Negative amount violates CHECK constraint
            unappliedAmount: 500100,
          },
        });
      })
    ).rejects.toThrow();
  });

  it("8. Receipt conservation mismatch is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id,
            receiptNumber: `RCPT-OVER-SUM-${stamp}`,
            amount: 500000,
            method: "CASH",
          },
        });
        // 400000 + 200000 = 600000 != 500000
        await tx.paymentReceiptBalance.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            allocatedAmount: 400000,
            unappliedAmount: 200000,
          },
        });
      })
    ).rejects.toThrow();
  });

  it("9. Valid balance updates preserving conservation succeed", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const { balance } = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-BAL-UPD-${stamp}`,
          amount: 500000,
          method: "CASH",
        },
      });
      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 0,
          unappliedAmount: 500000,
        },
      });
      return { receipt: r, balance: b };
    });

    const updated = await db.paymentReceiptBalance.update({
      where: { id: balance.id },
      data: {
        allocatedAmount: 300000,
        unappliedAmount: 200000, // 300000 + 200000 = 500000, conservation preserved
      },
    });

    expect(updated.allocatedAmount).toBe(300000);
    expect(updated.unappliedAmount).toBe(200000);
  });

  // =========================================================================
  // GROUP 2: TENANT AND STUDENT ISOLATION (CONDITIONS 10-17)
  // =========================================================================

  it("10. Cross-tenant receipt/student relationship is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.paymentReceipt.create({
        data: {
          tenantId: tenantA.id, // Tenant A
          studentId: studentB1.id, // Student belonging to Tenant B!
          receiptNumber: `RCPT-XT-STU-${stamp}`,
          amount: 100000,
          method: "CASH",
        },
      })
    ).rejects.toThrow();
  });

  it("11. Cross-tenant receipt/allocation relationship is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const r = await db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-XT-ALLOC-R-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          unappliedAmount: 200000,
        },
      });
      return receipt;
    });

    // Attempt allocation under Tenant B referencing Tenant A's receipt
    await expect(
      db.paymentAllocation.create({
        data: {
          tenantId: tenantB.id, // Tenant B!
          receiptId: r.id, // Receipt from Tenant A!
          studentId: studentB1.id,
          feeInvoiceId: invoiceB1.id,
          amount: 100000,
        },
      })
    ).rejects.toThrow();
  });

  it("12. Cross-tenant invoice/allocation relationship is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const r = await db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-XT-INV-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          unappliedAmount: 200000,
        },
      });
      return receipt;
    });

    // Attempt allocation under Tenant A referencing Tenant B's invoice
    await expect(
      db.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceB1.id, // Tenant B invoice!
          amount: 100000,
        },
      })
    ).rejects.toThrow();
  });

  it("13. Cross-tenant reversal relationship is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-XT-REV-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    // Attempt reversal under Tenant B referencing Tenant A's allocation
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantB.id, // Tenant B!
          originalAllocationId: alloc.id, // Tenant A allocation!
          amount: 200000,
          reason: "Cross tenant reversal test",
        },
      })
    ).rejects.toThrow();
  });

  it("14. Same-student allocation succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-SAME-STU-${stamp}`,
          amount: 300000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 300000,
          unappliedAmount: 0,
          status: "FULLY_ALLOCATED",
        },
      });
      const alloc = await tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 300000,
        },
      });
      expect(alloc.id).toBeDefined();
    });
  });

  it("15. Different-student receipt allocation fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id, // Owned by student A1
            receiptNumber: `RCPT-DIFF-STU-${stamp}`,
            amount: 300000,
            method: "CASH",
          },
        });
        await tx.paymentReceiptBalance.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            allocatedAmount: 300000,
            unappliedAmount: 0,
          },
        });
        // Allocation beneficiary differs from receipt student
        await tx.paymentAllocation.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            studentId: studentA2.id, // Student A2!
            feeInvoiceId: invoiceA2.id,
            amount: 300000,
          },
        });
      })
    ).rejects.toThrow();
  });

  it("16. Allocation to another student's invoice fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    await expect(
      db.$transaction(async (tx) => {
        const r = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id,
            receiptNumber: `RCPT-MISMATCH-INV-${stamp}`,
            amount: 300000,
            method: "CASH",
          },
        });
        await tx.paymentReceiptBalance.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            allocatedAmount: 300000,
            unappliedAmount: 0,
          },
        });
        // Allocation student is A1, but invoice belongs to student A2!
        await tx.paymentAllocation.create({
          data: {
            tenantId: tenantA.id,
            receiptId: r.id,
            studentId: studentA1.id,
            feeInvoiceId: invoiceA2.id, // Invoice belongs to student A2!
            amount: 300000,
          },
        });
      })
    ).rejects.toThrow();
  });

  it("17. Changing FeeInvoice.studentId after a financial allocation is rejected or otherwise proven safe", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    // 1. Create a dedicated invoice for student A1
    const testInvoice = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        number: `INV-GUARD-${stamp}`,
        title: "Tuition Guard Test",
        amount: 250000,
        dueDate: new Date(),
      },
    });

    // 2. Create receipt and allocate to this invoice
    await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-GUARD-${stamp}`,
          amount: 250000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 250000,
          unappliedAmount: 0,
        },
      });
      await tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: testInvoice.id,
          amount: 250000,
        },
      });
    });

    // 3. Attempt to reassign FeeInvoice.studentId to student A2 (must be rejected by trg_invoice_student_reassignment_guard)
    await expect(
      db.feeInvoice.update({
        where: { id: testInvoice.id },
        data: { studentId: studentA2.id },
      })
    ).rejects.toThrow();
  });

  // =========================================================================
  // GROUP 3: APPEND-ONLY HISTORY (CONDITIONS 18-28)
  // =========================================================================

  it("18. PaymentReceipt UPDATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const r = await db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-18-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          unappliedAmount: 200000,
        },
      });
      return receipt;
    });

    await expect(
      db.paymentReceipt.update({
        where: { id: r.id },
        data: { amount: 300000 },
      })
    ).rejects.toThrow();
  });

  it("19. PaymentReceipt DELETE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const r = await db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-19-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          unappliedAmount: 200000,
        },
      });
      return receipt;
    });

    await expect(
      db.paymentReceipt.delete({
        where: { id: r.id },
      })
    ).rejects.toThrow();
  });

  it("20. PaymentReceipt TRUNCATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    await expect(
      db.$executeRawUnsafe(`TRUNCATE TABLE "PaymentReceipt" CASCADE;`)
    ).rejects.toThrow();
  });

  it("21. PaymentAllocation UPDATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-21-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    await expect(
      db.paymentAllocation.update({
        where: { id: alloc.id },
        data: { amount: 300000 },
      })
    ).rejects.toThrow();
  });

  it("22. PaymentAllocation DELETE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-22-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    await expect(
      db.paymentAllocation.delete({
        where: { id: alloc.id },
      })
    ).rejects.toThrow();
  });

  it("23. PaymentAllocation TRUNCATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    await expect(
      db.$executeRawUnsafe(`TRUNCATE TABLE "PaymentAllocation" CASCADE;`)
    ).rejects.toThrow();
  });

  it("24. PaymentAllocationReversal UPDATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-24-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Test reversal 24",
      },
    });

    await expect(
      db.paymentAllocationReversal.update({
        where: { id: rev.id },
        data: { amount: 150000 },
      })
    ).rejects.toThrow();
  });

  it("25. PaymentAllocationReversal DELETE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-IMM-25-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Test reversal 25",
      },
    });

    await expect(
      db.paymentAllocationReversal.delete({
        where: { id: rev.id },
      })
    ).rejects.toThrow();
  });

  it("26. PaymentAllocationReversal TRUNCATE is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    await expect(
      db.$executeRawUnsafe(`TRUNCATE TABLE "PaymentAllocationReversal" CASCADE;`)
    ).rejects.toThrow();
  });

  it("27. A valid compensating reversal insert succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const alloc = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-REV-27-${stamp}`,
          amount: 200000,
          method: "CASH",
        },
      });
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 200000,
          unappliedAmount: 0,
        },
      });
      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: 200000,
        },
      });
    });

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Compensating event test",
      },
    });

    expect(rev.id).toBeDefined();
    expect(rev.originalAllocationId).toBe(alloc.id);
  });

  it("28. PaymentReceiptBalance remains mutable for permitted projection changes", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const stamp = Date.now();
    const { balance } = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-MUT-28-${stamp}`,
          amount: 400000,
          method: "CASH",
        },
      });
      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 0,
          unappliedAmount: 400000,
        },
      });
      return { receipt: r, balance: b };
    });

    // Update projection: allocate 150000, unapplied 250000 (sum = 400000)
    const upd1 = await db.paymentReceiptBalance.update({
      where: { id: balance.id },
      data: {
        allocatedAmount: 150000,
        unappliedAmount: 250000,
      },
    });
    expect(upd1.allocatedAmount).toBe(150000);
    expect(upd1.unappliedAmount).toBe(250000);

    // Update projection again: reverse 50000, unapplied becomes 300000, allocated becomes 100000
    const upd2 = await db.paymentReceiptBalance.update({
      where: { id: balance.id },
      data: {
        allocatedAmount: 100000,
        unappliedAmount: 300000,
      },
    });
    expect(upd2.allocatedAmount).toBe(100000);
    expect(upd2.unappliedAmount).toBe(300000);
  });
});
