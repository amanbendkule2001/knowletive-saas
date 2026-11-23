import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const triggers = await prisma.$queryRawUnsafe(`
    SELECT tgname, relname 
    FROM pg_trigger t 
    JOIN pg_class c ON t.tgrelid = c.oid 
    WHERE relname IN ('BranchPayout', 'BranchLedgerEntry')
  `);
  console.log('Triggers:', triggers);
  const payouts = await prisma.branchPayout.findMany();
  console.log('BranchPayouts:', payouts);
}
main().finally(() => prisma.$disconnect());
