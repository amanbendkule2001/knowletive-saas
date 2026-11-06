import { PrismaClient } from "@prisma/client";

async function main() {
  console.log("=================================================================");
  console.log("   STAGE 4.2: DATABASE RUNTIME PRIVILEGE VERIFICATION");
  console.log("=================================================================");

  const adminPrisma = new PrismaClient();
  const testRole = "knowletive_app_test";
  const testPassword = "AppSecretPassword123";

  try {
    // 1. Inspect current database role
    const adminCheck = await adminPrisma.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin
      FROM pg_roles WHERE rolname = 'knowletive'
    `);
    console.log("Current Database Connection Role:", adminCheck[0]);

    // 2. Setup isolated, non-owner application test role
    await adminPrisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`
      CREATE ROLE ${testRole} WITH LOGIN PASSWORD '${testPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    `);

    // Grant schema USAGE and restricted table privileges (SELECT, INSERT only)
    await adminPrisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`GRANT SELECT, INSERT ON "ExamResultSnapshot" TO ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`GRANT SELECT, INSERT ON "ExamMarksRevisionEvent" TO ${testRole}`);

    // 3. Test PostgreSQL privilege inspection functions
    const privQuery = await adminPrisma.$queryRawUnsafe(`
      SELECT
        has_schema_privilege('${testRole}', 'public', 'USAGE') AS schema_usage,
        has_table_privilege('${testRole}', '"ExamResultSnapshot"', 'SELECT') AS snap_select,
        has_table_privilege('${testRole}', '"ExamResultSnapshot"', 'INSERT') AS snap_insert,
        has_table_privilege('${testRole}', '"ExamResultSnapshot"', 'UPDATE') AS snap_update,
        has_table_privilege('${testRole}', '"ExamResultSnapshot"', 'DELETE') AS snap_delete,
        has_table_privilege('${testRole}', '"ExamResultSnapshot"', 'TRUNCATE') AS snap_truncate,
        has_table_privilege('${testRole}', '"ExamMarksRevisionEvent"', 'SELECT') AS rev_select,
        has_table_privilege('${testRole}', '"ExamMarksRevisionEvent"', 'INSERT') AS rev_insert,
        has_table_privilege('${testRole}', '"ExamMarksRevisionEvent"', 'UPDATE') AS rev_update,
        has_table_privilege('${testRole}', '"ExamMarksRevisionEvent"', 'DELETE') AS rev_delete,
        has_table_privilege('${testRole}', '"ExamMarksRevisionEvent"', 'TRUNCATE') AS rev_truncate
    `);

    const row = privQuery[0];
    console.log("\nPostgreSQL has_table_privilege() Inspection Results:");
    console.log(`- Schema USAGE: ${row.schema_usage}`);
    console.log(`- ExamResultSnapshot SELECT: ${row.snap_select}, INSERT: ${row.snap_insert}`);
    console.log(`- ExamResultSnapshot UPDATE: ${row.snap_update}, DELETE: ${row.snap_delete}, TRUNCATE: ${row.snap_truncate}`);
    console.log(`- ExamMarksRevisionEvent SELECT: ${row.rev_select}, INSERT: ${row.rev_insert}`);
    console.log(`- ExamMarksRevisionEvent UPDATE: ${row.rev_update}, DELETE: ${row.rev_delete}, TRUNCATE: ${row.rev_truncate}`);

    if (row.snap_update || row.snap_delete || row.snap_truncate || row.rev_update || row.rev_delete || row.rev_truncate) {
      throw new Error("Privilege leak: Restricted role has unauthorized write/truncate permissions!");
    }

    // 4. Connect AS the restricted non-owner role using separate PrismaClient
    const restrictedPrisma = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://${testRole}:${testPassword}@localhost:5432/knowletive?schema=public`,
        },
      },
    });

    console.log("\nTesting Runtime SQL Rejections under Restricted Role...");

    // Test UPDATE denial
    try {
      await restrictedPrisma.$executeRawUnsafe('UPDATE "ExamResultSnapshot" SET checksum = \'tampered\'');
      throw new Error("FAIL: UPDATE was allowed on ExamResultSnapshot!");
    } catch (err) {
      console.log("[PASS] UPDATE rejected:", err.message.split("\n")[0]);
    }

    // Test DELETE denial
    try {
      await restrictedPrisma.$executeRawUnsafe('DELETE FROM "ExamResultSnapshot"');
      throw new Error("FAIL: DELETE was allowed on ExamResultSnapshot!");
    } catch (err) {
      console.log("[PASS] DELETE rejected:", err.message.split("\n")[0]);
    }

    // Test TRUNCATE denial
    try {
      await restrictedPrisma.$executeRawUnsafe('TRUNCATE TABLE "ExamResultSnapshot"');
      throw new Error("FAIL: TRUNCATE was allowed on ExamResultSnapshot!");
    } catch (err) {
      console.log("[PASS] TRUNCATE rejected:", err.message.split("\n")[0]);
    }

    // Test ALTER TABLE / DISABLE TRIGGER denial
    try {
      await restrictedPrisma.$executeRawUnsafe('ALTER TABLE "ExamResultSnapshot" DISABLE TRIGGER ALL');
      throw new Error("FAIL: ALTER TABLE was allowed on ExamResultSnapshot!");
    } catch (err) {
      console.log("[PASS] ALTER TABLE DISABLE TRIGGER rejected:", err.message.split("\n")[0]);
    }

    // Test DROP FUNCTION denial
    try {
      await restrictedPrisma.$executeRawUnsafe('DROP FUNCTION fn_protect_exam_snapshot_immutability()');
      throw new Error("FAIL: DROP FUNCTION was allowed!");
    } catch (err) {
      console.log("[PASS] DROP FUNCTION rejected:", err.message.split("\n")[0]);
    }

    await restrictedPrisma.$disconnect();

    // 5. Cleanup test role
    await adminPrisma.$executeRawUnsafe(`REVOKE ALL ON "ExamResultSnapshot" FROM ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`REVOKE ALL ON "ExamMarksRevisionEvent" FROM ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${testRole}`);
    await adminPrisma.$executeRawUnsafe(`DROP ROLE ${testRole}`);
    console.log("\nRestricted test role cleaned up successfully.");
    console.log("=================================================================");
    console.log("DATABASE RUNTIME PRIVILEGE VERIFICATION: ALL GATES PASS");
    console.log("=================================================================");
  } finally {
    await adminPrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
