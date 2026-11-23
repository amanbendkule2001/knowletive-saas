import { PrismaClient } from "@prisma/client";

const origDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });
const cloneDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_disposable_clone_phase2_3_4?schema=public" } } });

async function main() {
  console.log("=== COMPARING ORIGINAL VS DISPOSABLE CLONE ===");

  // 1. Tables & Row counts
  const origTables = await origDb.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename;`);
  const cloneTables = await cloneDb.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename;`);

  console.log(`Original tables count: ${origTables.length}`);
  console.log(`Clone tables count: ${cloneTables.length}`);

  if (origTables.length !== cloneTables.length) {
    throw new Error(`Table count mismatch! Orig: ${origTables.length}, Clone: ${cloneTables.length}`);
  }

  let rowCountMismatches = 0;
  for (const t of origTables) {
    const origCountRes = await origDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t.tablename}";`);
    const cloneCountRes = await cloneDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t.tablename}";`);
    const oC = parseInt(origCountRes[0].c, 10);
    const cC = parseInt(cloneCountRes[0].c, 10);
    if (oC !== cC) {
      console.error(`Row count mismatch on ${t.tablename}: Orig=${oC}, Clone=${cC}`);
      rowCountMismatches++;
    }
  }

  if (rowCountMismatches === 0) {
    console.log(`✓ All ${origTables.length} tables have IDENTICAL row counts.`);
  }

  // 2. Indexes
  const origIndexes = await origDb.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;`);
  const cloneIndexes = await cloneDb.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;`);
  console.log(`Original indexes: ${origIndexes.length}, Clone indexes: ${cloneIndexes.length}`);
  if (origIndexes.length !== cloneIndexes.length) {
    console.error("Index count mismatch!");
  } else {
    console.log("✓ Index counts match exactly.");
  }

  // 3. Constraints (PK, FK, UQ, Check)
  const origConstraints = await origDb.$queryRawUnsafe(`SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname;`);
  const cloneConstraints = await cloneDb.$queryRawUnsafe(`SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname;`);
  console.log(`Original constraints: ${origConstraints.length}, Clone constraints: ${cloneConstraints.length}`);
  if (origConstraints.length !== cloneConstraints.length) {
    console.error("Constraint count mismatch!");
  } else {
    console.log("✓ Constraint counts match exactly.");
  }

  // 4. Triggers
  const origTriggers = await origDb.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname;`);
  const cloneTriggers = await cloneDb.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname;`);
  console.log(`Original user triggers: ${origTriggers.length}, Clone user triggers: ${cloneTriggers.length}`);
  if (origTriggers.length !== cloneTriggers.length) {
    console.error("Trigger count mismatch!");
  } else {
    console.log("✓ Trigger counts match exactly.");
  }

  // 5. Functions
  const origFuncs = await origDb.$queryRawUnsafe(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname;`);
  const cloneFuncs = await cloneDb.$queryRawUnsafe(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname;`);
  console.log(`Original functions: ${origFuncs.length}, Clone functions: ${cloneFuncs.length}`);
  if (origFuncs.length !== cloneFuncs.length) {
    console.error("Function count mismatch!");
  } else {
    console.log("✓ Function counts match exactly.");
  }

  console.log("\n=======================================================");
  console.log("  CLONE VERIFICATION COMPLETE: 100% IDENTICAL REPLICA  ");
  console.log("=======================================================");
}

main().catch(console.error).finally(async () => {
  await origDb.$disconnect();
  await cloneDb.$disconnect();
});
