import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const plans = await prisma.demoFeePlan.count();
  const installments = await prisma.demoFeeInstallment.count();
  const sessions = await prisma.demoPaymentSession.count();
  const transactions = await prisma.demoPaymentTransaction.count();
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true, branchType: true, isActive: true, collectorCode: true }
  });
  const routes = await prisma.paymentCollectorRoute.findMany({
    select: { id: true, collectorCode: true, branchId: true }
  });
  const student = await prisma.student.findFirst({
    where: { admissionNo: 'SPS-2026-1001' },
    select: { id: true, firstName: true, lastName: true, admissionNo: true, branchId: true }
  });
  const ledgerEntries = await prisma.branchLedgerEntry.findMany({
    select: { id: true, branchId: true, entryType: true, amount: true, balanceAfter: true, description: true }
  });

  console.log('DemoFeePlan count:', plans);
  console.log('DemoFeeInstallment count:', installments);
  console.log('DemoPaymentSession count:', sessions);
  console.log('DemoPaymentTransaction count:', transactions);
  console.log('Branches:', JSON.stringify(branches, null, 2));
  console.log('PaymentCollectorRoutes:', JSON.stringify(routes, null, 2));
  console.log('Aarav Sharma student:', JSON.stringify(student, null, 2));
  console.log('BranchLedgerEntries count:', ledgerEntries.length);
  console.log('BranchLedgerEntries:', JSON.stringify(ledgerEntries, null, 2));
}

main().finally(() => prisma.$disconnect());
