import { PrismaClient } from "@prisma/client";

const ORIG_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public";
const CLONE_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";

const origDb = new PrismaClient({ datasources: { db: { url: ORIG_URL } } });
const cloneDb = new PrismaClient({ datasources: { db: { url: CLONE_URL } } });

async function runCatalogReconciliation() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.1 — ITEM 1: POSTGRESQL CATALOG COUNT RECONCILIATION");
  console.log("===============================================================================");
  console.log(`Original DB: ${ORIG_URL}`);
  console.log(`Clone DB:    ${CLONE_URL}`);

  const queries = {
    // 1. Table Count (User Tables)
    tables: `
      SELECT count(*)::int as count 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND c.relkind = 'r';
    `,

    // 2. Views Count
    views: `
      SELECT count(*)::int as count 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND c.relkind = 'v';
    `,

    // 3. Primary Keys via pg_constraint
    primaryKeys: `
      SELECT count(*)::int as count 
      FROM pg_constraint c 
      JOIN pg_namespace n ON n.oid = c.connamespace 
      WHERE n.nspname = 'public' AND c.contype = 'p';
    `,

    // 4. Foreign Keys via pg_constraint
    foreignKeys: `
      SELECT count(*)::int as count 
      FROM pg_constraint c 
      JOIN pg_namespace n ON n.oid = c.connamespace 
      WHERE n.nspname = 'public' AND c.contype = 'f';
    `,

    // 5. Unique Constraints via pg_constraint (contype = 'u')
    uniqueConstraintsPgConstraint: `
      SELECT count(*)::int as count 
      FROM pg_constraint c 
      JOIN pg_namespace n ON n.oid = c.connamespace 
      WHERE n.nspname = 'public' AND c.contype = 'u';
    `,

    // 6. Unique Constraints via information_schema.table_constraints
    uniqueConstraintsInfoSchema: `
      SELECT count(*)::int as count 
      FROM information_schema.table_constraints 
      WHERE table_schema = 'public' AND constraint_type = 'UNIQUE';
    `,

    // 7. Unique Indexes via pg_index
    uniqueIndexes: `
      SELECT count(*)::int as count 
      FROM pg_index i 
      JOIN pg_class c ON c.oid = i.indexrelid 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND i.indisunique = true;
    `,

    // 8. Total Indexes via pg_indexes
    totalIndexes: `
      SELECT count(*)::int as count 
      FROM pg_indexes 
      WHERE schemaname = 'public';
    `,

    // 9. Check Constraints via pg_constraint (contype = 'c')
    checkConstraints: `
      SELECT count(*)::int as count 
      FROM pg_constraint c 
      JOIN pg_namespace n ON n.oid = c.connamespace 
      WHERE n.nspname = 'public' AND c.contype = 'c';
    `,

    // 10. Enum Types
    enumTypes: `
      SELECT count(*)::int as count 
      FROM pg_type t 
      JOIN pg_namespace n ON n.oid = t.typnamespace 
      WHERE n.nspname = 'public' AND t.typtype = 'e';
    `,

    // 11. Enum Labels
    enumLabels: `
      SELECT count(*)::int as count 
      FROM pg_enum e 
      JOIN pg_type t ON t.oid = e.enumtypid 
      JOIN pg_namespace n ON n.oid = t.typnamespace 
      WHERE n.nspname = 'public';
    `,

    // 12. Triggers
    triggers: `
      SELECT count(*)::int as count 
      FROM pg_trigger trg 
      JOIN pg_class c ON c.oid = trg.tgrelid 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND NOT trg.tgisinternal;
    `,

    // 13. Functions
    functions: `
      SELECT count(*)::int as count 
      FROM pg_proc p 
      JOIN pg_namespace n ON n.oid = p.pronamespace 
      WHERE n.nspname = 'public';
    `,

    // 14. Sequences
    sequences: `
      SELECT count(*)::int as count 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' AND c.relkind = 'S';
    `
  };

  const results = [];

  for (const [key, sql] of Object.entries(queries)) {
    const origRes = await origDb.$queryRawUnsafe(sql);
    const cloneRes = await cloneDb.$queryRawUnsafe(sql);
    const origCount = origRes[0].count;
    const cloneCount = cloneRes[0].count;
    const diff = cloneCount - origCount;
    results.push({
      metric: key,
      original: origCount,
      migratedClone: cloneCount,
      difference: diff > 0 ? `+${diff}` : `${diff}`
    });
  }

  console.table(results);

  // Now let's dive into the details of the differences:
  console.log("\n--- DETAILED CATALOG DISCREPANCY ANALYSIS ---");

  // A. Investigate Unique Constraints vs Unique Indexes
  console.log("\nA. Unique Constraints vs Unique Indexes:");
  const uqPgConOrig = await origDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'u'
    ORDER BY tablename, conname;
  `);
  console.log(`- pg_constraint contype='u' in Original DB (${uqPgConOrig.length} found):`);
  uqPgConOrig.forEach(c => console.log(`    ${c.tablename}.${c.conname}: ${c.def}`));

  const uqPgConClone = await cloneDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'u'
    ORDER BY tablename, conname;
  `);
  console.log(`- pg_constraint contype='u' in Migrated Clone (${uqPgConClone.length} found):`);
  uqPgConClone.forEach(c => console.log(`    ${c.tablename}.${c.conname}: ${c.def}`));

  // B. Investigate Difference in Unique Indexes
  const uqIdxOrig = await origDb.$queryRawUnsafe(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    ORDER BY tablename, indexname;
  `);
  const uqIdxClone = await cloneDb.$queryRawUnsafe(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    ORDER BY tablename, indexname;
  `);

  const origUqIdxNames = new Set(uqIdxOrig.map(i => i.indexname));
  const cloneUqIdxNames = new Set(uqIdxClone.map(i => i.indexname));

  const addedUqIndexes = uqIdxClone.filter(i => !origUqIdxNames.has(i.indexname));
  const removedUqIndexes = uqIdxOrig.filter(i => !cloneUqIdxNames.has(i.indexname));

  console.log(`\n- Unique Indexes added in Migrated Clone (+${addedUqIndexes.length}):`);
  addedUqIndexes.forEach(i => console.log(`    + ${i.tablename}.${i.indexname}: ${i.indexdef}`));
  if (removedUqIndexes.length > 0) {
    console.log(`- Unique Indexes removed in Migrated Clone (-${removedUqIndexes.length}):`);
    removedUqIndexes.forEach(i => console.log(`    - ${i.tablename}.${i.indexname}: ${i.indexdef}`));
  }

  // C. Investigate Foreign Keys Added / Changed
  const fksOrig = await origDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, confrelid::regclass::text as reftable, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'f'
    ORDER BY tablename, conname;
  `);
  const fksClone = await cloneDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, confrelid::regclass::text as reftable, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'f'
    ORDER BY tablename, conname;
  `);

  const origFkMap = new Map(fksOrig.map(f => [`${f.tablename}.${f.conname}`, f]));
  const cloneFkMap = new Map(fksClone.map(f => [`${f.tablename}.${f.conname}`, f]));

  console.log(`\n- Foreign Keys added in Migrated Clone:`);
  for (const [k, f] of cloneFkMap.entries()) {
    if (!origFkMap.has(k)) {
      console.log(`    + ${f.tablename}.${f.conname}: ${f.def}`);
    }
  }

  // D. Investigate Check Constraints
  const checksOrig = await origDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'c'
    ORDER BY tablename, conname;
  `);
  const checksClone = await cloneDb.$queryRawUnsafe(`
    SELECT conname, conrelid::regclass::text as tablename, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'c'
    ORDER BY tablename, conname;
  `);

  const origCheckMap = new Map(checksOrig.map(c => [`${c.tablename}.${c.conname}`, c]));
  const cloneCheckMap = new Map(checksClone.map(c => [`${c.tablename}.${c.conname}`, c]));

  console.log(`\n- Check Constraints added in Migrated Clone:`);
  for (const [k, c] of cloneCheckMap.entries()) {
    if (!origCheckMap.has(k)) {
      console.log(`    + ${c.tablename}.${c.conname}: ${c.def}`);
    }
  }

  // E. Investigate Functions
  const funcsOrig = await origDb.$queryRawUnsafe(`
    SELECT proname, prosecdef, pg_get_functiondef(oid) as def
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
    ORDER BY proname;
  `);
  const funcsClone = await cloneDb.$queryRawUnsafe(`
    SELECT proname, prosecdef, pg_get_functiondef(oid) as def
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
    ORDER BY proname;
  `);
  const origFuncNames = new Set(funcsOrig.map(f => f.proname));
  const cloneFuncNames = new Set(funcsClone.map(f => f.proname));
  console.log(`\n- Functions added in Migrated Clone:`);
  funcsClone.filter(f => !origFuncNames.has(f.proname)).forEach(f => {
    console.log(`    + ${f.proname} (SECURITY ${f.prosecdef ? 'DEFINER' : 'INVOKER'})`);
  });

  // F. Investigate Views
  const viewsOrig = await origDb.$queryRawUnsafe(`
    SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' ORDER BY relname;
  `);
  const viewsClone = await cloneDb.$queryRawUnsafe(`
    SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' ORDER BY relname;
  `);
  const origViewNames = new Set(viewsOrig.map(v => v.relname));
  console.log(`\n- Views added in Migrated Clone:`);
  viewsClone.filter(v => !origViewNames.has(v.relname)).forEach(v => {
    console.log(`    + ${v.relname}`);
  });

  await origDb.$disconnect();
  await cloneDb.$disconnect();
}

runCatalogReconciliation().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
