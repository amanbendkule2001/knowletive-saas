import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const DB_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log(`Connecting to: ${DB_NAME}`);

  const counts = await db.$queryRawUnsafe(`
    SELECT 
      (SELECT count(*)::int FROM "Student") AS students,
      (SELECT count(*)::int FROM "PaymentReceipt") AS receipts,
      (SELECT count(*)::int FROM "FeePayment") AS fee_payments,
      (SELECT count(*)::int FROM "PaymentAllocation") AS allocations,
      (SELECT count(*)::int FROM "PaymentAllocationReversal") AS reversals,
      (SELECT count(*)::int FROM "CreditTransferJournal") AS ct_journals,
      (SELECT count(*)::int FROM "CreditTransferPosting") AS ct_postings,
      (SELECT count(*)::int FROM "Branch") AS branches,
      (SELECT count(*)::int FROM "AuditLog") AS audit_logs,
      (SELECT count(*)::int FROM "CopilotThread") AS copilot_threads,
      (SELECT count(*)::int FROM "CopilotMessage") AS copilot_messages,
      (SELECT count(*)::int FROM "WebhookEvent") AS webhook_events;
  `);

  console.log("Restored Record Counts:");
  console.table(counts);

  const expected = {
    students: 2008,
    receipts: 1352,
    fee_payments: 231,
    allocations: 510,
    reversals: 226,
    ct_journals: 393,
    ct_postings: 896,
    branches: 46,
    audit_logs: 14735,
    copilot_threads: 26,
    copilot_messages: 70,
    webhook_events: 54
  };

  const actual = counts[0];
  let allMatched = true;
  for (const [key, expVal] of Object.entries(expected)) {
    const actVal = actual[key];
    if (actVal !== expVal) {
      console.error(`❌ Mismatch on ${key}: Expected ${expVal}, got ${actVal}`);
      allMatched = false;
    } else {
      console.log(`  ✓ ${key}: ${actVal} (exact match)`);
    }
  }

  // Check that _prisma_migrations does NOT exist
  const migTable = await db.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM information_schema.tables WHERE table_name = '_prisma_migrations';
  `);
  if (migTable[0].count === 0) {
    console.log("  ✓ _prisma_migrations table is absent as expected.");
  } else {
    console.error("❌ _prisma_migrations table unexpectedly exists!");
    allMatched = false;
  }

  if (!allMatched) {
    throw new Error("Baseline count verification failed!");
  }
  console.log("\n✅ ALL BASELINE RECORD COUNTS 100% PRESERVED AND VERIFIED!");

  await db.$disconnect();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
