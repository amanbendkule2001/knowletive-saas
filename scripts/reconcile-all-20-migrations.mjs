import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const db = new PrismaClient({
  datasources: { db: { url: "postgresql://knowletive:postgres@127.0.0.1:5432/knowletive_adoption_rehearsal_20261123?schema=public" } }
});

async function main() {
  console.log("=== COMPREHENSIVE RECONCILIATION OF ALL 20 MIGRATIONS AGAINST ADOPTION REHEARSAL DATABASE ===\n");

  // Fetch full catalog
  const tables = (await db.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`)).map(t => t.tablename);
  const views = (await db.$queryRawUnsafe(`SELECT viewname FROM pg_views WHERE schemaname = 'public';`)).map(v => v.viewname);
  const columns = await db.$queryRawUnsafe(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public';`);
  const enums = (await db.$queryRawUnsafe(`SELECT DISTINCT typname FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public';`)).map(e => e.typname);
  const functions = (await db.$queryRawUnsafe(`SELECT proname, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace;`));
  const triggers = (await db.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`)).map(t => t.tgname);
  const indexes = (await db.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public';`)).map(i => i.indexname);
  const constraints = (await db.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace;`)).map(c => c.conname);

  const hasTable = t => tables.includes(t);
  const hasView = v => views.includes(v);
  const hasCol = (t, c) => columns.some(x => x.table_name === t && x.column_name === c);
  const hasEnum = e => enums.includes(e);
  const hasFunc = f => functions.some(x => x.proname === f);
  const getFuncConfig = f => {
    const fn = functions.find(x => x.proname === f);
    return fn ? fn.proconfig : null;
  };
  const hasTrig = t => triggers.includes(t);
  const hasIndex = i => indexes.includes(i);
  const hasConstraint = c => constraints.includes(c);

  const migrationsDir = "prisma/migrations";
  const migrationDirs = fs.readdirSync(migrationsDir).filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory()).sort();

  console.log(`Found ${migrationDirs.length} migration directories in prisma/migrations.\n`);

  const results = [];

  for (const mig of migrationDirs) {
    const migSqlPath = path.join(migrationsDir, mig, "migration.sql");
    const sqlContent = fs.readFileSync(migSqlPath, "utf8");

    // Extract key DDL items from SQL
    // 1. CREATE TABLE
    const tableMatches = [...sqlContent.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)].map(m => m[1]);
    // 2. CREATE VIEW
    const viewMatches = [...sqlContent.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)].map(m => m[1]);
    // 3. CREATE TYPE ... ENUM
    const enumMatches = [...sqlContent.matchAll(/CREATE\s+TYPE\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s+AS\s+ENUM/gi)].map(m => m[1]);
    // 4. CREATE FUNCTION
    const funcMatches = [...sqlContent.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi)].map(m => m[1]);
    // 5. CREATE TRIGGER
    const trigMatches = [...sqlContent.matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z0-9_]+)"?/gi)].map(m => m[1]);
    // 6. ADD CONSTRAINT
    const conMatches = [...sqlContent.matchAll(/ADD\s+CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?/gi)].map(m => m[1]);
    // 7. CREATE INDEX
    const idxMatches = [...sqlContent.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)].map(m => m[1]);
    // 8. ADD COLUMN
    const colMatches = [...sqlContent.matchAll(/ALTER\s+TABLE\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)].map(m => ({ table: m[1], col: m[2] }));

    const checks = [];
    tableMatches.forEach(t => checks.push({ type: "Table", name: t, present: hasTable(t) }));
    viewMatches.forEach(v => checks.push({ type: "View", name: v, present: hasView(v) }));
    enumMatches.forEach(e => checks.push({ type: "Enum", name: e, present: hasEnum(e) }));
    funcMatches.forEach(f => checks.push({ type: "Function", name: f, present: hasFunc(f) }));
    trigMatches.forEach(t => checks.push({ type: "Trigger", name: t, present: hasTrig(t) }));
    conMatches.forEach(c => checks.push({ type: "Constraint", name: c, present: hasConstraint(c) }));
    idxMatches.forEach(i => checks.push({ type: "Index", name: i, present: hasIndex(i) }));
    colMatches.forEach(c => checks.push({ type: "Column", name: `${c.table}.${c.col}`, present: hasCol(c.table, c.col) }));

    const total = checks.length;
    const presentCount = checks.filter(c => c.present).length;
    let status = "MISSING";
    if (total > 0 && presentCount === total) {
      status = "ALREADY PRESENT";
    } else if (presentCount > 0 && presentCount < total) {
      status = "PARTIALLY PRESENT";
    } else if (total === 0) {
      status = "SPECIAL / CONFIG";
    }

    results.push({
      migration: mig,
      totalChecks: total,
      presentCount,
      status,
      missingItems: checks.filter(c => !c.present).map(c => `${c.type}: ${c.name}`)
    });
  }

  for (const r of results) {
    console.log(`[${r.status.padEnd(17)}] ${r.migration} (${r.presentCount}/${r.totalChecks} checks present)`);
    if (r.missingItems.length > 0) {
      console.log(`   Missing: ${r.missingItems.join(", ")}`);
    }
  }
}

main().catch(console.error).finally(() => db.$disconnect());
