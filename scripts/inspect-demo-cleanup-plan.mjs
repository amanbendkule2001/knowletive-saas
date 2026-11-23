import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sunrise = await prisma.tenant.findUnique({ where: { slug: 'sunrise' } });
  if (!sunrise) return console.log('No sunrise tenant');

  console.log('=== SUNRISE TENANT: ===', sunrise.id, sunrise.name);

  const branches = await prisma.branch.findMany({ where: { tenantId: sunrise.id } });
  console.log('Branches in Sunrise:', branches.map(b => ({ id: b.id, name: b.name, code: b.code, createdAt: b.createdAt })));

  const demoPlans = await prisma.demoFeePlan.findMany({ where: { tenantId: sunrise.id } });
  console.log('DemoFeePlans in Sunrise:', demoPlans.map(p => ({ id: p.id, title: p.title, createdAt: p.createdAt })));

  const demoInsts = await prisma.demoFeeInstallment.findMany({ where: { tenantId: sunrise.id } });
  console.log('DemoFeeInstallments count in Sunrise:', demoInsts.length);

  const demoSessions = await prisma.demoPaymentSession.findMany({ where: { tenantId: sunrise.id } });
  console.log('DemoPaymentSessions in Sunrise:', demoSessions.map(s => ({ id: s.id, token: s.sessionToken, status: s.status, createdAt: s.createdAt })));

  const demoTxs = await prisma.demoPaymentTransaction.findMany({ where: { tenantId: sunrise.id } });
  console.log('DemoPaymentTransactions in Sunrise:', demoTxs.map(t => ({ id: t.id, ref: t.reference, amount: t.amount, createdAt: t.createdAt })));

  const payouts = await prisma.branchPayout.findMany({ where: { tenantId: sunrise.id } });
  console.log('BranchPayouts in Sunrise:', payouts.map(p => ({ id: p.id, num: p.payoutNumber, amount: p.amount, createdAt: p.createdAt })));

  const ledger = await prisma.branchLedgerEntry.findMany({ where: { tenantId: sunrise.id } });
  console.log('BranchLedgerEntries in Sunrise:', ledger.map(l => ({ id: l.id, type: l.entryType, amount: l.amount, balAfter: l.balanceAfter, createdAt: l.postedAt })));

  const routes = await prisma.paymentCollectorRoute.findMany({ where: { tenantId: sunrise.id } });
  console.log('PaymentCollectorRoutes in Sunrise:', routes.map(r => ({ id: r.id, code: r.collectorCode, createdAt: r.createdAt })));

  const configs = await prisma.paymentProviderConfig.findMany({ where: { tenantId: sunrise.id } });
  console.log('PaymentProviderConfigs in Sunrise:', configs.map(c => ({ id: c.id, provider: c.provider, createdAt: c.createdAt })));

  const student = await prisma.student.findFirst({ where: { tenantId: sunrise.id, admissionNo: 'SPS-2026-1001' } });
  console.log('Aarav Sharma student branchId:', student?.branchId);

  // Check if any real PaymentReceipt or FeePayment or FeeInvoice was created during demo
  const recentReceipts = await prisma.paymentReceipt.findMany({
    where: { tenantId: sunrise.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('Real PaymentReceipts in Sunrise (recent 5):', recentReceipts.map(r => ({ id: r.id, num: r.receiptNumber, amount: r.amount, createdAt: r.createdAt })));

  // Check students pointing to the demo branches
  if (branches.length > 0) {
    const branchIds = branches.map(b => b.id);
    const studentsInBranches = await prisma.student.findMany({
      where: { branchId: { in: branchIds } },
      select: { id: true, firstName: true, lastName: true, admissionNo: true, branchId: true },
    });
    console.log('Students assigned to these branches:', studentsInBranches);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
