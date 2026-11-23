import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { Prisma, PrismaClient } from "@prisma/client";

describe("Stage 1.5: Financial Reversal Transaction Isolation Hardening Test Suite", () => {
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
        name: `Tenant Iso A ${stamp}`,
        slug: `tenant-iso-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-iso-a-${stamp}@example.com`,
        logoInitials: "TIA",
      },
    });

    // 2. Setup Tenant B
    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Iso B ${stamp}`,
        slug: `tenant-iso-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-iso-b-${stamp}@example.com`,
        logoInitials: "TIB",
      },
    });

    // 3. Students
    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-ISO-A1-${stamp}`,
        firstName: "Vikram",
        lastName: "Singhania",
        status: "ACTIVE",
      },
    });

    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-ISO-B1-${stamp}`,
        firstName: "Kavita",
        lastName: "Nair",
        status: "ACTIVE",
      },
    });

    // 4. Invoices
    invoiceA1 = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA1.id,
        number: `INV-ISO-A1-${stamp}`,
        title: "Semester 1 Fees",
        amount: 2500000, // ₹25,000
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
      // Best effort cleanup
    }
  });

  async function createTestAllocation(amount: number) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.$transaction(
      async (tx) => {
        const receipt = await tx.paymentReceipt.create({
          data: {
            tenantId: tenantA.id,
            studentId: studentA1.id,
            receiptNumber: `RCPT-ISO-${stamp}`,
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
  }

  // 1. Verify Current Database Isolation Level is READ COMMITTED
  it("1. Current default transaction isolation level is verified as READ COMMITTED", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const rows = await db.$queryRaw<Array<{ default_transaction_isolation: string }>>`
      SHOW default_transaction_isolation;
    `;
    expect(rows[0].default_transaction_isolation.toLowerCase()).toBe("read committed");
  });

  // 2. READ COMMITTED: Two concurrent ₹3,000 reversals against ₹5,000
  it("2. READ COMMITTED: Two concurrent ₹3,000 reversals against ₹5,000 safely serialize", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Two independent database connections running in explicit READ COMMITTED
    const task1 = db.$transaction(
      async (tx) => {
        // Assert isolation inside transaction
        const iso = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation;`;
        expect(iso[0].transaction_isolation.toLowerCase()).toBe("read committed");

        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 300000,
            reason: "Concurrent reversal RC 1",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const task2 = secondaryClient.$transaction(
      async (tx) => {
        const iso = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation;`;
        expect(iso[0].transaction_isolation.toLowerCase()).toBe("read committed");

        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 300000,
            reason: "Concurrent reversal RC 2",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const results = await Promise.allSettled([task1, task2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one transaction commits; the other is rejected
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify committed database sum is exactly ₹3,000
    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(300000);
  });

  // 3. READ COMMITTED: Two concurrent partial reversals whose sum equals ₹5,000 both succeed
  it("3. READ COMMITTED: Two concurrent partial reversals summing to exact allocation both succeed", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Both attempt ₹2,500 concurrently (sum = ₹5,000 = allocation amount)
    const task1 = db.$transaction(
      async (tx) => {
        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 250000,
            reason: "Exact partial 1",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const task2 = secondaryClient.$transaction(
      async (tx) => {
        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 250000,
            reason: "Exact partial 2",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const results = await Promise.allSettled([task1, task2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Both succeed because serialized sum 250,000 + 250,000 == 500,000
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(0);

    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(500000);
  });

  // 4. Multiple reversals in a single transaction
  it("4. Multiple partial reversals within a single transaction enforce invariant", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // A single transaction performs 3 sequential partial inserts totaling 500,000
    await db.$transaction(
      async (tx) => {
        await tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 200000,
            reason: "Multi part 1",
          },
        });
        await tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 150000,
            reason: "Multi part 2",
          },
        });
        await tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 150000,
            reason: "Multi part 3",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const total = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(500000);

    // Attempting an additional ₹1 in a separate transaction is rejected
    await expect(
      db.paymentAllocationReversal.create({
        data: {
          tenantId: tenantA.id,
          originalAllocationId: alloc.id,
          amount: 100,
          reason: "Multi part overflow",
        },
      })
    ).rejects.toThrow();
  });

  // 5. REPEATABLE READ: Rejected by Database-Level Isolation Guard
  it("5. REPEATABLE READ: Attempting reversal is rejected by isolation guard to prevent write skew", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    // Attempting reversal inside REPEATABLE READ transaction must be rejected by fn_enforce_allocation_reversal_limit
    await expect(
      db.$transaction(
        async (tx) => {
          return tx.paymentAllocationReversal.create({
            data: {
              tenantId: tenantA.id,
              originalAllocationId: alloc.id,
              amount: 300000,
              reason: "Repeatable read attempt",
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    ).rejects.toThrow(/requires READ COMMITTED transaction isolation/);
  });

  // 6. SERIALIZABLE: Rejected by Database-Level Isolation Guard
  it("6. SERIALIZABLE: Attempting reversal is rejected by isolation guard", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    // Attempting reversal inside SERIALIZABLE transaction must be rejected by fn_enforce_allocation_reversal_limit
    await expect(
      db.$transaction(
        async (tx) => {
          return tx.paymentAllocationReversal.create({
            data: {
              tenantId: tenantA.id,
              originalAllocationId: alloc.id,
              amount: 300000,
              reason: "Serializable attempt",
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    ).rejects.toThrow(/requires READ COMMITTED transaction isolation/);
  });

  // 7. Transaction rollback after rejection leaves no orphan or partial data
  it("7. Transaction rollback after rejection leaves zero phantom records", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    // Transaction that attempts an invalid reversal (amount > allocation)
    try {
      await db.$transaction(
        async (tx) => {
          await tx.paymentAllocationReversal.create({
            data: {
              tenantId: tenantA.id,
              originalAllocationId: alloc.id,
              amount: 600000, // Invalid: exceeds 500,000
              reason: "Invalid reversal to test rollback",
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch {
      // Expected exception
    }

    // Verify zero reversals exist in the database for this allocation
    const count = await db.paymentAllocationReversal.count({
      where: { originalAllocationId: alloc.id },
    });
    expect(count).toBe(0);
  });

  // 8. Retrying a complete transaction after failure
  it("8. Retrying a complete transaction after contention succeeds with remaining unreversed amount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000); // ₹5,000

    // Step 1: Initial reversal of ₹3,000 commits
    await db.$transaction(
      async (tx) => {
        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: 300000,
            reason: "Initial reversal",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    // Step 2: A subsequent attempt to reverse ₹3,000 fails (3000 + 3000 = 6000 > 5000)
    let failed = false;
    try {
      await db.$transaction(
        async (tx) => {
          return tx.paymentAllocationReversal.create({
            data: {
              tenantId: tenantA.id,
              originalAllocationId: alloc.id,
              amount: 300000,
              reason: "Over-allocation reversal",
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);

    // Step 3: Application service recalculates remaining balance (500,000 - 300,000 = 200,000)
    // and retries with the correct remaining amount ₹2,000
    const retryResult = await db.$transaction(
      async (tx) => {
        // Query current sum under fresh READ COMMITTED snapshot
        const totalAgg = await tx.paymentAllocationReversal.aggregate({
          where: { originalAllocationId: alloc.id },
          _sum: { amount: true },
        });
        const currentReversed = totalAgg._sum.amount ?? 0;
        const remaining = 500000 - currentReversed;
        expect(remaining).toBe(200000);

        return tx.paymentAllocationReversal.create({
          data: {
            tenantId: tenantA.id,
            originalAllocationId: alloc.id,
            amount: remaining,
            reason: "Retried with remaining capacity",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    expect(retryResult.id).toBeDefined();
    expect(retryResult.amount).toBe(200000);

    // Final total is exactly 500,000
    const finalTotal = await db.paymentAllocationReversal.aggregate({
      where: { originalAllocationId: alloc.id },
      _sum: { amount: true },
    });
    expect(finalTotal._sum.amount).toBe(500000);
  });

  // 9. Cross-tenant reversal rejection
  it("9. Cross-tenant reversal is rejected by composite foreign key", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    await expect(
      db.$transaction(
        async (tx) => {
          return tx.paymentAllocationReversal.create({
            data: {
              tenantId: tenantB.id, // Cross-tenant!
              originalAllocationId: alloc.id,
              amount: 200000,
              reason: "Cross tenant attempt",
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      )
    ).rejects.toThrow();
  });

  // 10. Existing immutable-event protection
  it("10. Existing immutable-event protection remains active for allocations and reversals", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();
    const alloc = await createTestAllocation(500000);

    const rev = await db.paymentAllocationReversal.create({
      data: {
        tenantId: tenantA.id,
        originalAllocationId: alloc.id,
        amount: 200000,
        reason: "Immutability check",
      },
    });

    // Both allocation and reversal must reject UPDATE and DELETE
    await expect(db.paymentAllocation.update({ where: { id: alloc.id }, data: { amount: 600000 } })).rejects.toThrow();
    await expect(db.paymentAllocation.delete({ where: { id: alloc.id } })).rejects.toThrow();
    await expect(db.paymentAllocationReversal.update({ where: { id: rev.id }, data: { amount: 100000 } })).rejects.toThrow();
    await expect(db.paymentAllocationReversal.delete({ where: { id: rev.id } })).rejects.toThrow();
  });
});
