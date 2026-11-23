import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

console.log('=== STEP 1: Re-create empty database knowletive_staging_clean ===');
execSync('"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -h localhost -p 5432 -U knowletive -d postgres -c "DROP DATABASE IF EXISTS knowletive_staging_clean;"', {
  env: { ...process.env, PGPASSWORD: 'knowletive' },
  stdio: 'inherit',
});
execSync('"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -h localhost -p 5432 -U knowletive -d postgres -c "CREATE DATABASE knowletive_staging_clean OWNER knowletive;"', {
  env: { ...process.env, PGPASSWORD: 'knowletive' },
  stdio: 'inherit',
});
console.log('Empty database created.');

const CLEAN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/knowletive_staging_clean?schema=public";

console.log('\n=== STEP 2: Running prisma migrate deploy on empty database ===');
execSync('npx prisma migrate deploy', {
  env: { ...process.env, DATABASE_URL: CLEAN_DB_URL },
  stdio: 'inherit',
});
console.log('SUCCESS: All 9 Prisma migrations executed cleanly!');

console.log('\n=== STEP 3: Applying all companion integrity triggers & audit SQL ===');
const manualSqlFiles = [
  'prisma/manual/20261106_batch_event_immutability.sql',
  'prisma/manual/20261106_exam_hardening.sql',
  'prisma/manual/20261106_syllabustrack_hardening.sql',
  'prisma/manual/20261107_enrollment_marks_preservation.sql',
  'prisma/manual/20261107_snapshot_versioning.sql',
  'prisma/manual/20261116_fee_invoice_check_constraint.sql',
  'prisma/manual/20261118_core_financial_ledger_stage1.sql',
  'prisma/manual/20261118_copilot_conversations_phase3b.sql',
];

for (const sqlFile of manualSqlFiles) {
  console.log(`Applying ${sqlFile}...`);
  try {
    execSync(`"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -h localhost -p 5432 -U knowletive -d knowletive_staging_clean -f "${sqlFile}"`, {
      env: { ...process.env, PGPASSWORD: 'knowletive' },
      stdio: 'pipe',
    });
    console.log(`  ✓ ${sqlFile} applied successfully.`);
  } catch (err) {
    console.error(`  ✗ Error applying ${sqlFile}:`, err.message);
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
  }
}

console.log('\n=== STEP 4: Verifying triggers and constraints on knowletive_staging_clean ===');
const prisma = new PrismaClient({
  datasources: { db: { url: CLEAN_DB_URL } },
});

try {
  const triggers = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count
    FROM information_schema.triggers
    WHERE trigger_schema = 'public';
  `);
  console.log('Total trigger count on fresh database:', triggers[0].count);

  const constraints = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count
    FROM information_schema.table_constraints
    WHERE table_schema = 'public';
  `);
  console.log('Total constraint count on fresh database:', constraints[0].count);
} finally {
  await prisma.$disconnect();
}
