import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'sunrise' } });
  if (!tenant) throw new Error("Sunrise not found");
  const branches = await prisma.branch.findMany({
    where: { tenantId: tenant.id },
    include: { _count: { select: { students: true, memberships: true, feeInvoices: true } } }
  });
  console.log("Sunrise branches in DB:", JSON.stringify(branches, null, 2));
}

main().finally(() => prisma.$disconnect());
