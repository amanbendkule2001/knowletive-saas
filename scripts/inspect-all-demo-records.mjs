import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const allDemoPlans = await prisma.demoFeePlan.findMany({ include: { tenant: { select: { id: true, name: true, slug: true } } } });
  console.log('All DemoFeePlans across DB:', allDemoPlans.map(p => ({ id: p.id, tenant: p.tenant.name, title: p.title })));

  const allPayouts = await prisma.branchPayout.findMany({ include: { tenant: { select: { id: true, name: true, slug: true } } } });
  console.log('All BranchPayouts across DB:', allPayouts.map(p => ({ id: p.id, tenant: p.tenant.name, num: p.payoutNumber, amount: p.amount })));

  const allLedger = await prisma.branchLedgerEntry.findMany({
    where: { referenceType: { in: ['DEMO_PAYMENT', 'PAYMENT_SETTLEMENT', 'BRANCH_PAYOUT'] } },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });
  console.log('All Demo BranchLedgerEntries across DB:', allLedger.map(l => ({ id: l.id, tenant: l.tenant.name, type: l.entryType, refType: l.referenceType, amount: l.amount })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
