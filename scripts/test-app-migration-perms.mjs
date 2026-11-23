import { PrismaClient } from '@prisma/client';

const appPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://knowletive_app:AppSecured2026!@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public'
    }
  }
});

async function main() {
  console.log('Testing knowletive_app permissions on migrations and DDL:');
  
  // 1. Can knowletive_app read _prisma_migrations?
  try {
    const migs = await appPrisma.$queryRawUnsafe('SELECT count(*) FROM _prisma_migrations;');
    console.log('1. Read _prisma_migrations:', migs);
  } catch (err) {
    console.log('1. Read _prisma_migrations FAILED:', err.message);
  }

  // 2. Can knowletive_app insert into _prisma_migrations?
  try {
    await appPrisma.$queryRawUnsafe(`
      INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES ('test-id', 'test-checksum', now(), 'test_migration', null, null, now(), 1);
    `);
    console.log('2. Insert _prisma_migrations: SUCCEEDED (unexpected for pure read-only)');
    // Clean up
    await appPrisma.$queryRawUnsafe("DELETE FROM _prisma_migrations WHERE id = 'test-id';");
  } catch (err) {
    console.log('2. Insert _prisma_migrations FAILED (expected if not granted):', err.message);
  }

  // 3. Can knowletive_app execute DDL (CREATE TABLE)?
  try {
    await appPrisma.$queryRawUnsafe('CREATE TABLE test_ddl (id text);');
    console.log('3. CREATE TABLE: SUCCEEDED');
    await appPrisma.$queryRawUnsafe('DROP TABLE test_ddl;');
  } catch (err) {
    console.log('3. CREATE TABLE FAILED (expected):', err.message);
  }

  // 4. Can knowletive_app ALTER TABLE on an existing table?
  try {
    await appPrisma.$queryRawUnsafe('ALTER TABLE "Branch" ADD COLUMN test_col text;');
    console.log('4. ALTER TABLE "Branch": SUCCEEDED');
  } catch (err) {
    console.log('4. ALTER TABLE "Branch" FAILED (expected):', err.message);
  }
}

main().catch(console.error).finally(() => appPrisma.$disconnect());
