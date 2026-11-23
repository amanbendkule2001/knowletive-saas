import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: { db: { url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public' } }
});

async function main() {
  console.log('BranchLedgerEntry columns:');
  const cols1 = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'BranchLedgerEntry' 
    ORDER BY ordinal_position;
  `);
  console.table(cols1);

  console.log('\nStudentCreditAccount columns:');
  const cols2 = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'StudentCreditAccount' 
    ORDER BY ordinal_position;
  `);
  console.table(cols2);
}

main().catch(console.error).finally(() => p.$disconnect());
