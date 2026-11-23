import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: { db: { url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public' } }
});

async function main() {
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'PaymentReceipt' 
    ORDER BY ordinal_position;
  `);
  console.table(cols);
}

main().catch(console.error).finally(() => p.$disconnect());
