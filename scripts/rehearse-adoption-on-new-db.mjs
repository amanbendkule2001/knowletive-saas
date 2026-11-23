import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const TARGET_DB_NAME = "knowletive_adoption_rehearsal_20261123";
const TARGET_DB_URL = `postgresql://knowletive:postgres@127.0.0.1:5432/${TARGET_DB_NAME}?schema=public`;

const db = new PrismaClient({ datasources: { db: { url: TARGET_DB_URL } } });

const MIGRATIONS_1_TO_12 = [
  "20261101000000_baseline_schema",
  "20261118104700_core_financial_ledger_stage1",
  "20261118110800_stage1_2_financial_ledger_integrity_hardening",
  "20261118115500_stage1_4_allocation_reversal_integrity",
  "20261118121000_stage1_5_reversal_isolation_guard",
  "20261118122500_stage2_1_student_credit_and_double_entry_transfers",
  "20261118124000_stage2_1_1_transfer_lifecycle_and_multi_receipt",
  "20261118134500_stage2_2_2_guardian_consent_hardening",
  "20261118145500_stage2_2_3_credit_provenance_and_consent_lifecycle",
  "20261120120000_branch_isolation_two_track_ledger",
  "20261120173000_student_installments_and_demo_payments",
  "20261120190000_lead_branch_isolation"
];

async function main() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.6 — REHEARSE BASELINE ADOPTION ON NEW DISPOSABLE DATABASE");
  console.log(`  Target: ${TARGET_DB_NAME}`);
  console.log("===============================================================================\n");

  // 1. Strict Database Verification
  const [currDb] = await db.$queryRawUnsafe(`SELECT current_database() as name;`);
  console.log(`Verified connected database: ${currDb.name}`);
  if (currDb.name !== TARGET_DB_NAME) {
    throw new Error(`CRITICAL ABORT: Connected to ${currDb.name}, expected ${TARGET_DB_NAME}!`);
  }

  // 2. Snapshot table row counts before adoption
  console.log("Snapshotting pre-adoption row counts for all tables...");
  const tables = (await db.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`)).map(t => t.tablename);
  const preCounts = {};
  for (const t of tables) {
    const [res] = await db.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t}";`);
    preCounts[t] = res.c;
  }
  console.log(`Captured counts for ${tables.length} tables.\n`);

  // 3. Mark migrations 1..12 as applied
  console.log("--- Step 3: Resolving migrations 1–12 as --applied ---");
  for (const mig of MIGRATIONS_1_TO_12) {
    console.log(`  Resolving: ${mig}...`);
    try {
      const output = execSync(`npx prisma migrate resolve --applied "${mig}"`, {
        env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      console.log(`    ✓ ${output.trim()}`);
    } catch (err) {
      const msg = (err.stdout || "") + (err.stderr || "");
      throw new Error(`Failed to resolve migration ${mig}!\n${msg}`);
    }
  }
  console.log("✓ All 12 baseline migrations successfully marked as applied.\n");

  // 4. Intermediate migrate status
  console.log("--- Step 4: Intermediate prisma migrate status (expecting 13–20 unapplied) ---");
  try {
    const statusOut = execSync("npx prisma migrate status", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    console.log(statusOut.trim());
  } catch (err) {
    console.log((err.stdout || "") + (err.stderr || ""));
  }

  // 5. Deploy migrations 13..20
  console.log("\n--- Step 5: Deploying migrations 13–20 via npx prisma migrate deploy ---");
  try {
    const deployOut = execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    console.log(deployOut.trim());
    console.log("✓ Migrations 13–20 deployed successfully with exit code 0.\n");
  } catch (err) {
    const msg = (err.stdout || "") + (err.stderr || "");
    throw new Error(`Prisma migrate deploy failed!\n${msg}`);
  }

  // 6. Final migrate status
  console.log("--- Step 6: Final prisma migrate status ---");
  try {
    const finalOut = execSync("npx prisma migrate status", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    console.log(finalOut.trim());
    if (!finalOut.includes("Database schema is up to date!")) {
      throw new Error("Final status did not report up to date!");
    }
  } catch (err) {
    const msg = (err.stdout || "") + (err.stderr || "");
    throw new Error(`Final migrate status check failed!\n${msg}`);
  }

  // 7. Post-adoption row count preservation verification
  console.log("\n--- Step 7: Verifying data preservation across all tables ---");
  let countMismatches = 0;
  for (const t of tables) {
    const [res] = await db.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t}";`);
    const postCount = res.c;
    const preCount = preCounts[t];
    if (preCount !== postCount) {
      console.error(`  ❌ Mismatch on ${t}: Pre=${preCount}, Post=${postCount}`);
      countMismatches++;
    }
  }
  if (countMismatches === 0) {
    console.log(`✓ 100% DATA PRESERVATION VERIFIED: All ${tables.length} tables have exact matching row counts pre- and post-adoption!`);
  } else {
    throw new Error(`Data preservation failure: ${countMismatches} tables had count changes!`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
