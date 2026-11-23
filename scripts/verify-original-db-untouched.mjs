import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({
  datasources: { db: { url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public' } }
});

async function main() {
  console.log('=== VERIFYING ORIGINAL DATABASE IS UNTOUCHED ===\n');

  const [currDb] = await p.$queryRawUnsafe(`SELECT current_database() as name;`);
  console.log(`Connected to: ${currDb.name}`);
  if (currDb.name !== 'knowletive') {
    throw new Error('Not connected to knowletive!');
  }

  // 1. Check user tables count
  const tables = await p.$queryRawUnsafe(`
    SELECT count(*)::int as count 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  `);
  console.log(`User tables count in knowletive: ${tables[0].count} (Expected: 82)`);

  // 2. Check _prisma_migrations exists
  const migTable = await p.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) as exists;
  `);
  console.log(`_prisma_migrations exists in knowletive: ${migTable[0].exists} (Expected: false)`);

  // 3. Check fn_protect_invoice_student_reassignment search_path setting
  const fnCheck = await p.$queryRawUnsafe(`
    SELECT proname, prosecdef, proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname = 'fn_protect_invoice_student_reassignment';
  `);
  console.log(`fn_protect_invoice_student_reassignment on knowletive:`, fnCheck[0]);
  console.log(`proconfig on original knowletive: ${fnCheck[0].proconfig || 'NULL (UNTOUCHED)'}`);

  // 4. Check TEMPORARY privilege on knowletive
  const aclCheck = await p.$queryRawUnsafe(`
    SELECT datname, datacl::text FROM pg_database WHERE datname = 'knowletive';
  `);
  console.log(`Database ACL for knowletive:`, aclCheck[0].datacl);
}

main().catch(console.error).finally(() => p.$disconnect());
