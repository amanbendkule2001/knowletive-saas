import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: { db: { url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public' } }
});

async function main() {
  const enums = await p.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'BranchLedgerEntryType';
  `);
  console.table(enums);
}

main().catch(console.error).finally(() => p.$disconnect());
