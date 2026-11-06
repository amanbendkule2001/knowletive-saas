import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const ADMIN_URL = "postgresql://knowletive:knowletive@localhost:5432/knowletive?schema=public";
const STAGING_ADMIN_URL = "postgresql://knowletive:knowletive@localhost:5432/knowletive_staging?schema=public";
const APP_PASSWORD = "staging_app_secure_pass_2026";
const STAGING_APP_URL = `postgresql://knowletive_app:${APP_PASSWORD}@localhost:5432/knowletive_staging?schema=public`;

async function main() {
  console.log("=================================================================");
  console.log("    STAGE 2.3: STAGING DATABASE PROVISIONING & HARDENING");
  console.log("=================================================================");

  // 1. Check/create staging database
  console.log("\n1. Ensuring isolated staging database 'knowletive_staging' exists...");
  try {
    execSync(`psql.exe -h localhost -p 5432 -U knowletive -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'knowletive_staging'" -t`, {
      env: { ...process.env, PGPASSWORD: "knowletive" },
      encoding: "utf-8",
    });
    // Check if output contains 1
    const checkDbOut = execSync(`psql.exe -h localhost -p 5432 -U knowletive -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'knowletive_staging'" -t`, {
      env: { ...process.env, PGPASSWORD: "knowletive" },
      encoding: "utf-8",
    }).trim();

    if (!checkDbOut.includes("1")) {
      console.log("   Creating database 'knowletive_staging' owned by 'knowletive'...");
      execSync(`createdb.exe -h localhost -p 5432 -U knowletive -O knowletive knowletive_staging`, {
        env: { ...process.env, PGPASSWORD: "knowletive" },
      });
    } else {
      console.log("   Database 'knowletive_staging' already exists.");
    }
  } catch (err) {
    console.log("   Creating database knowletive_staging via createdb...");
    execSync(`createdb.exe -h localhost -p 5432 -U knowletive -O knowletive knowletive_staging`, {
      env: { ...process.env, PGPASSWORD: "knowletive" },
    });
  }

  // 2. Pre-deployment baseline restoration from clean backup
  console.log("\n2. Restoring baseline data into staging database...");
  const dumpPath = "backups/pre_stage21_hardening_backup.dump";
  if (fs.existsSync(dumpPath)) {
    console.log(`   Restoring ${dumpPath} via pg_restore...`);
    try {
      execSync(`pg_restore.exe -h localhost -p 5432 -U knowletive -d knowletive_staging --clean --if-exists --no-owner "${dumpPath}"`, {
        env: { ...process.env, PGPASSWORD: "knowletive" },
        stdio: "ignore",
      });
      console.log("   Baseline data restored successfully.");
    } catch (e) {
      console.log("   Notice on restore (expected clean drops on fresh DB).");
    }
  } else {
    console.log("   Dump file not found, proceeding with schema sync...");
  }

  // 3. Create pre-migration staging backup
  console.log("\n3. Generating pre-migration staging backup dump...");
  const preMigrationDump = "backups/staging_pre_deploy_backup.dump";
  execSync(`pg_dump.exe -h localhost -p 5432 -U knowletive -F c -b -f "${preMigrationDump}" knowletive_staging`, {
    env: { ...process.env, PGPASSWORD: "knowletive" },
    stdio: "inherit",
  });
  console.log(`   Verified staging backup generated: ${preMigrationDump}`);

  // 4. Apply Prisma schema using Option B: Prisma DB Push
  console.log("\n4. Synchronizing Prisma Schema to staging via 'prisma db push'...");
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: STAGING_ADMIN_URL },
    stdio: "inherit",
  });
  console.log("   Prisma schema pushed successfully to staging.");

  // 5. Apply custom PostgreSQL immutability script
  console.log("\n5. Applying custom immutability trigger & statement truncate interceptor...");
  execSync(`psql.exe -h localhost -p 5432 -U knowletive -d knowletive_staging -f prisma/manual/20261106_batch_event_immutability.sql`, {
    env: { ...process.env, PGPASSWORD: "knowletive" },
    stdio: "inherit",
  });
  console.log("   Custom immutability SQL applied successfully.");

  // 6. Provision dedicated application runtime role (knowletive_app)
  console.log("\n6. Configuring dual-role security: provisioning non-owner 'knowletive_app' role...");
  execSync(`psql.exe -h localhost -p 5432 -U knowletive -d knowletive_staging -f prisma/manual/staging_role_setup.sql`, {
    env: { ...process.env, PGPASSWORD: "knowletive" },
    stdio: "inherit",
  });
  console.log("   Privilege boundaries configured: UPDATE, DELETE, TRUNCATE revoked from knowletive_app.");

  // 7. Verify effective privileges via PostgreSQL catalogs
  console.log("\n7. Validating effective permissions via PostgreSQL has_table_privilege()...");
  const privSql = `
    SELECT
      has_table_privilege('knowletive_app', '"BatchEnrollmentEvent"', 'INSERT') AS can_insert,
      has_table_privilege('knowletive_app', '"BatchEnrollmentEvent"', 'SELECT') AS can_select,
      has_table_privilege('knowletive_app', '"BatchEnrollmentEvent"', 'UPDATE') AS can_update,
      has_table_privilege('knowletive_app', '"BatchEnrollmentEvent"', 'DELETE') AS can_delete,
      has_table_privilege('knowletive_app', '"BatchEnrollmentEvent"', 'TRUNCATE') AS can_truncate;
  `;
  execSync(`psql.exe -h localhost -p 5432 -U knowletive -d knowletive_staging -c "${privSql}"`, {
    env: { ...process.env, PGPASSWORD: "knowletive" },
    stdio: "inherit",
  });

  const triggerSql = `
    SELECT trigger_name, event_manipulation, action_orientation
    FROM information_schema.triggers
    WHERE event_object_table = 'BatchEnrollmentEvent';
  `;
  execSync(`psql.exe -h localhost -p 5432 -U knowletive -d knowletive_staging -c "${triggerSql}"`, {
    env: { ...process.env, PGPASSWORD: "knowletive" },
    stdio: "inherit",
  });

  // 8. Test runtime behavior connecting as knowletive_app via Prisma
  console.log("\n8. Connecting as application runtime role 'knowletive_app' to test barriers...");
  const appPrisma = new PrismaClient({
    datasources: { db: { url: STAGING_APP_URL } },
  });

  const adminPrisma = new PrismaClient({
    datasources: { db: { url: STAGING_ADMIN_URL } },
  });

  const batchesCount = await appPrisma.batch.count();
  console.log(`   [PASS] knowletive_app SELECT on "Batch": ${batchesCount} batches found.`);

  const tenant = await appPrisma.tenant.findFirst({
    where: { academicYears: { some: {} }, students: { some: {} } },
    include: { academicYears: true, students: true },
  });
  const ay = tenant.academicYears[0];
  const student = tenant.students[0];

  const testBatch = await appPrisma.batch.create({
    data: {
      tenantId: tenant.id,
      academicYearId: ay.id,
      name: "Staging Test Batch App Role",
      code: `STG-${Date.now().toString().slice(-5)}`,
      capacity: 10,
    },
  });
  console.log(`   [PASS] knowletive_app INSERT on "Batch": ${testBatch.id}`);

  // Insert an enrollment event as app
  const event = await appPrisma.batchEnrollmentEvent.create({
    data: {
      batchId: testBatch.id,
      studentId: student.id,
      eventType: "ENROLLED",
      actorName: "Staging System",
    },
  });
  console.log(`   [PASS] knowletive_app INSERT on "BatchEnrollmentEvent": ${event.id}`);

  // Test knowletive_app attempting UPDATE on BatchEnrollmentEvent
  let updateBlocked = false;
  try {
    await appPrisma.$executeRawUnsafe(`UPDATE "BatchEnrollmentEvent" SET "eventType" = 'DROPPED' WHERE id = '${event.id}'`);
  } catch (err) {
    updateBlocked = true;
    console.log(`   [PASS] knowletive_app UPDATE blocked as expected: ${err.message}`);
  }

  // Test knowletive_app attempting DELETE on BatchEnrollmentEvent
  let deleteBlocked = false;
  try {
    await appPrisma.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE id = '${event.id}'`);
  } catch (err) {
    deleteBlocked = true;
    console.log(`   [PASS] knowletive_app DELETE blocked as expected: ${err.message}`);
  }

  // Test knowletive_app attempting TRUNCATE on BatchEnrollmentEvent
  let truncateBlocked = false;
  try {
    await appPrisma.$executeRawUnsafe(`TRUNCATE TABLE "BatchEnrollmentEvent"`);
  } catch (err) {
    truncateBlocked = true;
    console.log(`   [PASS] knowletive_app TRUNCATE blocked as expected: ${err.message}`);
  }

  // Test knowletive_app attempting to disable trigger
  let disableTriggerBlocked = false;
  try {
    await appPrisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
  } catch (err) {
    disableTriggerBlocked = true;
    console.log(`   [PASS] knowletive_app DISABLE TRIGGER blocked (non-owner): ${err.message}`);
  }

  // Test knowletive_app attempting to drop function
  let dropFuncBlocked = false;
  try {
    await appPrisma.$executeRawUnsafe(`DROP FUNCTION prevent_batch_event_tampering()`);
  } catch (err) {
    dropFuncBlocked = true;
    console.log(`   [PASS] knowletive_app DROP FUNCTION blocked (non-owner): ${err.message}`);
  }

  // Clean up test batch using admin client
  await adminPrisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
  await adminPrisma.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE "batchId" = '${testBatch.id}'`);
  await adminPrisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
  await adminPrisma.batch.delete({ where: { id: testBatch.id } });

  await appPrisma.$disconnect();
  await adminPrisma.$disconnect();

  if (!updateBlocked || !deleteBlocked || !truncateBlocked || !disableTriggerBlocked || !dropFuncBlocked) {
    console.error("\nFAIL: One or more database hardening assertions failed!");
    process.exit(1);
  }

  console.log("\n=================================================================");
  console.log("   STAGING DATABASE & ROLE HARDENING VERIFIED 100% (PASS)");
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("FATAL in staging verification:", err);
  process.exit(1);
});
