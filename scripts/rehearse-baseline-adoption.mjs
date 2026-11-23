import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const TARGET_DB_NAME = process.env.TARGET_DB_NAME || "knowletive_final_rehearsal_20261121_184300";
const TARGET_DB_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${TARGET_DB_NAME}?schema=public`;

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
  console.log("=============================================================");
  console.log("  PHASE 2.3.5 — REHEARSE BASELINE ADOPTION (PART 3)");
  console.log("=============================================================");

  // 1. Independent Database Verification
  const [currDb] = await db.$queryRawUnsafe(`SELECT current_database() as name;`);
  console.log(`Connected to database: ${currDb.name}`);
  if (currDb.name !== TARGET_DB_NAME) {
    throw new Error(`CRITICAL ABORT: Connected to ${currDb.name}, expected ${TARGET_DB_NAME}!`);
  }

  // 2. Verify _prisma_migrations is absent
  const migTableCheck = await db.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables WHERE table_name = '_prisma_migrations';
  `);
  if (migTableCheck.length > 0) {
    throw new Error(`CRITICAL: _prisma_migrations already exists in ${TARGET_DB_NAME}!`);
  }
  console.log("✓ Verified _prisma_migrations is absent prior to rehearsal.\n");

  const resolutionLogs = [];

  // 3. Mark migrations 1..12 as applied one by one
  console.log("Resolving migrations 1–12 as --applied...");
  for (const mig of MIGRATIONS_1_TO_12) {
    console.log(`  Resolving: ${mig}...`);
    let exitCode = 0;
    let output = "";
    try {
      output = execSync(`npx prisma migrate resolve --applied "${mig}"`, {
        env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err) {
      exitCode = err.status || 1;
      output = (err.stdout || "") + (err.stderr || "");
    }
    resolutionLogs.push({ migration: mig, exitCode, output: output.trim() });
    if (exitCode !== 0) {
      throw new Error(`Failed to resolve migration ${mig}! Exit code: ${exitCode}\n${output}`);
    }
  }
  console.log("✓ All 12 migrations marked as applied successfully.\n");

  // 4. Run prisma migrate status
  console.log("Checking intermediate prisma migrate status (expecting 13..19 unapplied)...");
  let statusBeforeDeploy = "";
  try {
    statusBeforeDeploy = execSync("npx prisma migrate status", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    statusBeforeDeploy = (err.stdout || "") + (err.stderr || "");
  }
  console.log(statusBeforeDeploy.trim());

  // 5. Deploy migrations 13..19
  console.log("\nDeploying migrations 13–19 via npx prisma migrate deploy...");
  let deployOutput = "";
  let deployExitCode = 0;
  try {
    deployOutput = execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    deployExitCode = err.status || 1;
    deployOutput = (err.stdout || "") + (err.stderr || "");
    throw new Error(`Prisma migrate deploy failed with exit code ${deployExitCode}!\n${deployOutput}`);
  }
  console.log(deployOutput.trim());
  console.log("✓ Migrations 13–19 deployed successfully with exit code 0.\n");

  // 6. Run prisma migrate status again
  console.log("Checking final prisma migrate status (expecting 'Database schema is up to date!')...");
  let finalStatus = "";
  let finalStatusExitCode = 0;
  try {
    finalStatus = execSync("npx prisma migrate status", {
      env: { ...process.env, DATABASE_URL: TARGET_DB_URL },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    finalStatusExitCode = err.status || 1;
    finalStatus = (err.stdout || "") + (err.stderr || "");
  }
  console.log(finalStatus.trim());

  if (!finalStatus.includes("Database schema is up to date!")) {
    throw new Error("Final migrate status did not report up to date!");
  }

  // Save log
  fs.writeFileSync("scratch/rehearsal-adoption-log.json", JSON.stringify({
    targetDb: TARGET_DB_NAME,
    timestamp: new Date().toISOString(),
    resolutionLogs,
    statusBeforeDeploy,
    deployOutput,
    finalStatus
  }, null, 2));

  console.log("\n=============================================================");
  console.log("  ✅ PART 3 REHEARSAL COMPLETED WITH ZERO ERRORS");
  console.log("=============================================================");
}

main().catch(console.error).finally(() => db.$disconnect());
