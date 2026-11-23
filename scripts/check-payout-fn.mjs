import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%branch_payout%'
  `);
  console.log('Function prosrc:', rows);
}
main().finally(() => prisma.$disconnect());
