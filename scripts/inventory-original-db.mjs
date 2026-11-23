import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("Connecting to knowletive database (read-only inventory)...");

  // 1. Schemas
  const schemas = await db.$queryRawUnsafe(`
    SELECT schema_name, schema_owner 
    FROM information_schema.schemata 
    WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema';
  `);

  // 2. Tables & Owners
  const tables = await db.$queryRawUnsafe(`
    SELECT schemaname, tablename, tableowner 
    FROM pg_tables 
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename;
  `);

  // Row counts for every table
  const tableCounts = [];
  for (const t of tables) {
    try {
      const res = await db.$queryRawUnsafe(`SELECT count(*)::text as count FROM "${t.schemaname}"."${t.tablename}";`);
      tableCounts.push({ schema: t.schemaname, table: t.tablename, owner: t.tableowner, count: parseInt(res[0].count, 10) });
    } catch (e) {
      tableCounts.push({ schema: t.schemaname, table: t.tablename, owner: t.tableowner, error: e.message });
    }
  }

  // 3. Columns, Types, Nullability
  const columns = await db.$queryRawUnsafe(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);

  // 4. Primary Keys
  const primaryKeys = await db.$queryRawUnsafe(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);

  // 5. Foreign Keys
  const foreignKeys = await db.$queryRawUnsafe(`
    SELECT
      tc.table_name,
      kcu.column_name,
      tc.constraint_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
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

  // 6. Unique Constraints
  const uniqueConstraints = await db.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);

  // 7. Check Constraints
  const checkConstraints = await db.$queryRawUnsafe(`
    SELECT tc.table_name, tc.constraint_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name;
  `);

  // 8. Indexes
  const indexes = await db.$queryRawUnsafe(`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `);

  // 9. Enums & Custom Types
  const enums = await db.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder;
  `);

  // 10. Triggers
  const triggers = await db.$queryRawUnsafe(`
    SELECT trigger_name, event_manipulation, event_object_table, action_statement, action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `);

  // 11. Functions & Procedures
  const functions = await db.$queryRawUnsafe(`
    SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);

  // 12. Views
  const views = await db.$queryRawUnsafe(`
    SELECT schemaname, viewname, viewowner, definition
    FROM pg_views
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, viewname;
  `);

  // 13. Schema & Table Privileges
  const schemaPrivs = await db.$queryRawUnsafe(`
    SELECT nspname as schema_name, nspacl::text as acl 
    FROM pg_namespace 
    WHERE nspname = 'public';
  `);

  const tablePrivs = await db.$queryRawUnsafe(`
    SELECT grantee, table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND grantee IN ('knowletive', 'knowletive_app', 'public')
    ORDER BY table_name, grantee, privilege_type;
  `);

  // 14. Existing Migration Objects
  const migrationObjects = await db.$queryRawUnsafe(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name LIKE '%migration%' OR table_name LIKE '%prisma%'
    ORDER BY table_schema, table_name;
  `);

  const out = {
    database: "knowletive",
    schemas,
    tableCounts,
    columns,
    primaryKeys,
    foreignKeys,
    uniqueConstraints,
    checkConstraints,
    indexes,
    enums,
    triggers,
    functions,
    views,
    schemaPrivs,
    tablePrivs,
    migrationObjects
  };

  const outputPath = path.resolve("scratch/original-db-inventory.json");
  // ensure scratch dir
  if (!fs.existsSync("scratch")) fs.mkdirSync("scratch");
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`Inventory successfully written to ${outputPath}`);
  console.log(`Total tables found: ${tableCounts.length}`);
  console.log(`Total views found: ${views.length}`);
  console.log(`Total functions found: ${functions.length}`);
  console.log(`Total triggers found: ${triggers.length}`);
  console.log(`Total enums found: ${Array.from(new Set(enums.map(e => e.typname))).length}`);
  console.log(`Migration objects found: ${migrationObjects.length}`);
}

main().catch(console.error).finally(() => db.$disconnect());
