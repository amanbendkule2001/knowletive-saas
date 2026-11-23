import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { PrismaClient } from "@prisma/client";

describe("Stage 1.4: Payment Allocation Reversal Cumulative Limit & Concurrency Test Suite", () => {
  let isDbAvailable = false;
  let secondaryClient: PrismaClient;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any;
  let studentB1: any;
  let invoiceA1: any;

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
      return;
    }

    secondaryClient = new PrismaClient();
    const stamp = Date.now();

    // 1. Setup Tenant A
    tenantA = await db.tenant.create({
      data: {
        name: `Tenant Rev A ${stamp}`,
        slug: `tenant-rev-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-rev-a-${stamp}@example.com`,
        logoInitials: "TRA",
      },
    });

    // 2. Setup Tenant B (for cross-tenant checks)
    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Rev B ${stamp}`,
        slug: `tenant-rev-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-rev-b-${stamp}@example.com`,
        logoInitials: "TRB",
      },
    });

    // 3. Students
    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-REV-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Patel",
        status: "ACTIVE",
      },
    });

    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-REV-B1-${stamp}`,
        firstName: "Rohan",
        lastName: "Mehta",
        status: "ACTIVE",
      },
    });

    // 4. Invoices
    invoiceA1 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        number: `INV-REV-A1-${stamp}`,
        title: "Tuition Term 1",
        amount: 2000000, // ₹20,000
        dueDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (secondaryClient) {
      await secondaryClient.$disconnect();
    }
    if (!isDbAvailable) return;
    try {
      if (tenantA?.id) await db.tenant.delete({ where: { id: tenantA.id } });
      if (tenantB?.id) await db.tenant.delete({ where: { id: tenantB.id } });
    } catch {
      // Best effort cleanup (RESTRICT triggers prevent cascade delete if receipts exist)
    }
  });

  // Helper to create an allocation with backing receipt & balance
  async function createTestAllocation(amount: number) {
    const stamp = Date.now() + Math.floor(Math.random() * 100000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-REV-${stamp}`,
          amount: amount,
          method: "CASH",
        },
      });

      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: amount,
          unappliedAmount: 0,
          status: "FULLY_ALLOCATED",
        },
      });

      return tx.paymentAllocation.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          studentId: studentA1.id,
          feeInvoiceId: invoiceA1.id,
          amount: amount,
        },
      });
    });
  }

  // 1. Valid full reversal
  it("1. Valid full reversal succeeds and fully exhausts allocation", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 500000,
        reason: "Full course withdrawal",
      },
    });

    expect(rev.id).toBeDefined();
    expect(rev.amount).toBe(500000);

    // Attempting any further reversal on a fully reversed allocation must be rejected
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 100,
          reason: "Excess reversal attempt",
        },
      })
    ).rejects.toThrow();
  });

  // 2. Valid partial reversal
  it("2. Valid partial reversal succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000, // ₹2,000
        reason: "Partial adjustment",
      },
    });

    expect(rev.id).toBeDefined();
    expect(rev.amount).toBe(200000);

    // Verify sum
    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(200000);
  });

  // 3. Multiple partial reversals whose sum equals the allocation
  it("3. Multiple partial reversals whose sum equals the allocation succeed", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Part 1: ₹2,000
    const rev1 = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Partial 1",
      },
    });
    expect(rev1.id).toBeDefined();

    // Part 2: ₹1,500
    const rev2 = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 150000,
        reason: "Partial 2",
      },
    });
    expect(rev2.id).toBeDefined();

    // Part 3: ₹1,500 (total = 500,000 = original allocation)
    const rev3 = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 150000,
        reason: "Partial 3",
      },
    });
    expect(rev3.id).toBeDefined();

    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(500000);

    // Part 4: Attempting ₹1 more must be rejected
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 100,
          reason: "Exceeding part",
        },
      })
    ).rejects.toThrow();
  });

  // 4. Individual reversal greater than the allocation
  it("4. Individual reversal greater than the allocation is rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Attempt ₹6,000
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 600000, // ₹6,000 > ₹5,000
          reason: "Excessive single reversal",
        },
      })
    ).rejects.toThrow();
  });

  // 5. Cumulative reversals greater than the allocation
  it("5. Cumulative reversals greater than the allocation are rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Reversal 1: ₹3,000 succeeds
    await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 300000,
        reason: "First valid reversal",
      },
    });

    // Reversal 2: ₹2,500 fails (3,000 + 2,500 = 5,500 > 5,000)
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 250000,
          reason: "Second reversal exceeding remaining balance",
        },
      })
    ).rejects.toThrow();

    // Verify only the first reversal was persisted
    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(300000);
  });

  // 6. Concurrent reversal attempts exceeding the allocation
  it("6. Concurrent reversal attempts exceeding the allocation are safely serialized and rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Two independent transactions simultaneously attempt to reverse ₹3,000 each (total ₹6,000 > ₹5,000)
    const task1 = db.$transaction(async (tx) => {
      return tx.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 300000, // ₹3,000
          reason: "Concurrent reversal attempt 1",
        },
      });
    });

    const task2 = secondaryClient.$transaction(async (tx) => {
      return tx.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 300000, // ₹3,000
          reason: "Concurrent reversal attempt 2",
        },
      });
    });

    const results = await Promise.allSettled([task1, task2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one transaction must succeed, and the second must be rejected by PostgreSQL row lock & trigger
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify database integrity: cumulative committed reversal is exactly ₹3,000 <= ₹5,000
    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(300000);
  });

  // 7. Cross-tenant reversal rejection
  it("7. Cross-tenant reversal is rejected by composite foreign key", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // Belongs to tenant A

    // Attempt to reverse using Tenant B
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantB.id, // Tenant B!
          originalAllocationId: alloc.id, // Tenant A allocation!
          amount: 200000,
          reason: "Cross tenant reversal attempt",
        },
      })
    ).rejects.toThrow();
  });

  // 8. Update/delete protection on original allocation
  it("8. Update/delete protection on original allocation is enforced", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    // Attempt update
    await expect(
      db.paymentAllocation.update({
        where: { id: alloc.id },
        data: { amount: 600000 },
      })
    ).rejects.toThrow();

    // Attempt delete
    await expect(
      db.paymentAllocation.delete({
        where: { id: alloc.id },
      })
    ).rejects.toThrow();
  });

  // 9. Update/delete protection on reversal events
  it("9. Update/delete protection on reversal events is enforced", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Reversal immutability check",
      },
    });

    // Attempt update
    await expect(
      db.paymentAllocationReversal.update({
        where: { id: rev.id },
        data: { amount: 100000 },
      })
    ).rejects.toThrow();

    // Attempt delete
    await expect(
      db.paymentAllocationReversal.delete({
        where: { id: rev.id },
      })
    ).rejects.toThrow();
  });
});
