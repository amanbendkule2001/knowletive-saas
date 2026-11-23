import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const DB_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("===============================================================================");
  console.log(`  PHASE 2.3.5.3 — ITEM 2: POSTGRESQL ROLE SEPARATION AUDIT ON ${DB_NAME}`);
  console.log("===============================================================================");

  // 1. Roles & Attributes
  console.log("\n1. Inspecting pg_roles:");
  const roles = await db.$queryRawUnsafe(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolconnlimit
    FROM pg_roles
    WHERE rolname IN ('knowletive', 'knowletive_app', 'postgres')
    ORDER BY rolname;
  `);
  console.table(roles);

  // 2. Role Memberships (pg_auth_members)
  console.log("\n2. Inspecting pg_auth_members (Inheritance & Group Memberships):");
  const memberships = await db.$queryRawUnsafe(`
    SELECT r.rolname as role_name, m.rolname as member_of, am.admin_option
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.member
    JOIN pg_roles m ON m.oid = am.roleid
    WHERE r.rolname IN ('knowletive', 'knowletive_app');
  `);
  if (memberships.length === 0) {
    console.log("  ✓ knowletive_app is NOT a member of any other role (zero role inheritance).");
  } else {
    console.table(memberships);
  }

  // 3. Database Ownership
  console.log("\n3. Database Ownership:");
  const dbOwner = await db.$queryRawUnsafe(`
    SELECT d.datname, r.rolname as owner
    FROM pg_database d
    JOIN pg_roles r ON r.oid = d.datdba
    WHERE d.datname = current_database();
  `);
  console.table(dbOwner);

  // 4. Schema Ownership & Public Privileges
  console.log("\n4. Schema Ownership & Schema Privileges:");
  const schemaOwner = await db.$queryRawUnsafe(`
    SELECT n.nspname, r.rolname as owner,
           has_schema_privilege('knowletive_app', n.nspname, 'USAGE') as app_usage,
           has_schema_privilege('knowletive_app', n.nspname, 'CREATE') as app_create,
           has_schema_privilege('public', n.nspname, 'CREATE') as public_create
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'public';
  `);
  console.table(schemaOwner);

  // 5. Table Ownership
  console.log("\n5. Table Ownership Breakdown:");
  const tableOwners = await db.$queryRawUnsafe(`
    SELECT tableowner, count(*)::int as table_count
    FROM pg_tables
    WHERE schemaname = 'public'
    GROUP BY tableowner;
  `);
  console.table(tableOwners);

  // 6. Function Ownership & SECURITY DEFINER Analysis
  console.log("\n6. Functions: Ownership & Security Mode:");
  const funcs = await db.$queryRawUnsafe(`
    SELECT p.proname, r.rolname as owner, p.prosecdef as is_security_definer,
           p.proconfig as config
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.pronamespace = 'public'::regnamespace
    ORDER BY p.prosecdef DESC, p.proname;
  `);
  const secDefiners = funcs.filter(f => f.is_security_definer);
  const secInvokers = funcs.filter(f => !f.is_security_definer);
  console.log(`  Total User Functions: ${funcs.length}`);
  console.log(`  SECURITY DEFINER functions: ${secDefiners.length}`);
  console.log(`  SECURITY INVOKER functions: ${secInvokers.length}`);
  console.log("\n  SECURITY DEFINER functions listing:");
  secDefiners.forEach(f => console.log(`    - ${f.proname} (Owner: ${f.owner}, Config: ${JSON.stringify(f.config)})`));

  // 7. Table Privileges Audit for knowletive_app
  console.log("\n7. Table Privileges Summary for knowletive_app:");
  const privSummary = await db.$queryRawUnsafe(`
    SELECT 
      table_name,
      string_agg(privilege_type, ', ' ORDER BY privilege_type) as privileges
    FROM information_schema.table_privileges
    WHERE grantee = 'knowletive_app' AND table_schema = 'public'
    GROUP BY table_name
    ORDER BY table_name;
  `);
  console.log(`  Found ${privSummary.length} tables with explicit privileges granted to knowletive_app.`);

  // Check immutable tables
  const immutables = [
    "PaymentReceipt", "FeePayment", "PaymentAllocation", "PaymentAllocationReversal",
    "CreditTransferJournal", "CreditTransferPosting", "BranchLedgerEntry",
    "BranchReconciliationAudit", "AuditLog", "LeadActivity", "NotificationLog",
    "GuardianConsentEvent"
  ];

  console.log("\n  Immutability check on the 12 tables:");
  for (const t of immutables) {
    const entry = privSummary.find(p => p.table_name === t);
    const privs = entry ? entry.privileges : "NONE";
    const hasUpdate = privs.includes("UPDATE");
    const hasDelete = privs.includes("DELETE");
    console.log(`    - ${t}: ${privs} -> ${!hasUpdate && !hasDelete ? "✓ STRICTLY IMMUTABLE" : "❌ CONTAINS UPDATE/DELETE"}`);
  }

  // 8. Sequence Privileges
  console.log("\n8. Sequence Privileges for knowletive_app:");
  const seqs = await db.$queryRawUnsafe(`
    SELECT sequence_name, string_agg(privilege_type, ', ') as privs
    FROM information_schema.sequences s
    LEFT JOIN information_schema.usage_privileges u ON u.object_name = s.sequence_name
    WHERE s.sequence_schema = 'public'
    GROUP BY sequence_name;
  `);
  console.log(`  Sequences present in public schema: ${seqs.length}`);

  await db.$disconnect();
}

main().catch(console.error);
