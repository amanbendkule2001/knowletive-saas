import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== STARTING AUDITED DEMO DATA CLEANUP ===");

  const tenant = await prisma.tenant.findUnique({
    where: { slug: 'sunrise' },
  });

  if (!tenant) {
    throw new Error("Tenant 'sunrise' not found!");
  }
  console.log(`Found tenant: ${tenant.name} (${tenant.id})`);

  // 1. Delete Demo Transactions
  const delTransactions = await prisma.demoPaymentTransaction.deleteMany({
    where: {
      session: {
        tenantId: tenant.id,
      },
    },
  });
  console.log(`Deleted DemoPaymentTransaction records: ${delTransactions.count}`);

  // 2. Delete Demo Sessions
  const delSessions = await prisma.demoPaymentSession.deleteMany({
    where: {
      tenantId: tenant.id,
    },
  });
  console.log(`Deleted DemoPaymentSession records: ${delSessions.count}`);

  // 3. Delete Demo Fee Installments
  const delInstallments = await prisma.demoFeeInstallment.deleteMany({
    where: {
      tenantId: tenant.id,
    },
  });
  console.log(`Deleted DemoFeeInstallment records: ${delInstallments.count}`);

  // 4. Delete Demo Fee Plans
  const delPlans = await prisma.demoFeePlan.deleteMany({
    where: {
      tenantId: tenant.id,
    },
  });
  console.log(`Deleted DemoFeePlan records: ${delPlans.count}`);

  // 5. Delete Payment Collector Routes
  const delRoutes = await prisma.paymentCollectorRoute.deleteMany({
    where: {
      tenantId: tenant.id,
      collectorCode: { in: ['COL-SUN-MAIN', 'COL-SUN-EAST'] },
    },
  });
  console.log(`Deleted PaymentCollectorRoute records: ${delRoutes.count}`);

  // 6. Delete Payment Provider Config
  const delConfigs = await prisma.paymentProviderConfig.deleteMany({
    where: {
      tenantId: tenant.id,
      provider: 'JODO',
    },
  });
  console.log(`Deleted PaymentProviderConfig records: ${delConfigs.count}`);

  // 7. Reset Student branchId for Aarav Sharma
  const updatedStudent = await prisma.student.updateMany({
    where: {
      tenantId: tenant.id,
      admissionNo: 'SPS-2026-1001',
    },
    data: {
      branchId: null,
    },
  });
  console.log(`Reset branchId to null for Aarav Sharma: ${updatedStudent.count} record(s)`);

  // 8. Delete test Branch Payout
  const delPayouts = await prisma.branchPayout.deleteMany({
    where: {
      tenantId: tenant.id,
      payoutNumber: 'PO-2026-0001',
    },
  });
  console.log(`Deleted test BranchPayout records: ${delPayouts.count}`);

  // 9. Reverse BranchLedgerEntry running balance to 0 via audited ADJUSTMENT_DEBIT
  const demoBranches = await prisma.branch.findMany({
    where: {
      tenantId: tenant.id,
      name: { in: ['Sunrise Main Campus', 'Sunrise East Sub-Campus'] },
    },
  });

  for (const branch of demoBranches) {
    const lastEntry = await prisma.branchLedgerEntry.findFirst({
      where: {
        tenantId: tenant.id,
        branchId: branch.id,
      },
      orderBy: { postedAt: 'desc' },
    });

    if (lastEntry && lastEntry.balanceAfter > 0) {
      console.log(`Branch ${branch.name} has outstanding ledger balance of ${lastEntry.balanceAfter} paise. Posting audited reversal entry...`);
      await prisma.branchLedgerEntry.create({
        data: {
          tenantId: tenant.id,
          branchId: branch.id,
          entryType: 'ADJUSTMENT_DEBIT',
          channel: 'ONLINE_JODO',
          amount: lastEntry.balanceAfter,
          balanceAfter: 0,
          currency: 'INR',
          referenceType: 'DEMO_RESET',
          referenceId: `AUDIT-RESET-${Date.now()}`,
          description: 'Audited demo reset: reversal of simulated demo ledger entries',
          metadata: { reason: 'Clean demonstration flow preparation' },
        },
      });
      console.log(`Branch ${branch.name} ledger balance successfully zeroed out via ADJUSTMENT_DEBIT.`);
    }

    // Deactivate demo branches so they do not clutter clean demonstration
    await prisma.branch.update({
      where: { id: branch.id },
      data: {
        isActive: false,
        collectorCode: null,
      },
    });
    console.log(`Deactivated demo branch: ${branch.name} (${branch.id})`);
  }

  // 10. Reset parent failedLoginAttempts and lockedUntil
  const updatedParent = await prisma.user.updateMany({
    where: { email: 'parent@sunrise.test' },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  console.log(`Reset parent login attempts: ${updatedParent.count}`);

  console.log("=== AUDITED DEMO DATA CLEANUP COMPLETE ===");
}

main()
  .catch((e) => {
    console.error("Cleanup error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
