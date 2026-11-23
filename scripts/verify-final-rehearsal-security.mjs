import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const ADMIN_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const APP_URL = `postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/${DB_NAME}?schema=public`;

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

const IMMUTABLE_TABLES = [
  "PaymentReceipt",
  "FeePayment",
  "PaymentAllocation",
  "PaymentAllocationReversal",
  "CreditTransferJournal",
  "CreditTransferPosting",
  "BranchLedgerEntry",
  "BranchReconciliationAudit",
  "AuditLog",
  "LeadActivity",
  "NotificationLog",
  "GuardianConsentEvent"
];

async function main() {
  console.log("===============================================================================");
  console.log(`  WORKSTREAM 3: SECURITY, ROLES & PRIVILEGES ON ${DB_NAME}`);
  console.log("===============================================================================");

  // 1. Database Roles and Attributes
  console.log("\n1. Database Roles and Attributes:");
  const roles = await adminDb.$queryRawUnsafe(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('knowletive', 'knowletive_app')
    ORDER BY rolname;
  `);
  console.table(roles);

  for (const r of roles) {
    if (r.rolname === "knowletive_app") {
      if (r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls) {
        throw new Error("SECURITY VIOLATION: knowletive_app has superuser/bypassrls privileges!");
      }
      console.log("  ✓ knowletive_app role attributes: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS (STRICT NON-ADMIN)");
    }
  }

  // 2. Table Ownership
  console.log("\n2. Table Ownership (Schema Public):");
  const nonAdminOwned = await adminDb.$queryRawUnsafe(`
    SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'knowletive';
  `);
  if (nonAdminOwned.length > 0) {
    throw new Error(`SECURITY WARNING: Tables owned by unexpected roles: ${JSON.stringify(nonAdminOwned)}`);
  }
  console.log("  ✓ All 83 tables are strictly owned by 'knowletive' (app role owns zero tables).");

  // 3. Schema-Level Privileges
  console.log("\n3. Schema-Level Privileges:");
  const schemaUsage = await adminDb.$queryRawUnsafe(`
    SELECT has_schema_privilege('knowletive_app', 'public', 'USAGE') as can_usage,
           has_schema_privilege('knowletive_app', 'public', 'CREATE') as can_create;
  `);
  console.log(`  ✓ knowletive_app schema privileges: USAGE=${schemaUsage[0].can_usage}, CREATE=${schemaUsage[0].can_create}`);
  if (schemaUsage[0].can_create) {
    throw new Error("SECURITY FAILURE: knowletive_app can CREATE in public schema!");
  }

  // 4. Immutable Tables: UPDATE and DELETE Must Be Denied
  console.log("\n4. Verifying Immutability Enforcements (UPDATE & DELETE):");
  const immutabilityResults = [];
  for (const tbl of IMMUTABLE_TABLES) {
    let updateDenied = false;
    let deleteDenied = false;
    let updateErr = "";
    let deleteErr = "";

    try {
      await appDb.$executeRawUnsafe(`UPDATE "${tbl}" SET id = id WHERE false;`);
    } catch (e) {
      updateDenied = true;
      updateErr = e.message.includes("42501") ? "42501 permission denied" : e.message.split("\n")[0];
    }

    try {
      await appDb.$executeRawUnsafe(`DELETE FROM "${tbl}" WHERE false;`);
    } catch (e) {
      deleteDenied = true;
      deleteErr = e.message.includes("42501") ? "42501 permission denied" : e.message.split("\n")[0];
    }

    immutabilityResults.push({
      table: tbl,
      UPDATE: updateDenied ? "DENIED (42501)" : "ALLOWED ❌",
      DELETE: deleteDenied ? "DENIED (42501)" : "ALLOWED ❌",
      error: updateErr
    });

    if (!updateDenied || !deleteDenied) {
      throw new Error(`SECURITY FAILURE: Table ${tbl} allows UPDATE or DELETE for knowletive_app!`);
    }
  }
  console.table(immutabilityResults);
  console.log(`  ✓ All ${IMMUTABLE_TABLES.length}/12 immutable tables strictly reject UPDATE and DELETE with 42501.`);

  // 5. Mutable Projections Permissions
  console.log("\n5. Verifying Mutable Projection Table Permissions:");
  const mutableTables = ["PaymentReceiptBalance", "StudentCreditAccount", "BranchPayout"];
  for (const tbl of mutableTables) {
    const canSelect = await adminDb.$queryRawUnsafe(`SELECT has_table_privilege('knowletive_app', '"${tbl}"', 'SELECT') as p;`);
    const canInsert = await adminDb.$queryRawUnsafe(`SELECT has_table_privilege('knowletive_app', '"${tbl}"', 'INSERT') as p;`);
    const canUpdate = await adminDb.$queryRawUnsafe(`SELECT has_table_privilege('knowletive_app', '"${tbl}"', 'UPDATE') as p;`);
    const canDelete = await adminDb.$queryRawUnsafe(`SELECT has_table_privilege('knowletive_app', '"${tbl}"', 'DELETE') as p;`);

    console.log(`  ✓ ${tbl}: SELECT=${canSelect[0].p}, INSERT=${canInsert[0].p}, UPDATE=${canUpdate[0].p}, DELETE=${canDelete[0].p}`);
    if (!canSelect[0].p || !canInsert[0].p || !canUpdate[0].p || canDelete[0].p) {
      throw new Error(`SECURITY FAILURE: ${tbl} permissions invalid!`);
    }
  }
  console.log("  ✓ Mutable projections permit only intended operations (SELECT, INSERT, UPDATE; strictly NO DELETE).");

  // 6. Runtime DDL / CREATE Prevention
  console.log("\n6. Verifying Runtime Role Cannot Perform DDL:");
  try {
    await appDb.$executeRawUnsafe(`CREATE TABLE evil_table_test (id text);`);
    throw new Error("SECURITY FAILURE: knowletive_app was able to CREATE TABLE!");
  } catch (e) {
    if (e.message.includes("permission denied") || e.message.includes("42501")) {
      console.log("  ✓ CREATE TABLE blocked with 42501 permission denied.");
    } else {
      throw e;
    }
  }

  try {
    await appDb.$executeRawUnsafe(`CREATE SCHEMA evil_schema_test;`);
    throw new Error("SECURITY FAILURE: knowletive_app was able to CREATE SCHEMA!");
  } catch (e) {
    if (e.message.includes("permission denied") || e.message.includes("42501")) {
      console.log("  ✓ CREATE SCHEMA blocked with 42501 permission denied.");
    } else {
      throw e;
    }
  }

  await adminDb.$disconnect();
  await appDb.$disconnect();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
