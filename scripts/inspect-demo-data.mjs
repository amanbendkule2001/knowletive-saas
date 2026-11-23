import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
  console.log('Tenants:', tenants);
  for (const t of tenants) {
    const branches = await prisma.branch.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, branchType: true, collectorCode: true } });
    console.log('Branches for', t.name, branches);
    const students = await prisma.student.findMany({ where: { tenantId: t.id }, select: { id: true, firstName: true, lastName: true, admissionNo: true }, take: 3 });
    console.log('Students for', t.name, students);
    const plans = await prisma.studentFeePlan.findMany({ where: { tenantId: t.id }, select: { id: true, title: true, totalAmount: true, payableAmount: true } });
    console.log('StudentFeePlans for', t.name, plans);
    const demoPlans = await prisma.demoFeePlan.findMany({ where: { tenantId: t.id }, select: { id: true, title: true, payableAmount: true } });
    console.log('DemoFeePlans for', t.name, demoPlans);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
