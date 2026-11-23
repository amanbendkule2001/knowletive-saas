import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const CLONE_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_disposable_clone_phase2_3_4?schema=public";

const MIGRATIONS_TO_BASELINE = [
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
  "20261120190000_lead_branch_isolation",
];

async function main() {
  console.log("=== TESTING BASELINE ADOPTION ON DISPOSABLE CLONE ===");

  // 1. Mark migrations 1..12 as applied
  for (const m of MIGRATIONS_TO_BASELINE) {
    console.log(`Resolving migration as applied: ${m}...`);
    execSync(`npx prisma migrate resolve --applied "${m}"`, {
      env: { ...process.env, DATABASE_URL: CLONE_URL },
      stdio: "pipe"
    });
  }
  console.log(`\nSuccessfully resolved ${MIGRATIONS_TO_BASELINE.length} migrations as applied.`);

  // 2. Check status
  console.log("\nChecking prisma migrate status on clone:");
  try {
    const status = execSync("npx prisma migrate status", {
      env: { ...process.env, DATABASE_URL: CLONE_URL },
      encoding: "utf8"
    });
    console.log(status);
  } catch (err) {
    console.log((err.stdout || "") + (err.stderr || ""));
  }

  // 3. Deploy remaining migrations (13..19)
  console.log("\nAttempting to deploy remaining migrations (13..19) on clone:");
  try {
    const deployOut = execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: CLONE_URL },
      encoding: "utf8"
    });
    console.log(deployOut);
    console.log("✓ All remaining migrations deployed successfully!");
  } catch (err) {
    console.error("✗ Migration deploy failed!");
    console.error((err.stdout || "") + (err.stderr || ""));
  }
}

main().catch(console.error);
