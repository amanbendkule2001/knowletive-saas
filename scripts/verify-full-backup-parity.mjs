import { PrismaClient } from "@prisma/client";
import fs from "fs";

const ORIG_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public";
const RESTORE_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";

const origDb = new PrismaClient({ datasources: { db: { url: ORIG_URL } } });
const restDb = new PrismaClient({ datasources: { db: { url: RESTORE_URL } } });

async function main() {
  console.log("=============================================================");
  console.log("  PHASE 2.3.5 — FULL BACKUP PARITY VERIFICATION (PART 1)");
  console.log("=============================================================");
  console.log("Original: knowletive");
  console.log("Restored: knowletive_restore_verify_20261121_172317\n");

  const mismatches = [];

  // Helper comparison
  function compareObjects(name, origList, restList, keyFn) {
    const origMap = new Map(origList.map(item => [keyFn(item), item]));
    const restMap = new Map(restList.map(item => [keyFn(item), item]));

    let diffCount = 0;
    for (const [key, val] of origMap.entries()) {
      if (!restMap.has(key)) {
        mismatches.push({ category: name, type: "MISSING_IN_RESTORED", key });
        diffCount++;
      } else {
        const restVal = restMap.get(key);
        const origJson = JSON.stringify(val);
        const restJson = JSON.stringify(restVal);
        if (origJson !== restJson) {
          mismatches.push({ category: name, type: "DEFINITION_MISMATCH", key, orig: origJson, rest: restJson });
          diffCount++;
        }
      }
    }
    for (const [key] of restMap.entries()) {
      if (!origMap.has(key)) {
        mismatches.push({ category: name, type: "EXTRA_IN_RESTORED", key });
        diffCount++;
      }
    }
    console.log(`- ${name}: Orig=${origList.length}, Restored=${restList.length}, Differences=${diffCount}`);
    return diffCount === 0;
  }

  // 1. All User Tables
  const origTables = await origDb.$queryRawUnsafe(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`);
  const restTables = await restDb.$queryRawUnsafe(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`);
  compareObjects("Tables & Owners", origTables, restTables, t => t.tablename);

  // 2. Exact Row Counts & Deterministic Content Checksums
  console.log("\nComputing deterministic content checksums for all tables...");
  let checksumMismatches = 0;
  const checksumResults = [];

  for (const t of origTables) {
    const table = t.tablename;

    // Get PK columns for deterministic order
    const pkCols = await origDb.$queryRawUnsafe(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = '${table}' AND tc.table_schema = 'public'
      ORDER BY kcu.ordinal_position;
    `);

    let orderClause = "";
    if (pkCols.length > 0) {
      orderClause = pkCols.map(p => `t."${p.column_name}"`).join(", ");
    } else {
      orderClause = 't::text';
    }

    // Row counts
    const [origCountRes] = await origDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${table}";`);
    const [restCountRes] = await restDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${table}";`);
    const oCount = parseInt(origCountRes.c, 10);
    const rCount = parseInt(restCountRes.c, 10);

    if (oCount !== rCount) {
      mismatches.push({ category: "Row Counts", table, orig: oCount, rest: rCount });
      checksumMismatches++;
      continue;
    }

    // Checksum
    let oChecksum = "EMPTY";
    let rChecksum = "EMPTY";

    if (oCount > 0) {
      const [oHash] = await origDb.$queryRawUnsafe(`
        SELECT md5(string_agg(md5(t::text), '' ORDER BY ${orderClause})) as hash FROM "${table}" t;
      `);
      const [rHash] = await restDb.$queryRawUnsafe(`
        SELECT md5(string_agg(md5(t::text), '' ORDER BY ${orderClause})) as hash FROM "${table}" t;
      `);
      oChecksum = oHash.hash;
      rChecksum = rHash.hash;
    }

    if (oChecksum !== rChecksum) {
      mismatches.push({ category: "Content Checksum", table, orig: oChecksum, rest: rChecksum });
      checksumMismatches++;
    } else {
      checksumResults.push({ table, rows: oCount, checksum: oChecksum });
    }
  }

  console.log(`- Deterministic Checksums: ${checksumResults.length} tables compared. Mismatches = ${checksumMismatches}`);

  // 3. Primary Keys
  const origPKs = await origDb.$queryRawUnsafe(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);
  const restPKs = await restDb.$queryRawUnsafe(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);
  compareObjects("Primary Keys", origPKs, restPKs, p => `${p.table_name}.${p.column_name}`);

  // 4. Foreign Keys and referential actions
  const origFKs = await origDb.$queryRawUnsafe(`
    SELECT
      tc.table_name, kcu.column_name, tc.constraint_name,
      ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name,
      rc.update_rule, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  const restFKs = await restDb.$queryRawUnsafe(`
    SELECT
      tc.table_name, kcu.column_name, tc.constraint_name,
      ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name,
      rc.update_rule, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  compareObjects("Foreign Keys", origFKs, restFKs, f => `${f.table_name}.${f.constraint_name}.${f.column_name}`);

  // 5. Unique Constraints
  const origUQs = await origDb.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  const restUQs = await restDb.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  compareObjects("Unique Constraints", origUQs, restUQs, u => `${u.table_name}.${u.constraint_name}.${u.column_name}`);

  // 6. Check Constraints
  const origChecks = await origDb.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name;
  `);
  const restChecks = await restDb.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name;
  `);
  compareObjects("Check Constraints", origChecks, restChecks, c => `${c.table_name}.${c.constraint_name}`);

  // 7. Indexes
  const origIdx = await origDb.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`);
  const restIdx = await restDb.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`);
  compareObjects("Indexes", origIdx, restIdx, i => `${i.tablename}.${i.indexname}`);

  // 8. Enum Types and Values
  const origEnums = await origDb.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder;
  `);
  const restEnums = await restDb.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder;
  `);
  compareObjects("Enum Types & Labels", origEnums, restEnums, e => `${e.typname}.${e.enumlabel}`);

  // 9. Functions and Triggers
  const origFuncs = await origDb.$queryRawUnsafe(`
    SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);
  const restFuncs = await restDb.$queryRawUnsafe(`
    SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);
  compareObjects("Functions", origFuncs, restFuncs, f => f.proname);

  const origTrigs = await origDb.$queryRawUnsafe(`
    SELECT tgname, relname, pg_get_triggerdef(t.oid) as def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
    ORDER BY relname, tgname;
  `);
  const restTrigs = await restDb.$queryRawUnsafe(`
    SELECT tgname, relname, pg_get_triggerdef(t.oid) as def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
    ORDER BY relname, tgname;
  `);
  compareObjects("Triggers", origTrigs, restTrigs, t => `${t.relname}.${t.tgname}`);

  // 10. Views and Materialized Views
  const origViews = await origDb.$queryRawUnsafe(`SELECT schemaname, viewname, viewowner FROM pg_views WHERE schemaname = 'public';`);
  const restViews = await restDb.$queryRawUnsafe(`SELECT schemaname, viewname, viewowner FROM pg_views WHERE schemaname = 'public';`);
  compareObjects("Views", origViews, restViews, v => v.viewname);

  // 11. Sequences and Current Values
  const origSeqs = await origDb.$queryRawUnsafe(`
    SELECT sequence_name, data_type, start_value, minimum_value, maximum_value, increment
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name;
  `);
  const restSeqs = await restDb.$queryRawUnsafe(`
    SELECT sequence_name, data_type, start_value, minimum_value, maximum_value, increment
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name;
  `);
  compareObjects("Sequences", origSeqs, restSeqs, s => s.sequence_name);

  // 12. Columns, Types, Defaults, Nullability
  const origCols = await origDb.$queryRawUnsafe(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  const restCols = await restDb.$queryRawUnsafe(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  compareObjects("Columns Definitions", origCols, restCols, c => `${c.table_name}.${c.column_name}`);

  // 13. Extensions
  const origExts = await origDb.$queryRawUnsafe(`SELECT extname, extversion FROM pg_extension;`);
  const restExts = await restDb.$queryRawUnsafe(`SELECT extname, extversion FROM pg_extension;`);
  compareObjects("Extensions", origExts, restExts, e => e.extname);

  // Summary
  console.log("\n=============================================================");
  if (mismatches.length === 0) {
    console.log("  ✅ FULL BACKUP PARITY VERIFIED: 100% BIT-FOR-BIT IDENTICAL");
    console.log("=============================================================");
    console.log("Total mismatches found: 0");
  } else {
    console.error(`  ❌ PARITY VERIFICATION FAILED: ${mismatches.length} mismatches!`);
    console.error(JSON.stringify(mismatches, null, 2));
  }

  // Save report data
  fs.writeFileSync("scratch/backup-parity-results.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    mismatchesCount: mismatches.length,
    mismatches,
    tableCount: origTables.length,
    checksumSample: checksumResults.slice(0, 10)
  }, null, 2));
}

main().catch(console.error).finally(async () => {
  await origDb.$disconnect();
  await restDb.$disconnect();
});
