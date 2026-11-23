import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sunrise = await prisma.tenant.findUnique({
    where: { slug: 'sunrise' },
    include: {
      branches: true,
      students: {
        include: {
          guardians: { include: { guardian: true } },
          feeInvoices: true,
          feePlans: { include: { installments: true } },
          demoFeePlans: { include: { installments: true } },
        },
        take: 5,
      },
      paymentCollectorRoutes: true,
      paymentProviderConfigs: true,
    },
  });

  if (!sunrise) {
    console.log('Sunrise Public School not found');
    return;
  }

  console.log('Tenant:', sunrise.name, sunrise.id);
  console.log('Branches:', sunrise.branches.map(b => ({ id: b.id, name: b.name, code: b.code, branchType: b.branchType, collectorCode: b.collectorCode })));
  console.log('Collector Routes:', sunrise.paymentCollectorRoutes.map(r => ({ branchId: r.branchId, provider: r.provider, collectorCode: r.collectorCode })));
  console.log('Provider Configs:', sunrise.paymentProviderConfigs.map(c => ({ provider: c.provider, environment: c.environment, isEnabled: c.isEnabled })));
  console.log('Students count:', sunrise.students.length);
  for (const s of sunrise.students) {
    console.log(`Student: ${s.firstName} ${s.lastName} (${s.admissionNo}) id=${s.id}`);
    console.log(`  Guardians:`, s.guardians.map(g => ({ name: g.guardian.name, email: g.guardian.email, isPrimary: g.isPrimary })));
    console.log(`  Invoices:`, s.feeInvoices.map(i => ({ id: i.id, number: i.number, amount: i.amount, paidAmount: i.paidAmount, status: i.status })));
    console.log(`  FeePlans:`, s.feePlans.map(p => ({ id: p.id, title: p.title, installments: p.installments.length })));
    console.log(`  DemoPlans:`, s.demoFeePlans.map(p => ({ id: p.id, title: p.title, installments: p.installments.length })));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
