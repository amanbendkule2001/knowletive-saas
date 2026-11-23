import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const fn = await prisma.$queryRaw`
    SELECT pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    WHERE p.proname = 'fn_protect_branch_ledger_immutability';
  `;
  console.log('Function def:', fn);
}

main().catch(console.error).finally(() => prisma.$disconnect());
