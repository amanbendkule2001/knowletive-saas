import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'parent@sunrise.test' },
    include: {
      guardianProfiles: {
        include: {
          students: {
            include: {
              student: {
                include: {
                  feeInvoices: true,
                  feePlans: { include: { installments: true } },
                  demoFeePlans: { include: { installments: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    console.log('User parent@sunrise.test not found');
    return;
  }

  console.log('User:', user.name, user.email, user.id);
  for (const g of user.guardianProfiles) {
    console.log('Guardian:', g.name, g.id);
    for (const sg of g.students) {
      const s = sg.student;
      console.log(`  Student: ${s.firstName} ${s.lastName} (${s.admissionNo}) id=${s.id}`);
      console.log(`  Invoices:`, s.feeInvoices.map(i => ({ id: i.id, number: i.number, amount: i.amount, paidAmount: i.paidAmount, status: i.status })));
      console.log(`  FeePlans:`, s.feePlans.map(p => ({ id: p.id, title: p.title, installments: p.installments.length })));
      console.log(`  DemoPlans:`, s.demoFeePlans.map(p => ({ id: p.id, title: p.title, installments: p.installments.length })));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
